# Event Envelope Structure

Complete reference for the event envelope structure used in nexus-core.

## EventEnvelope Interface

```typescript
interface EventEnvelope<TPayload = unknown> {
  namespace: string;                      // Namespace identifier
  eventType: string;                     // Event type identifier
  payload: TPayload;                     // Event payload (typed)
  emittedAt: string;                     // ISO timestamp
  producerNodeId: string;                // Node that emitted the event
  messageId?: number;                     // pgmq message ID (assigned after send)
  scheduledTaskId?: string;              // Scheduled task ID (if from task)
  redeliveryCount?: number;              // Number of times message was read
  broadcast?: boolean;                    // Whether this is a broadcast event
}
```

## Field Descriptions

### `namespace: string`

Namespace identifier where the event was emitted.

**Source**: Set automatically from `CoreSystem` configuration

**Example**: `"production"`, `"staging"`, `"my-app"`

**In Database**: Stored in `core.event_log.namespace`

### `eventType: string`

Event type identifier used for routing to handlers.

**Source**: First parameter to `node.emit()`

**Examples**:
- `"user.created"`
- `"order.placed"`
- `"payment.processed"`

**Best Practices**:
- Use dot notation for hierarchy (`domain.action`)
- Use lowercase with underscores or dots
- Be consistent across your application

**In Database**: Stored in `core.event_log.event_type`

### `payload: TPayload`

Event payload data (typed).

**Source**: Second parameter to `node.emit()`

**Type**: Any JSON-serializable data

**Examples**:
```typescript
// Simple object
{ userId: "123", email: "user@example.com" }

// Nested object
{
  orderId: "ord-123",
  customer: { id: "cust-456", email: "customer@example.com" },
  items: [{ productId: "prod-1", quantity: 2 }]
}

// Array
{ batchId: "batch-789", items: ["item1", "item2"] }
```

**In Database**: Stored as JSONB in `core.event_log.payload`

### `emittedAt: string`

ISO 8601 timestamp when the event was emitted.

**Source**: Auto-generated when event is emitted

**Format**: `YYYY-MM-DDTHH:mm:ss.sssZ`

**Example**: `"2024-01-15T10:30:45.123Z"`

**In Database**: Stored in `core.event_log.emitted_at`

### `producerNodeId: string`

Node ID that emitted the event.

**Source**: Set automatically from `CoreNode.nodeId`

**Example**: `"api-server-1"`, `"worker-abc123"`

**Special Values**:
- `"scheduler"` - Event emitted by scheduled task

**In Database**: Stored in `core.event_log.producer_node_id`

### `messageId?: number`

pgmq message ID assigned after the event is enqueued.

**Source**: Returned by `pgmq.send()`

**Example**: `12345`

**Usage**: 
- Tracking and correlation
- Idempotency checks
- Debugging

**In Database**: Stored in `core.event_log.metadata.messageId`

### `scheduledTaskId?: string`

UUID of the scheduled task that emitted this event (if applicable).

**Source**: Set automatically when event is emitted by scheduled task

**Example**: `"123e4567-e89b-12d3-a456-426614174000"`

**In Database**: Stored in `core.event_log.scheduled_task_id`

### `redeliveryCount?: number`

Number of times this message has been read from the queue.

**Source**: Set automatically by pgmq (`read_ct`)

**Example**: `0` (first delivery), `1` (first redelivery), `2` (second redelivery)

**Usage**:
- Implement idempotency
- Detect retry loops
- Logging and monitoring

**In Database**: Stored in `core.event_log.metadata.redeliveryCount`

### `broadcast?: boolean`

Whether this is a broadcast event (delivered to all handlers).

**Source**: Set via `options.broadcast` in `node.emit()`

**Example**: `true` for broadcast, `false` or `undefined` for normal

**Note**: Only available in enhanced mode (with workers)

**In Database**: Not stored separately (can be inferred from routing)

## Event Envelope Lifecycle

### 1. Event Emission

```typescript
const messageId = await node.emit("user.created", {
  userId: "123",
  email: "user@example.com"
});
```

**Envelope Created**:
```typescript
{
  namespace: "myapp",                    // From system config
  eventType: "user.created",             // From emit() call
  payload: { userId: "123", ... },       // From emit() call
  emittedAt: "2024-01-15T10:30:45.123Z", // Auto-generated
  producerNodeId: "api-server-1"        // From node.nodeId
}
```

