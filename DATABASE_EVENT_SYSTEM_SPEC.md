# Database-Backed Event System: Core Functionality and Mechanisms

## System Overview

This is a PostgreSQL-native event-driven message bus system that provides publish-subscribe messaging, event logging, scheduled task execution, and node lifecycle management entirely within PostgreSQL. The system uses PostgreSQL extensions (`pgmq`, `pg_cron`, `pg_partman`) to implement queue semantics, job scheduling, and partitioned event storage.

### Core Principles

1. **Namespace Isolation**: Each namespace has its own queue, dead-letter queue, and event log partition
2. **Node-Based Architecture**: Services register as "nodes" that can both produce and consume events
3. **Transactional Guarantees**: Event handlers execute within database transactions
4. **At-Least-Once Delivery**: Messages are acknowledged after successful handler execution
5. **Dead Letter Queue**: Failed messages are moved to a DLQ for inspection/recovery

---

## Database Schema Components

### 1. Core Tables

#### `core.namespaces`
- **Purpose**: Registry of logical namespaces
- **Key Fields**:
  - `namespace` (TEXT PRIMARY KEY): Unique namespace identifier
  - `created_at` (TIMESTAMPTZ): Creation timestamp
  - `metadata` (JSONB): Namespace metadata

#### `core.nodes`
- **Purpose**: Registry of active nodes with heartbeat tracking
- **Key Fields**:
  - `node_id` (TEXT PRIMARY KEY): Unique node identifier
  - `namespace` (TEXT): Foreign key to `core.namespaces`
  - `display_name`, `description` (TEXT): Human-readable node information
  - `metadata` (JSONB): Node-specific metadata
  - `registered_at` (TIMESTAMPTZ): Initial registration time
  - `last_heartbeat` (TIMESTAMPTZ): Last heartbeat timestamp (updated every 30 seconds)
- **Constraint**: `UNIQUE(namespace, node_id)` ensures one node ID per namespace

#### `core.event_log`
- **Purpose**: Append-only audit log of all emitted events
- **Key Fields**:
  - `event_id` (BIGSERIAL): Auto-incrementing event identifier
  - `namespace` (TEXT): Event namespace
  - `event_type` (TEXT): Event type identifier
  - `payload` (JSONB): Event payload data
  - `emitted_at` (TIMESTAMPTZ): Event emission timestamp
  - `producer_node_id` (TEXT): Node that emitted the event
  - `scheduled_task_id` (UUID): Optional reference to scheduled task
  - `metadata` (JSONB): Additional event metadata (messageId, redeliveryCount)
- **Partitioning**: Partitioned by `emitted_at` (monthly partitions, 6-month retention)
- **Indexes**: On `namespace` and `event_type` for query performance

#### `core.scheduled_tasks`
- **Purpose**: Metadata for cron-scheduled tasks that emit events
- **Key Fields**:
  - `task_id` (UUID PRIMARY KEY): Unique task identifier
  - `namespace` (TEXT): Foreign key to `core.namespaces`
  - `job_id` (INTEGER): pg_cron job identifier
  - `name` (TEXT): Task name
  - `cron_expression` (TEXT): Cron schedule expression
  - `event_type` (TEXT): Event type to emit when task runs
  - `payload` (JSONB): Payload to include in emitted event
  - `timezone` (TEXT): Optional timezone for cron execution
  - `active` (BOOLEAN): Whether task is currently active
  - `created_at`, `updated_at` (TIMESTAMPTZ): Timestamps

### 2. PostgreSQL Functions

#### `core.touch_node_heartbeat(p_node_id TEXT)`
- **Purpose**: Updates `last_heartbeat` timestamp for a node
- **Usage**: Called every 30 seconds by each active node
- **Implementation**: Simple `UPDATE` statement

