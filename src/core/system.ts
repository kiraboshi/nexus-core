import { randomUUID } from "node:crypto";
import { CoreDatabase } from "./database.ts";
import { CoreInitializer } from "./initializer.ts";
import { ConsoleLogger, defaultLogger } from "./logger.ts";
import type {
  CoreLogger,
  CoreMetricsSnapshot,
  CoreOptions,
  EventEnvelope,
  EventHandler,
  NodeRegistration,
  ScheduledTaskDefinition,
  ScheduledTaskRecord
} from "./types.ts";
import { sanitizeIdentifier, sleep } from "./utils.ts";
import type { CoreNode } from "./coreNode.ts";
import { createWorkerClient, type WorkerClient } from "./workerClient.ts";

export class CoreSystem {
  readonly namespace: string;
  private readonly logger: CoreLogger;
  private readonly queueName: string;
  private readonly deadLetterQueueName: string;
  // Central registry of all handlers from all nodes: eventType -> Set of handlers
  private readonly handlerRegistry = new Map<string, Set<{ nodeId: string; handler: EventHandler }>>();
  private consumerRunning = false;
  private consumerPromise: Promise<void> | null = null;
  
  // Worker-optional features
  private workerMode: "standalone" | "enhanced" = "standalone";
  private workerClient?: WorkerClient;

  private constructor(
    readonly options: CoreOptions,
    readonly db: CoreDatabase,
    logger: CoreLogger
  ) {
    this.namespace = sanitizeIdentifier(options.namespace);
    this.logger = logger;
    this.queueName = `core_events_${this.namespace}`;
    this.deadLetterQueueName = `${this.queueName}_dlq`;
  }

  static async connect(options: CoreOptions): Promise<CoreSystem> {
    const logger = options.logger ?? new ConsoleLogger(`core:${options.namespace}`);
    const database = await CoreDatabase.connect(options.connectionString, logger);
    const system = new CoreSystem(options, database, logger);
    const initializer = new CoreInitializer(database, logger);
    await initializer.initialize(system.namespace);
    
    // Determine worker mode
    if (options.enableWorkers === true) {
      system.workerMode = "enhanced";
      await system.enableWorkerFeatures();
      logger.info("Enhanced mode enabled - using nexus-core workers");
    } else if (options.enableWorkers === false) {
      system.workerMode = "standalone";
      logger.info("Standalone mode - no nexus-core workers");
    } else if (options.autoDetectWorkers) {
      const detected = await system.detectWorkerAvailability();
      if (detected) {
        system.workerMode = "enhanced";
        await system.enableWorkerFeatures();
        logger.info("Auto-detected workers - enhanced mode enabled");
      } else {
        system.workerMode = "standalone";
        logger.info("No workers detected - using standalone mode");
      }
    } else {
      system.workerMode = "standalone"; // Default
      logger.info("Standalone mode (default) - no nexus-core workers");
    }
    
    // Start the single consumer for this worker
    system.startConsumer();
    return system;
  }

  getQueueName(): string {
    return this.queueName;
  }

  getDeadLetterQueueName(): string {
    return this.deadLetterQueueName;
  }

  getLogger(): CoreLogger {
    return this.logger;
  }

  getDatabase(): CoreDatabase {
    return this.db;
  }

  getOptions(): CoreOptions {
    return {
      ...this.options,
      namespace: this.namespace
    };
  }

  async registerNode(registration: NodeRegistration = {}): Promise<CoreNode> {
    const nodeId = registration.nodeId ?? randomUUID().replace(/-/g, "").slice(0, 12);
    const cleanNodeId = sanitizeIdentifier(nodeId);

    await this.db.query(
      `INSERT INTO core.nodes(node_id, namespace, display_name, description, metadata)
       VALUES($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (node_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             description = EXCLUDED.description,
             metadata = EXCLUDED.metadata,
             last_heartbeat = now()`,
      [
        cleanNodeId,
        this.namespace,
        registration.displayName ?? null,
        registration.description ?? null,
        registration.metadata ?? {}
      ]
    );

    this.logger.info("Node registered", { nodeId: cleanNodeId, namespace: this.namespace });

    const { CoreNode } = await import("./coreNode.ts");
    return new CoreNode({
      nodeId: cleanNodeId,
      system: this
    });
  }

