# API Reference

Complete API reference for nexus-core.

## CoreSystem

The main system class that manages connections and coordinates nodes.

### Static Methods

#### `CoreSystem.connect(options: CoreOptions): Promise<CoreSystem>`

Connects to the database and initializes the core system.

**Parameters**:
- `options: CoreOptions` - Configuration options

**Returns**: `Promise<CoreSystem>`

**Example**:
```typescript
const system = await CoreSystem.connect({
  connectionString: "postgres://user:pass@localhost:5432/core",
  namespace: "myapp"
});
```

**Throws**: 
- Database connection errors
- Schema initialization errors

### Instance Methods

#### `registerNode(registration?: NodeRegistration): Promise<CoreNode>`

Registers a new node in the system.

**Parameters**:
- `registration?: NodeRegistration` - Optional node registration details

**Returns**: `Promise<CoreNode>`

**Example**:
```typescript
const node = await system.registerNode({
  nodeId: "my-node-1",
  displayName: "My Node",
  description: "Node description",
  metadata: { version: "1.0.0" }
});
```

#### `metrics(): Promise<CoreMetricsSnapshot>`

Gets current system metrics.

**Returns**: `Promise<CoreMetricsSnapshot>`

**Example**:
```typescript
const metrics = await system.metrics();
console.log(`Queue depth: ${metrics.queueDepth}`);
console.log(`DLQ depth: ${metrics.deadLetterQueueDepth}`);
```

#### `close(): Promise<void>`

Closes the system and releases resources.

**Returns**: `Promise<void>`

**Example**:
```typescript
await system.close();
```

#### `getQueueName(): string`

Gets the queue name for the namespace.

**Returns**: `string` - Queue name (e.g., `"core_events_myapp"`)

#### `getDeadLetterQueueName(): string`

Gets the dead letter queue name for the namespace.

**Returns**: `string` - DLQ name (e.g., `"core_events_myapp_dlq"`)

#### `getLogger(): CoreLogger`

Gets the logger instance.

**Returns**: `CoreLogger`

#### `getDatabase(): CoreDatabase`

Gets the database instance.

**Returns**: `CoreDatabase`

#### `isWorkerModeEnabled(): boolean`

Checks if enhanced worker mode is enabled.

**Returns**: `boolean`

#### `getWorkerClient(): WorkerClient`

Gets the worker client (throws if not enabled).

**Returns**: `WorkerClient`

**Throws**: Error if worker mode not enabled

### Properties

- `namespace: string` - Namespace identifier
- `options: CoreOptions` - Configuration options

## CoreNode

Represents a node in the system that can emit and consume events.

### Instance Methods

#### `start(): Promise<void>`

Starts the node (begins heartbeat and consumption).

**Returns**: `Promise<void>`

**Example**:
```typescript
await node.start();
```

#### `stop(): Promise<void>`

Stops the node (stops heartbeat and consumption).

**Returns**: `Promise<void>`

**Example**:
```typescript
await node.stop();
```

#### `emit<TPayload>(eventType: string, payload: TPayload, options?: { broadcast?: boolean }): Promise<number>`

Emits an event to the queue.

**Parameters**:
- `eventType: string` - Event type identifier
- `payload: TPayload` - Event payload
- `options?: { broadcast?: boolean }` - Optional emission options

**Returns**: `Promise<number>` - Message ID

**Example**:
```typescript
const messageId = await node.emit("user.created", {
  userId: "123",
  email: "user@example.com"
});
```

#### `onEvent<TPayload>(eventType: string, handler: EventHandler<TPayload>): void`

Registers an event handler.

**Parameters**:
- `eventType: string` - Event type to handle
- `handler: EventHandler<TPayload>` - Handler function

**Returns**: `void`

**Example**:
```typescript
node.onEvent("user.created", async (event, { client }) => {
  console.log("Received:", event.payload);
  await client.query("INSERT INTO ...");
});
```

#### `offEvent(eventType: string, handler: EventHandler): void`

Unregisters an event handler.

**Parameters**:
- `eventType: string` - Event type
- `handler: EventHandler` - Handler to remove

**Returns**: `void`

**Example**:
```typescript
node.offEvent("user.created", handler);
```

#### `scheduleTask(definition: ScheduledTaskDefinition): Promise<ScheduledTaskRecord>`

Schedules a recurring task.

**Parameters**:
- `definition: ScheduledTaskDefinition` - Task definition

**Returns**: `Promise<ScheduledTaskRecord>`

**Example**:
```typescript
const task = await node.scheduleTask({
  name: "daily-cleanup",
  cronExpression: "0 2 * * *",
  eventType: "cleanup.daily",
  payload: { retentionDays: 30 }
});
```

