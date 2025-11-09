import { CoreSystem } from "./system.ts";
import type {
  CoreLogger,
  EventEnvelope,
  EventHandler,
  ScheduledTaskDefinition
} from "./types.ts";
import { nowIso, sleep } from "./utils.ts";

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
  private heartbeatTimer: NodeJS.Timeout | null = null;

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
    const queueName = this.system.getQueueName();
    const eventTypes = Array.from(this.eventHandlers.keys());
    this.logger.info("Core node started", { 
      nodeId: this.nodeId, 
      queueName,
      eventTypes: eventTypes.length > 0 ? eventTypes : ["none"],
      handlerCount: eventTypes.length
    });
    // Only start heartbeat - CoreSystem handles message consumption
    this.startHeartbeatLoop();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.logger.info("Core node stopped", { nodeId: this.nodeId });
  }

  onEvent<TPayload = unknown>(eventType: string, handler: EventHandler<TPayload>): void {
    const handlers = this.eventHandlers.get(eventType) ?? new Set();
    handlers.add(handler as EventHandler);
    this.eventHandlers.set(eventType, handlers);
    
    // Register handler with CoreSystem's central registry
    this.system.registerHandler(eventType, this.nodeId, handler as EventHandler);
    
    // Register subscription with nexus-core workers if enhanced mode
    if (this.system.isWorkerModeEnabled()) {
      this.system.getWorkerClient().subscribe(eventType).catch((error) => {
        this.logger.error(
          error instanceof Error ? error : new Error(String(error)),
          { eventType, phase: "worker-subscription" }
        );
      });
    }
    
    const queueName = this.system.getQueueName();
    this.logger.info("Event handler registered", { 
      nodeId: this.nodeId, 
      eventType, 
      queueName,
      mode: this.system.isWorkerModeEnabled() ? "enhanced" : "standalone",
      totalHandlers: this.eventHandlers.size
    });
    
    // Start node (heartbeat) but don't start consumer - CoreSystem handles that
    if (!this.isRunning) {
      void this.start();
    }
  }

  offEvent(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (!handlers) return;
    handlers.delete(handler);
    
    // Unregister handler from CoreSystem's central registry
    this.system.unregisterHandler(eventType, this.nodeId, handler);
    
    if (handlers.size === 0) {
      this.eventHandlers.delete(eventType);
    }
  }

  async emit<TPayload = unknown>(eventType: string, payload: TPayload, options?: { broadcast?: boolean }): Promise<number> {
    const envelope: EventEnvelope = {
      namespace: this.system.namespace,
      eventType,
      payload,
      emittedAt: nowIso(),
      producerNodeId: this.nodeId,
      broadcast: options?.broadcast ?? false
    };

    let messageId: number;
    let routedQueues: string[] = [];

    if (this.system.isWorkerModeEnabled()) {
      // Enhanced mode: Route via nexus-core workers
      routedQueues = await this.system.getWorkerClient().routeEvent(envelope);
      messageId = routedQueues.length; // Return count of queues
      this.logger.debug("Event routed via workers", {
        eventType,
        queueCount: routedQueues.length,
        broadcast: envelope.broadcast
      });
    } else {
      // Standalone mode: Direct queue send
      if (envelope.broadcast) {
        this.logger.warn("Broadcast not supported in standalone mode", { eventType });
        // Fall back to normal send
      }
      
      const { rows } = await this.system.getDatabase().query<{ send: number }>(
        `SELECT pgmq.send($1, $2::jsonb)`,
        [this.system.getQueueName(), envelope]
      );
      messageId = rows[0]?.send ?? 0;
      routedQueues = [this.system.getQueueName()];
    }

    envelope.messageId = messageId;
    await this.system.appendEventToLog(envelope);
    this.logger.debug("Event emitted", {
      eventType,
      messageId,
      mode: this.system.isWorkerModeEnabled() ? "enhanced" : "standalone",
      queueCount: routedQueues.length
    });
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

}