#### `core.append_event_log(...)`
- **Purpose**: Atomically inserts an event into the event log and returns the event_id
- **Parameters**:
  - `p_namespace`, `p_event_type`, `p_payload`, `p_producer_node_id`
  - `p_scheduled_task_id` (optional)
  - `p_metadata` (optional JSONB)
- **Returns**: `BIGINT` (event_id)

#### `core.queue_name_for_namespace(p_namespace TEXT)`
- **Purpose**: Generates queue name from namespace
- **Returns**: `'core_events_' || replace(namespace, '-', '_')`
- **Example**: `'demo'` → `'core_events_demo'`

#### `core.dead_letter_queue_name_for_namespace(p_namespace TEXT)`
- **Purpose**: Generates DLQ name from namespace
- **Returns**: `queue_name || '_dlq'`
- **Example**: `'core_events_demo'` → `'core_events_demo_dlq'`

#### `core.run_scheduled_task(p_task_id UUID)`
- **Purpose**: Executed by pg_cron to trigger scheduled task execution
- **Mechanism**:
  1. Loads task metadata from `core.scheduled_tasks` (if active)
  2. Constructs event envelope with task payload
  3. Sends event to namespace queue via `pgmq.send()`
  4. Appends event to `core.event_log`
  5. Updates task `updated_at` timestamp

### 3. PostgreSQL Extensions

#### `pgmq` (PostgreSQL Message Queue)
- **Purpose**: Provides queue semantics (send, read, delete)
- **Key Functions**:
  - `pgmq.create_queue(name)`: Creates a queue
  - `pgmq.send(queue_name, message)`: Enqueues a message, returns message ID
  - `pgmq.read(queue_name, vt, qty)`: Reads messages with visibility timeout
  - `pgmq.delete(queue_name, msg_id)`: Acknowledges/deletes a message
- **Visibility Timeout**: Messages become invisible to other consumers for specified duration after read
- **Read Count**: Tracks how many times a message has been read (redelivery count)

#### `pg_cron`
- **Purpose**: In-database job scheduling
- **Key Function**: `cron.schedule(job_name, cron_expression, command)`
- **Usage**: Schedules `SELECT core.run_scheduled_task(uuid)` to run on cron schedule

#### `pg_partman`
- **Purpose**: Automated partition management
- **Configuration**: Monthly partitions for `core.event_log`, 6-month retention

---

## Event Publishing Mechanism

### Event Envelope Structure

```typescript
interface EventEnvelope {
  namespace: string;           // Namespace identifier
  eventType: string;           // Event type identifier (used for routing)
  payload: unknown;            // Event payload (JSONB in database)
  emittedAt: string;          // ISO timestamp
  producerNodeId: string;     // Node that emitted the event
  messageId?: number;          // pgmq message ID (assigned after send)
  scheduledTaskId?: string;    // Optional reference to scheduled task
  redeliveryCount?: number;    // Number of times message was read
}
```

### Publishing Flow

1. **Node calls `emit(eventType, payload)`**
   - Constructs `EventEnvelope` with:
     - Current namespace (from system configuration)
     - Provided `eventType` and `payload`
     - Current timestamp (`emittedAt`)
     - Node's `nodeId` as `producerNodeId`

2. **Enqueue to pgmq queue**
   - Executes: `SELECT pgmq.send(queue_name, envelope::jsonb)`
   - Returns `messageId` (integer)
   - Message is now available for consumption

3. **Append to event log**
   - Calls `core.append_event_log()` with envelope data
   - Stores event in partitioned `core.event_log` table
   - Returns `event_id` (not used further, but stored for audit)

4. **Return messageId**
   - Publishing node receives `messageId` for tracking

### Scheduled Task Publishing

When a scheduled task fires:

1. **pg_cron executes**: `SELECT core.run_scheduled_task(task_id)`
2. **Function loads task** from `core.scheduled_tasks` (if active)
3. **Constructs event envelope**:
   - `eventType`: From task definition
   - `payload`: From task definition
   - `producerNodeId`: `'scheduler'`
   - `scheduledTaskId`: Task UUID