### Properties

- `nodeId: string` - Unique node identifier (read-only)

## Types

### CoreOptions

```typescript
interface CoreOptions {
  connectionString: string;              // PostgreSQL connection string (required)
  namespace: string;                      // Namespace identifier (required)
  application?: string;                   // Application identifier (optional)
  logger?: CoreLogger;                    // Custom logger (optional)
  idlePollIntervalMs?: number;            // Poll interval when idle (default: 1000)
  visibilityTimeoutSeconds?: number;      // Visibility timeout (default: 30)
  batchSize?: number;                    // Batch size (default: 10)
  enableWorkers?: boolean;                // Enable enhanced mode (optional)
  workerApiEndpoint?: string;             // Worker API endpoint (optional)
  workerId?: string;                      // Worker ID (optional)
  autoDetectWorkers?: boolean;           // Auto-detect workers (optional)
}
```

### NodeRegistration

```typescript
interface NodeRegistration {
  nodeId?: string;                        // Node ID (auto-generated if not provided)
  displayName?: string;                   // Display name
  description?: string;                   // Description
  metadata?: Record<string, unknown>;      // Metadata
}
```

### EventEnvelope

```typescript
interface EventEnvelope<TPayload = unknown> {
  namespace: string;                      // Namespace identifier
  eventType: string;                      // Event type
  payload: TPayload;                      // Event payload
  emittedAt: string;                     // ISO timestamp
  producerNodeId: string;                 // Producer node ID
  messageId?: number;                     // pgmq message ID
  scheduledTaskId?: string;               // Scheduled task ID (if from task)
  redeliveryCount?: number;               // Redelivery count
  broadcast?: boolean;                    // Broadcast flag
}
```

### EventHandler

```typescript
type EventHandler<TPayload = unknown> = (
  event: EventEnvelope<TPayload>,
  context: EventContext
) => Promise<void> | void;
```

### EventContext

```typescript
interface EventContext {
  client: PoolClient;                     // PostgreSQL client
}
```

### ScheduledTaskDefinition

```typescript
interface ScheduledTaskDefinition {
  name: string;                           // Task name (required)
  cronExpression: string;                 // Cron expression (required)
  eventType: string;                      // Event type to emit (required)
  payload?: Record<string, unknown>;      // Event payload (optional)
  timezone?: string;                      // Timezone (optional)
}
```

### ScheduledTaskRecord

```typescript
interface ScheduledTaskRecord extends ScheduledTaskDefinition {
  taskId: string;                         // Task UUID
  jobId: number;                         // pg_cron job ID
  createdAt: string;                     // Creation timestamp
  updatedAt: string;                     // Last update timestamp
  active: boolean;                       // Active status
}
```

### CoreMetricsSnapshot

```typescript
interface CoreMetricsSnapshot {
  queueDepth: number;                     // Main queue depth
  deadLetterQueueDepth: number;          // DLQ depth
}
```

### CoreLogger

```typescript
interface CoreLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string | Error, meta?: Record<string, unknown>): void;
}
```

## Error Handling

### Common Errors

#### Database Connection Errors

```typescript
try {
  const system = await CoreSystem.connect({ ... });
} catch (error) {
  if (error.code === "ECONNREFUSED") {
    // Database not available
  }
}
```

#### Handler Execution Errors

Handlers that throw errors cause events to be moved to DLQ:

```typescript
node.onEvent("user.created", async (event) => {
  try {
    await processUser(event.payload);
  } catch (error) {
    // Error will move event to DLQ
    throw error;
  }
});
```

## Examples

### Complete Example

```typescript
import { CoreSystem } from "@nexus-core/core";

// Connect
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp"
});

// Register node
const node = await system.registerNode({
  displayName: "My Node"
});

// Register handler
node.onEvent("user.created", async (event, { client }) => {
  await client.query(
    "INSERT INTO users (id, email) VALUES ($1, $2)",
    [event.payload.userId, event.payload.email]
  );
});

// Start
await node.start();

// Emit
const messageId = await node.emit("user.created", {
  userId: "123",
  email: "user@example.com"
});

// Schedule task
await node.scheduleTask({
  name: "cleanup",
  cronExpression: "0 2 * * *",
  eventType: "cleanup.daily",
  payload: { retentionDays: 30 }
});

// Cleanup
process.on("SIGINT", async () => {
  await node.stop();
  await system.close();
});
```

## Next Steps

- See [database schema reference](./database-schema.md)
- Check [configuration options](./configuration.md)
- Read [event envelope structure](./event-envelope.md)