### 2. Enqueue

Event is sent to pgmq queue:

```typescript
// pgmq.send() returns messageId
messageId: 12345
```

**Envelope Updated**:
```typescript
{
  // ... previous fields
  messageId: 12345                       // Added after enqueue
}
```

### 3. Event Log

Event is appended to `core.event_log`:

```sql
INSERT INTO core.event_log (
  namespace, event_type, payload, 
  producer_node_id, metadata
) VALUES (
  'myapp', 'user.created', 
  '{"userId": "123", ...}'::jsonb,
  'api-server-1',
  '{"messageId": 12345}'::jsonb
);
```

### 4. Consumption

Event is read from queue:

```typescript
// pgmq.read() returns read_ct
redeliveryCount: 0  // First read
```

**Envelope Updated**:
```typescript
{
  // ... previous fields
  redeliveryCount: 0                     // Added during consumption
}
```

### 5. Handler Execution

Handler receives complete envelope:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // event contains all fields
  console.log(event.namespace);          // "myapp"
  console.log(event.eventType);          // "user.created"
  console.log(event.payload);            // { userId: "123", ... }
  console.log(event.messageId);         // 12345
  console.log(event.redeliveryCount);    // 0
});
```

## Database Storage

Events are stored in `core.event_log`:

```sql
SELECT 
  event_id,
  namespace,              -- EventEnvelope.namespace
  event_type,             -- EventEnvelope.eventType
  payload,                -- EventEnvelope.payload
  emitted_at,             -- EventEnvelope.emittedAt
  producer_node_id,       -- EventEnvelope.producerNodeId
  scheduled_task_id,      -- EventEnvelope.scheduledTaskId
  metadata->>'messageId' AS message_id,        -- EventEnvelope.messageId
  metadata->>'redeliveryCount' AS redelivery_count  -- EventEnvelope.redeliveryCount
FROM core.event_log
WHERE namespace = 'myapp';
```

## Type Safety

Use TypeScript generics for type-safe payloads:

```typescript
interface UserCreatedPayload {
  userId: string;
  email: string;
  name: string;
}

// Emit with typed payload
await node.emit<UserCreatedPayload>("user.created", {
  userId: "123",
  email: "user@example.com",
  name: "John Doe"
});

// Handle with typed payload
node.onEvent<UserCreatedPayload>("user.created", async (event) => {
  // event.payload is typed as UserCreatedPayload
  const { userId, email, name } = event.payload;
});
```

## Examples

### Simple Event

```typescript
const messageId = await node.emit("user.created", {
  userId: "123",
  email: "user@example.com"
});
```

**Envelope**:
```json
{
  "namespace": "myapp",
  "eventType": "user.created",
  "payload": {
    "userId": "123",
    "email": "user@example.com"
  },
  "emittedAt": "2024-01-15T10:30:45.123Z",
  "producerNodeId": "api-server-1",
  "messageId": 12345,
  "redeliveryCount": 0
}
```

### Broadcast Event

```typescript
await node.emit("system.shutdown", {
  reason: "maintenance"
}, { broadcast: true });
```

**Envelope**:
```json
{
  "namespace": "myapp",
  "eventType": "system.shutdown",
  "payload": {
    "reason": "maintenance"
  },
  "emittedAt": "2024-01-15T10:30:45.123Z",
  "producerNodeId": "api-server-1",
  "messageId": 12345,
  "broadcast": true
}
```

### Scheduled Task Event

```typescript
await node.scheduleTask({
  name: "daily-cleanup",
  cronExpression: "0 2 * * *",
  eventType: "cleanup.daily",
  payload: { retentionDays: 30 }
});
```

**Envelope** (when task fires):
```json
{
  "namespace": "myapp",
  "eventType": "cleanup.daily",
  "payload": {
    "retentionDays": 30
  },
  "emittedAt": "2024-01-16T02:00:00.000Z",
  "producerNodeId": "scheduler",
  "scheduledTaskId": "123e4567-e89b-12d3-a456-426614174000",
  "messageId": 12346
}
```

## Next Steps

- See [API reference](./api-reference.md)
- Check [database schema](./database-schema.md)
- Read [how to emit events](../how-to/emit-events.md)