4. **Sends to queue** via `pgmq.send()`
5. **Appends to event log** via `core.append_event_log()`
6. **Updates task** `updated_at` timestamp

---

## Event Consumption Mechanism

### Handler Registration

- **Method**: `node.onEvent(eventType, handler)`
- **Storage**: In-memory `Map<eventType, Set<Handler>>` per node
- **Handler Signature**:
  ```typescript
  (event: EventEnvelope, context: { client: PoolClient }) => Promise<void> | void
  ```
- **Multiple Handlers**: Multiple handlers can be registered for the same `eventType`
- **Auto-start**: Registering a handler automatically starts the consumer loop if node is running

### Consumer Loop Algorithm

The consumer loop runs continuously while the node is active:

```pseudocode
WHILE node.isRunning AND consumerActive:
  1. READ messages from queue:
     - Execute: pgmq.read(queue_name, visibility_timeout, batch_size)
     - Returns: Array of messages with msg_id, read_ct, message, etc.
  
  2. IF no messages:
     - Sleep for idlePollIntervalMs (default: 1000ms)
     - Continue loop
  
  3. FOR EACH message:
     a. Decorate envelope:
        - Extract message JSONB as EventEnvelope
        - Set defaults: namespace, eventType, emittedAt, producerNodeId
        - Set messageId = msg_id
        - Set redeliveryCount = read_ct
     
     b. Lookup handlers:
        - Get handlers for envelope.eventType
        - IF no handlers:
           → Move to dead letter queue
           → Continue to next message
     
     c. Execute handlers:
        - BEGIN TRANSACTION
        - FOR EACH handler:
           → Execute handler(envelope, { client })
        - IF all handlers succeed:
           → COMMIT TRANSACTION
           → Acknowledge message (pgmq.delete)
        - IF any handler fails:
           → ROLLBACK TRANSACTION
           → Move to dead letter queue
```

### Key Mechanisms

#### Visibility Timeout
- **Purpose**: Prevents multiple consumers from processing the same message simultaneously
- **Default**: 30 seconds
- **Behavior**:
  - When `pgmq.read()` is called, messages become "invisible" to other consumers
  - If message is not acknowledged within timeout, it becomes visible again
  - `read_ct` increments each time message is read (redelivery count)

#### Batch Processing
- **Default batch size**: 10 messages per read
- **Benefit**: Reduces database round-trips
- **Trade-off**: Larger batches increase latency for individual messages

#### Transactional Handler Execution
- **All handlers for an event execute within a single transaction**
- **Benefits**:
  - Atomicity: Either all handlers succeed or all fail
  - Consistency: Handlers can share database state via `PoolClient`
  - Isolation: Handler operations are isolated from other concurrent operations
- **Rollback on failure**: If any handler throws, entire transaction rolls back

#### Message Acknowledgment
- **Method**: `pgmq.delete(queue_name, msg_id)`
- **Timing**: After all handlers execute successfully
- **Effect**: Message is permanently removed from queue

---

## Node Lifecycle Management

### Node Registration

1. **System initialization**:
   - Connect to PostgreSQL
   - Ensure extensions (pgmq, pg_cron, pg_partman, pg_stat_statements)
   - Ensure schema (tables, functions)
   - Ensure namespace exists
   - Ensure queues exist (main queue + DLQ)
   - Configure partitioning

2. **Node registration**:
   - Generate or use provided `nodeId` (sanitized identifier)
   - Insert/update `core.nodes` table:
     ```sql
     INSERT INTO core.nodes(node_id, namespace, display_name, description, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (node_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           metadata = EXCLUDED.metadata,
           last_heartbeat = now()
     ```
   - Create `CoreNode` instance with system reference

### Node Startup

1. **Set `isRunning = true`**
2. **Start heartbeat loop**:
   - Every 30 seconds: `SELECT core.touch_node_heartbeat(node_id)`
   - Updates `last_heartbeat` timestamp
   - Continues until node stops
