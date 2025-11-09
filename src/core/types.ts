import type { PoolClient } from "pg";

export interface CoreOptions {
  connectionString: string;
  namespace: string;
  application?: string;
  logger?: CoreLogger;
  /**
   * Poll interval for event consumers when no messages are available (ms).
   * Defaults to 1000.
   */
  idlePollIntervalMs?: number;
  /**
   * Visibility timeout passed to pgmq.read in seconds. Defaults to 30 seconds.
   */
  visibilityTimeoutSeconds?: number;
  /**
   * Maximum number of messages fetched per pgmq.read invocation. Defaults to 10.
   */
  batchSize?: number;
  /**
   * Enable enhanced features via nexus-core workers (optional).
   * If true, requires workerApiEndpoint to be set.
   * If false, uses standalone mode.
   * If undefined, defaults to standalone mode.
   */
  enableWorkers?: boolean;
  /**
   * nexus-core worker API endpoint (for enhanced mode).
   * Required if enableWorkers is true.
   */
  workerApiEndpoint?: string;
  /**
   * Worker ID for this application instance (for enhanced mode).
   * Auto-generated if not provided.
   */
  workerId?: string;
  /**
   * Auto-detect if workers are available and enable enhanced mode.
   * If true, attempts to connect to workerApiEndpoint.
   * Falls back to standalone mode if workers are unavailable.
   */
  autoDetectWorkers?: boolean;
}

export interface CoreLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string | Error, meta?: Record<string, unknown>): void;
}

export interface NodeRegistration {
  nodeId?: string;
  displayName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface EventEnvelope<TPayload = unknown> {
  namespace: string;
  eventType: string;
  payload: TPayload;
  emittedAt: string;
  producerNodeId: string;
  messageId?: number;
  scheduledTaskId?: string;
  redeliveryCount?: number;
  /** If true, message will be delivered to all handlers across all nodes (fan-out/broadcast) */
  broadcast?: boolean;
}

export type EventHandler<TPayload = unknown> = (
  event: EventEnvelope<TPayload>,
  context: EventContext
) => Promise<void> | void;

export interface EventContext {
  client: PoolClient;
}

export interface ScheduledTaskDefinition {
  name: string;
  cronExpression: string;
  eventType: string;
  payload?: Record<string, unknown>;
  timezone?: string;
}

export interface ScheduledTaskRecord extends ScheduledTaskDefinition {
  taskId: string;
  jobId: number;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface CoreMetricsSnapshot {
  queueDepth: number;
  deadLetterQueueDepth: number;
}

