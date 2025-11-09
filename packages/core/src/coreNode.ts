import { CoreSystem } from "./system.js";
import type {
  CoreLogger,
  EventEnvelope,
  EventHandler,
  ScheduledTaskDefinition
} from "./types.js";
import { nowIso, sleep } from "./utils.js";

type QueueMessageRow = {
  msg_id: number;
  read_ct: number;
  vt: string;
  enqueued_at: string;
  message: EventEnvelope;
};

type DeadLetterPayload = {
  originalEvent: EventEnvelope;
  reason: string;
  failedAt: string;
  error?: string;
};

interface CoreNodeConfig {
  nodeId: string;
  system: CoreSystem;
}

export class CoreNode {
  readonly nodeId: string;
  private readonly system: CoreSystem;
  private readonly logger: CoreLogger;
  private readonly eventHandlers = new Map<string, Set<EventHandler>>();
  private isRunning = false;
  private consumerActive = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private consumerPromise: Promise<void> | null = null;

  constructor(config: CoreNodeConfig) {
    this.nodeId = config.nodeId;
    this.system = config.system;
    this.logger = this.system.getLogger();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.startHeartbeatLoop();
    this.ensureConsumerLoop();
    this.logger.info("Core node started", { nodeId: this.nodeId });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;
    this.consumerActive = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.consumerPromise) {
      await this.consumerPromise;
      this.consumerPromise = null;
    }
    this.logger.info("Core node stopped", { nodeId: this.nodeId });
  }

  onEvent<TPayload = unknown>(eventType: string, handler: EventHandler<TPayload>): void {
    const handlers = this.eventHandlers.get(eventType) ?? new Set();
    handlers.add(handler as EventHandler);
    this.eventHandlers.set(eventType, handlers);
    if (!this.isRunning) {
      void this.start();
    } else {
      this.ensureConsumerLoop();
    }
  }

  offEvent(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.eventHandlers.delete(eventType);
      if (this.eventHandlers.size === 0) {
        this.consumerActive = false;
      }
    }
  }

  async emit<TPayload = unknown>(eventType: string, payload: TPayload): Promise<number> {
    const envelope: EventEnvelope = {
      namespace: this.system.namespace,
      eventType,
      payload,
      emittedAt: nowIso(),
      producerNodeId: this.nodeId
    };

    const { rows } = await this.system.getDatabase().query<{ send: number }>(
      `SELECT pgmq.send($1, $2::jsonb)`,
      [this.system.getQueueName(), envelope]
    );

    const messageId = rows[0]?.send ?? 0;
    envelope.messageId = messageId;
    await this.system.appendEventToLog(envelope);
    this.logger.debug("Event emitted", { eventType, messageId });
    return messageId;
  }

  async scheduleTask(definition: ScheduledTaskDefinition) {
    return this.system.createScheduledTask(definition);
  }

  private startHeartbeatLoop(): void {
    const intervalMs = 30_000;
    const beat = async () => {
      try {
        await this.system
          .getDatabase()
          .query(`SELECT core.touch_node_heartbeat($1)`, [this.nodeId]);
      } catch (error) {
        this.logger.error(
          error instanceof Error ? error : new Error(String(error)),
          { phase: "heartbeat" }
        );
      }
    };

    void beat();
    this.heartbeatTimer = setInterval(() => {
      void beat();
    }, intervalMs).unref();
  }

  private ensureConsumerLoop(): void {
    if (!this.isRunning || this.consumerActive || this.eventHandlers.size === 0) {
      return;
    }
    this.consumerActive = true;
    this.consumerPromise = this.consumeLoop().finally(() => {
      this.consumerActive = false;
      this.consumerPromise = null;
    });
  }

  private async consumeLoop(): Promise<void> {
    const { idlePollIntervalMs = 1_000, visibilityTimeoutSeconds = 30, batchSize = 10 } =
      this.system.getOptions();

    while (this.isRunning && this.consumerActive) {
      let rows: QueueMessageRow[] = [];
      try {
        const result = await this.system.getDatabase().query<QueueMessageRow>(
          `SELECT * FROM pgmq.read($1, $2, $3)`,
          [this.system.getQueueName(), visibilityTimeoutSeconds, batchSize]
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
        if (!this.isRunning || !this.consumerActive) {
          break;
        }

        const envelope = this.decorateEnvelope(row);
        const handlers = this.eventHandlers.get(envelope.eventType);

        if (!handlers || handlers.size === 0) {
          await this.moveToDeadLetter(row, `No handler for event ${envelope.eventType}`);
          continue;
        }

        try {
          await this.invokeHandlers(envelope);
          await this.acknowledge(row.msg_id);
        } catch (error) {
          this.logger.error(error instanceof Error ? error : new Error(String(error)), {
            eventType: envelope.eventType,
            messageId: row.msg_id
          });
          await this.moveToDeadLetter(row, "Handler error", error);
        }
      }
    }
  }

  private decorateEnvelope(row: QueueMessageRow): EventEnvelope {
    const envelope = row.message ?? ({} as EventEnvelope);
    envelope.namespace = envelope.namespace ?? this.system.namespace;
    envelope.producerNodeId = envelope.producerNodeId ?? "unknown";
    envelope.emittedAt = envelope.emittedAt ?? row.enqueued_at ?? nowIso();
    envelope.messageId = row.msg_id;
    envelope.redeliveryCount = row.read_ct;
    return envelope;
  }

  private async invokeHandlers(envelope: EventEnvelope): Promise<void> {
    const handlers = Array.from(this.eventHandlers.get(envelope.eventType) ?? []);
    await this.system.getDatabase().withTransaction(async (client) => {
      for (const handler of handlers) {
        await Promise.resolve(handler(envelope, { client }));
      }
    });
  }

  private async acknowledge(messageId: number): Promise<void> {
    await this.system.getDatabase().query(`SELECT pgmq.delete($1, $2)`, [this.system.getQueueName(), messageId]);
  }

  private async moveToDeadLetter(row: QueueMessageRow, reason: string, error?: unknown): Promise<void> {
    const payload: DeadLetterPayload = {
      originalEvent: this.decorateEnvelope(row),
      reason,
      failedAt: nowIso()
    };

    if (error) {
      payload.error = error instanceof Error ? error.stack ?? error.message : String(error);
    }

    await this.system
      .getDatabase()
      .query(`SELECT pgmq.send($1, $2::jsonb)`, [this.system.getDeadLetterQueueName(), payload]);

    await this.system
      .getDatabase()
      .query(`SELECT pgmq.delete($1, $2)`, [this.system.getQueueName(), row.msg_id]);
  }
}