3. **Start consumer loop** (if handlers registered):
   - Begins polling queue for messages
   - Processes messages as described in consumption mechanism

### Node Shutdown

1. **Set `isRunning = false`**
2. **Stop heartbeat loop**: Clear interval timer
3. **Stop consumer loop**:
   - Set `consumerActive = false`
   - Wait for current batch to complete
   - Exit consumer loop
4. **Close database connections**: Release connection pool

---

## Error Handling and Dead Letter Queue

### Failure Scenarios

#### 1. No Handler Registered
- **Detection**: Handler lookup returns empty set
- **Action**: Move message to DLQ with reason: `"No handler for event {eventType}"`
- **Metadata**: Original event envelope preserved in DLQ payload

#### 2. Handler Execution Failure
- **Detection**: Handler throws exception or transaction fails
- **Action**: 
  - Rollback transaction
  - Move message to DLQ with reason: `"Handler error"`
  - Include error stack trace in DLQ payload
- **Metadata**: Original event + error details

#### 3. Queue Read Failure
- **Detection**: `pgmq.read()` throws exception
- **Action**: 
  - Log error
  - Sleep 2 seconds
  - Retry read (continues loop)

### Dead Letter Queue Structure

DLQ messages contain:

```typescript
interface DeadLetterPayload {
  originalEvent: EventEnvelope;  // Original event that failed
  reason: string;                // Failure reason
  failedAt: string;              // ISO timestamp of failure
  error?: string;                // Error stack trace (if available)
}
```

### DLQ Operations

- **Enqueue**: `pgmq.send(dlq_name, dead_letter_payload::jsonb)`
- **Acknowledge original**: `pgmq.delete(queue_name, msg_id)` (removes from main queue)
- **Inspection**: DLQ can be read like any queue for manual recovery/replay

---

## Scheduled Tasks

### Task Creation

1. **Generate task UUID**: 16-character hex string
2. **Create pg_cron job**:
   ```sql
   SELECT cron.schedule(
     job_name,           -- '{namespace}_{task_name}_{task_id}'
     cron_expression,    -- e.g., '*/5 * * * *'
     cron_command        -- 'SELECT core.run_scheduled_task(task_id)'
   ) AS job_id
   ```
3. **Store task metadata** in `core.scheduled_tasks`:
   - `task_id`, `namespace`, `job_id`, `name`, `cron_expression`
   - `event_type`, `payload`, `timezone`, `active`

### Task Execution Flow

1. **pg_cron triggers** at scheduled time
2. **Executes**: `SELECT core.run_scheduled_task(task_id)`
3. **Function**:
   - Loads task (if active)
   - Constructs event envelope
   - Sends to queue via `pgmq.send()`
   - Appends to event log
   - Updates `updated_at` timestamp
4. **Event flows** through normal consumption mechanism

### Task Management

- **Deactivation**: Set `active = FALSE` in `core.scheduled_tasks`
- **Deletion**: Unschedule via `cron.unschedule(job_id)`, delete from `core.scheduled_tasks`
- **Timezone**: Optional timezone support for cron execution

---

## Configuration Parameters

### Core System Options

```typescript
interface CoreOptions {
  connectionString: string;              // PostgreSQL connection string
  namespace: string;                      // Namespace identifier
  application?: string;                   // Application identifier (logging)
  logger?: CoreLogger;                    // Custom logger implementation
  
  // Consumer tuning
  idlePollIntervalMs?: number;           // Default: 1000ms
  visibilityTimeoutSeconds?: number;     // Default: 30 seconds
  batchSize?: number;                    // Default: 10 messages
}
```

### Performance Tuning

- **`idlePollIntervalMs`**: Lower = faster message pickup, higher CPU usage
- **`visibilityTimeoutSeconds`**: Higher = more time for handler execution, but longer retry delay
- **`batchSize`**: Higher = better throughput, higher memory usage, higher latency per message

