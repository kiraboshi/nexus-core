import { randomUUID } from "node:crypto";
import { CoreDatabase } from "./database.js";
import { CoreInitializer } from "./initializer.js";
import { ConsoleLogger, defaultLogger } from "./logger.js";
import type {
  CoreLogger,
  CoreMetricsSnapshot,
  CoreOptions,
  EventEnvelope,
  NodeRegistration,
  ScheduledTaskDefinition,
  ScheduledTaskRecord
} from "./types.js";
import { sanitizeIdentifier } from "./utils.js";
import type { CoreNode } from "./coreNode.js";

export class CoreSystem {
  readonly namespace: string;
  private readonly logger: CoreLogger;
  private readonly queueName: string;
  private readonly deadLetterQueueName: string;

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

    const { CoreNode } = await import("./coreNode.js");
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
    await this.db.close();
  }
}