  async appendEventToLog(envelope: EventEnvelope): Promise<void> {
    await this.db.query(
      `SELECT core.append_event_log($1, $2, $3::jsonb, $4, $5, $6::jsonb)` ,
      [
        envelope.namespace,
        envelope.eventType,
        envelope.payload ?? {},
        envelope.producerNodeId,
        envelope.scheduledTaskId ?? null,
        {
          messageId: envelope.messageId,
          redeliveryCount: envelope.redeliveryCount ?? 0
        }
      ]
    );
  }

  async createScheduledTask(definition: ScheduledTaskDefinition): Promise<ScheduledTaskRecord> {
    const taskId = randomUUID();
    const jobName = `${this.namespace}_${sanitizeIdentifier(definition.name)}_${taskId.replace(/-/g, "_")}`;
    const cronCommand = `SELECT core.run_scheduled_task('${taskId}')`;
    const { rows: jobRows } = await this.db.query<{ job_id: number }>(
      `SELECT cron.schedule($1, $2, $3) AS job_id`,
      [jobName, definition.cronExpression, cronCommand]
    );
    const jobId = jobRows[0]?.job_id;
    if (!jobId) {
      throw new Error(`Failed to schedule cron job for task ${definition.name}`);
    }

    const { rows } = await this.db.query<{
      task_id: string;
      namespace: string;
      job_id: number;
      name: string;
      cron_expression: string;
      event_type: string;
      payload: unknown;
      timezone: string | null;
      active: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO core.scheduled_tasks(task_id, namespace, job_id, name, cron_expression, event_type, payload, timezone)
       VALUES($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING task_id, namespace, job_id, name, cron_expression, event_type, payload, timezone, active, created_at, updated_at` ,
      [
        taskId,
        this.namespace,
        jobId,
        definition.name,
        definition.cronExpression,
        definition.eventType,
        definition.payload ?? {},
        definition.timezone ?? null
      ]
    );

    const task = rows[0];
    if (!task) {
      throw new Error(`Failed to persist scheduled task ${definition.name}`);
    }
    this.logger.info("Scheduled task created", { taskId, jobId });
    const result: ScheduledTaskRecord = {
      name: task.name,
      cronExpression: task.cron_expression,
      eventType: task.event_type,
      payload: (task.payload as Record<string, unknown> | null) ?? {},
      taskId,
      jobId,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      active: task.active
    };

    if (task.timezone) {
      result.timezone = task.timezone;
    }

    return result;
  }

  async metrics(): Promise<CoreMetricsSnapshot> {
    try {
      const [{ rows: queueRows }, { rows: dlqRows }] = await Promise.all([
        this.db.query<{ queue_length: number }>(
          `SELECT COALESCE(SUM(queue_length), 0) AS queue_length FROM pgmq.meta WHERE queue_name = $1`,
          [this.queueName]
        ),
        this.db.query<{ queue_length: number }>(
          `SELECT COALESCE(SUM(queue_length), 0) AS queue_length FROM pgmq.meta WHERE queue_name = $1`,
          [this.deadLetterQueueName]
        )
      ]);

      return {
        queueDepth: queueRows[0]?.queue_length ?? 0,
        deadLetterQueueDepth: dlqRows[0]?.queue_length ?? 0
      };
    } catch (error) {
      this.logger.warn("Unable to fetch queue metrics", {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        queueDepth: 0,
        deadLetterQueueDepth: 0
      };
    }
  }

  async close(): Promise<void> {
    this.logger.info("Closing core system");
    this.consumerRunning = false;
    if (this.consumerPromise) {
      await this.consumerPromise;
      this.consumerPromise = null;
    }
    
    // Cleanup worker client if enabled
    if (this.workerClient) {
      await this.workerClient.disconnect();
    }
    
    await this.db.close();
  }

  /**
   * Check if worker mode is enabled
   */
  isWorkerModeEnabled(): boolean {
    return this.workerMode === "enhanced" && this.workerClient !== undefined;
  }

  /**
   * Get worker client (throws if not enabled)
   */
  getWorkerClient(): WorkerClient {
    if (!this.workerClient) {
      throw new Error("Worker features not enabled. Set enableWorkers: true or autoDetectWorkers: true");
    }
    return this.workerClient;
  }

  /**
   * Detect if nexus-core workers are available
   */
  private async detectWorkerAvailability(): Promise<boolean> {
    if (!this.options.workerApiEndpoint) {
      return false;
    }

    try {
      const client = createWorkerClient(this.options.workerApiEndpoint, this.logger);
      if (!client) {
        return false;
      }
      
      const available = await client.healthCheck();
      if (available) {
        this.workerClient = client;
      }
      return available;
    } catch (error) {
      this.logger.debug("Worker detection failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Enable worker features
   */
  private async enableWorkerFeatures(): Promise<void> {
    if (!this.options.workerApiEndpoint) {
      throw new Error("workerApiEndpoint required to enable worker features");
    }

    const client = createWorkerClient(this.options.workerApiEndpoint, this.logger);
    if (!client) {
      throw new Error("Failed to create worker client");
    }
    
    this.workerClient = client;

    // Register worker with registry
    const workerId = this.options.workerId ?? this.generateWorkerId();
    await this.workerClient.registerWorker(workerId, this.namespace);
    
    this.logger.info("Worker features enabled", { workerId, namespace: this.namespace });
  }

  private generateWorkerId(): string {
    return `worker-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Register a handler for an event type (called by CoreNode)
   */
  registerHandler(eventType: string, nodeId: string, handler: EventHandler): void {
    const handlers = this.handlerRegistry.get(eventType) ?? new Set();
    handlers.add({ nodeId, handler });
    this.handlerRegistry.set(eventType, handlers);
    this.logger.debug("Handler registered in system", { eventType, nodeId, totalHandlers: handlers.size });
  }

  /**
   * Unregister a handler for an event type (called by CoreNode)
   */
  unregisterHandler(eventType: string, nodeId: string, handler: EventHandler): void {
    const handlers = this.handlerRegistry.get(eventType);
    if (handlers) {
      handlers.delete({ nodeId, handler });
      if (handlers.size === 0) {
        this.handlerRegistry.delete(eventType);
      }
    }
  }

  /**
   * Start the single consumer loop for this worker
   * This consumer reads messages and routes them to the correct handlers
   */
  private startConsumer(): void {
    if (this.consumerRunning) {
      return;
    }
    this.consumerRunning = true;
    this.consumerPromise = this.consumeLoop();
    this.logger.info("Started single consumer for worker", { queueName: this.queueName });
  }

  /**
   * Single consumer loop - reads messages and routes to correct handlers
   */
  private async consumeLoop(): Promise<void> {
    const { idlePollIntervalMs = 1_000, visibilityTimeoutSeconds = 30, batchSize = 10 } = this.options;

    while (this.consumerRunning) {
      // Check if we have any handlers registered
      if (this.handlerRegistry.size === 0) {
        await sleep(idlePollIntervalMs);
        continue;
      }

      let rows: Array<{
        msg_id: number;
        read_ct: number;
        vt: string;
        enqueued_at: string;
        message: EventEnvelope;
      }> = [];

      try {
        const result = await this.db.query<{
          msg_id: number;
          read_ct: number;
          vt: string;
          enqueued_at: string;
          message: EventEnvelope;
        }>(
          `SELECT * FROM pgmq.read($1, $2, $3)`,
          [this.queueName, visibilityTimeoutSeconds, batchSize]
        );
        rows = result.rows;
      } catch (error) {
        this.logger.error(
          error instanceof Error ? error : new Error(String(error)),
          { phase: "pgmq.read" }
        );
        await sleep(2_000);
        continue;
      }

      if (!rows.length) {
        await sleep(idlePollIntervalMs);
        continue;
      }

      for (const row of rows) {
        if (!this.consumerRunning) {
          break;
        }

        const envelope = row.message ?? ({} as EventEnvelope);
        envelope.messageId = row.msg_id;
        envelope.redeliveryCount = row.read_ct;

        // Determine which handlers to route to
        let handlersToRoute: Array<{ nodeId: string; handler: EventHandler }> = [];

        if (envelope.broadcast) {
          // Broadcast mode: route to ALL handlers across ALL event types
          // (except handlers from the producer node)
          for (const [eventType, handlers] of this.handlerRegistry.entries()) {
            for (const handler of handlers) {
              if (handler.nodeId !== envelope.producerNodeId) {
                handlersToRoute.push(handler);
              }
            }
          }
          this.logger.info("Broadcast message - routing to all handlers", {
            eventType: envelope.eventType,
            messageId: row.msg_id,
            handlerCount: handlersToRoute.length,
            totalEventTypes: this.handlerRegistry.size
          });
        } else {
          // Normal mode: route only to handlers for this specific event type
          const handlers = this.handlerRegistry.get(envelope.eventType);
          if (!handlers || handlers.size === 0) {
            this.logger.debug("No handlers registered for event type", {
              eventType: envelope.eventType,
              messageId: row.msg_id,
              registeredTypes: Array.from(this.handlerRegistry.keys())
            });
            // Don't acknowledge - let it become visible again
            continue;
          }

          // Filter out handlers from the producer node (skip self-emissions)
          handlersToRoute = Array.from(handlers).filter(h => h.nodeId !== envelope.producerNodeId);
          
          if (handlersToRoute.length === 0) {
            this.logger.debug("All handlers are from producer node, skipping", {
              eventType: envelope.eventType,
              messageId: row.msg_id,
              producerNodeId: envelope.producerNodeId
            });
            // Don't acknowledge - let it become visible again for other nodes
            continue;
          }

          this.logger.info("Routing message to handlers", {
            eventType: envelope.eventType,
            messageId: row.msg_id,
            handlerCount: handlersToRoute.length
          });
        }

        if (handlersToRoute.length === 0) {
          this.logger.debug("No handlers to route to", {
            eventType: envelope.eventType,
            messageId: row.msg_id,
            broadcast: envelope.broadcast
          });
          // Don't acknowledge - let it become visible again
          continue;
        }

        // Route to all handlers
        try {
          await this.db.withTransaction(async (client) => {
            for (const { nodeId, handler } of handlersToRoute) {
              try {
                await Promise.resolve(handler(envelope, { client }));
                this.logger.debug("Handler executed successfully", {
                  nodeId,
                  eventType: envelope.eventType,
                  messageId: row.msg_id,
                  broadcast: envelope.broadcast
                });
              } catch (error) {
                this.logger.error(
                  error instanceof Error ? error : new Error(String(error)),
                  { nodeId, eventType: envelope.eventType, messageId: row.msg_id }
                );
                // Continue with other handlers even if one fails
              }
            }
          });

          // Acknowledge message after all handlers complete
          await this.db.query(`SELECT pgmq.delete($1::text, $2::bigint)`, [this.queueName, row.msg_id]);
          this.logger.debug("Message acknowledged", {
            eventType: envelope.eventType,
            messageId: row.msg_id
          });
        } catch (error) {
          this.logger.error(
            error instanceof Error ? error : new Error(String(error)),
            { eventType: envelope.eventType, messageId: row.msg_id }
          );
          // Move to dead letter queue on error
          await this.moveToDeadLetter(row, "Handler execution error", error);
        }
      }
    }
  }

  private async moveToDeadLetter(
    row: { msg_id: number; message: EventEnvelope },
    reason: string,
    error?: unknown
  ): Promise<void> {
    const payload = {
      originalEvent: row.message,
      reason,
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.stack ?? error.message : String(error)
    };

    await this.db.query(`SELECT pgmq.send($1, $2::jsonb)`, [this.deadLetterQueueName, payload]);
    await this.db.query(`SELECT pgmq.delete($1::text, $2::bigint)`, [this.queueName, row.msg_id]);
  }
}