---

## Data Flow Diagrams

### Event Publishing Flow

```
[Node] emit(eventType, payload)
  ↓
[Construct EventEnvelope]
  ↓
[pgmq.send(queue_name, envelope)]
  ↓
[core.append_event_log(...)]
  ↓
[Return messageId]
```

### Event Consumption Flow

```
[Consumer Loop] (every idlePollIntervalMs)
  ↓
[pgmq.read(queue_name, vt, batch_size)]
  ↓
[For each message]
  ↓
[Lookup handlers by eventType]
  ↓
[IF handlers exist]
  ↓
[BEGIN TRANSACTION]
  ↓
[Execute all handlers]
  ↓
[IF success] → [COMMIT] → [pgmq.delete(messageId)]
[IF failure] → [ROLLBACK] → [Move to DLQ]
```

### Scheduled Task Flow

```
[pg_cron] (at scheduled time)
  ↓
[core.run_scheduled_task(task_id)]
  ↓
[Load task metadata]
  ↓
[pgmq.send(queue_name, event_envelope)]
  ↓
[core.append_event_log(...)]
  ↓
[Event flows through normal consumption]
```

---

## Key Design Decisions

1. **PostgreSQL-Native**: No external dependencies (Redis, RabbitMQ, etc.)
2. **Namespace Isolation**: Logical separation via namespaces, not physical
3. **Polling vs Push**: Polling-based consumption (simpler, but higher latency)
4. **Transactional Handlers**: All handlers for an event execute atomically
5. **At-Least-Once Delivery**: Messages can be redelivered if not acknowledged
6. **Partitioned Event Log**: Monthly partitions for query performance and retention
7. **Dead Letter Queue**: Failed messages preserved for inspection/recovery
8. **Node Heartbeats**: Track node liveness (30-second intervals)

---

## Limitations and Considerations

1. **Single Database**: All queues and events stored in one PostgreSQL instance
2. **Polling Latency**: Messages not delivered immediately (polling interval delay)
3. **No Message Ordering**: No guaranteed ordering of messages
4. **No Deduplication**: Same message can be processed multiple times if redelivered
5. **Visibility Timeout Trade-offs**: Too short = premature redelivery, too long = delayed retry
6. **Transaction Scope**: All handlers execute in single transaction (can't mix transactional/non-transactional handlers)

---

## Usage Example

```typescript
// Initialize system
const system = await CoreSystem.connect({
  connectionString: "postgres://...",
  namespace: "myapp"
});

// Register node
const node = await system.registerNode({
  nodeId: "api-server-1",
  displayName: "API Server",
  metadata: { role: "producer" }
});

// Register event handler
node.onEvent("user.created", async (event, { client }) => {
  await client.query(
    "INSERT INTO user_events(user_id, event_id) VALUES($1, $2)",
    [event.payload.userId, event.messageId]
  );
});

// Start consuming
await node.start();

// Emit event
const messageId = await node.emit("user.created", {
  userId: "123",
  email: "user@example.com"
});

// Schedule recurring task
await node.scheduleTask({
  name: "daily-cleanup",
  cronExpression: "0 2 * * *",
  eventType: "maintenance.cleanup",
  payload: { retentionDays: 30 }
});
```

---

## Summary

This database-backed event system provides a complete message bus implementation using PostgreSQL primitives. It supports:

- **Event Publishing**: Nodes emit events to namespace-scoped queues
- **Event Consumption**: Nodes register handlers and consume events via polling
- **Reliability**: Dead letter queues, transactional handlers, visibility timeouts
- **Observability**: Event log, node heartbeats, queue metrics
- **Scheduling**: Cron-based scheduled tasks that emit events
- **Multi-tenancy**: Namespace isolation for logical separation

The system is well-suited for PostgreSQL-centric architectures requiring reliable event-driven communication without external message brokers.

