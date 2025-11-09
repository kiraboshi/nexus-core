# How Event Processing Works

This document explains how events flow through the nexus-core system, from emission to consumption.

## Event Lifecycle

### 1. Event Emission

When you call `node.emit()`, the following happens:

```typescript
await node.emit("user.created", { userId: "123" });
```

**Step 1: Construct Event Envelope**

```typescript
const envelope: EventEnvelope = {
  namespace: "myapp",                    // From system config
  eventType: "user.created",             // From emit() call
  payload: { userId: "123" },            // From emit() call
  emittedAt: "2024-01-15T10:30:45.123Z", // Current time
  producerNodeId: "api-server-1"        // From node.nodeId
};
```

**Step 2: Enqueue to pgmq**

```sql
SELECT pgmq.send('core_events_myapp', '{
  "namespace": "myapp",
  "eventType": "user.created",
  "payload": {"userId": "123"},
  "emittedAt": "2024-01-15T10:30:45.123Z",
  "producerNodeId": "api-server-1"
}'::jsonb);
```

This:
- Adds message to queue `core_events_myapp`
- Returns `messageId` (e.g., `12345`)
- Message is now available for consumption

**Step 3: Append to Event Log**

```sql
SELECT core.append_event_log(
  'myapp',                              -- namespace
  'user.created',                       -- event_type
  '{"userId": "123"}'::jsonb,          -- payload
  'api-server-1',                       -- producer_node_id
  NULL,                                 -- scheduled_task_id
  '{"messageId": 12345}'::jsonb        -- metadata
);
```

This:
- Inserts into `core.event_log` table
- Returns `event_id` (for audit purposes)
- Event is now in append-only log

**Step 4: Return messageId**

```typescript
return messageId; // 12345
```

## Consumer Loop

The consumer loop runs continuously while the node is active:

```typescript
while (consumerRunning) {
  // 1. Read messages from queue
  const messages = await pgmq.read(queueName, visibilityTimeout, batchSize);
  
  // 2. If no messages, sleep and continue
  if (messages.length === 0) {
    await sleep(idlePollIntervalMs);
    continue;
  }
  
  // 3. Process each message
  for (const message of messages) {
    await processMessage(message);
  }
}
```

## Message Processing

### Step 1: Read Messages

```sql
SELECT * FROM pgmq.read('core_events_myapp', 30, 10);
```

Returns:
```typescript
[
  {
    msg_id: 12345,
    read_ct: 0,                    // Redelivery count
    vt: "2024-01-15T10:31:15Z",   // Visibility timeout expiry
    enqueued_at: "2024-01-15T10:30:45Z",
    message: {
      namespace: "myapp",
      eventType: "user.created",
      payload: { userId: "123" },
      // ... other fields
    }
  }
]
```

**Visibility Timeout**: Messages become "invisible" to other consumers for the specified duration (30 seconds by default). This prevents multiple consumers from processing the same message.

### Step 2: Decorate Envelope

```typescript
const envelope = message.message;
envelope.messageId = message.msg_id;        // 12345
envelope.redeliveryCount = message.read_ct; // 0 (first read)
```

### Step 3: Lookup Handlers

```typescript
const handlers = handlerRegistry.get(envelope.eventType);
// Returns: Set of handlers for "user.created"
```

If no handlers found:
- Message is not acknowledged
- Becomes visible again after visibility timeout
- Eventually moved to DLQ if still no handlers

### Step 4: Execute Handlers

All handlers for the event execute within a **single transaction**:

```typescript
await db.withTransaction(async (client) => {
  // Handler 1
  await handler1(envelope, { client });
  
  // Handler 2
  await handler2(envelope, { client });
  
  // Handler 3
  await handler3(envelope, { client });
  
  // If all succeed, transaction commits
  // If any fails, transaction rolls back
});
```

**Transaction Benefits**:
- **Atomicity**: All handlers succeed or fail together
- **Consistency**: Shared database state
- **Isolation**: Handler operations are isolated

### Step 5: Acknowledge Message

If all handlers succeed:

```sql
SELECT pgmq.delete('core_events_myapp', 12345);
```

This:
- Permanently removes message from queue
- Message is now fully processed

If any handler fails:

```typescript
// Transaction rolls back automatically
// Move message to DLQ
await pgmq.send('core_events_myapp_dlq', {
  originalEvent: envelope,
  reason: "Handler execution error",
  failedAt: new Date().toISOString(),
  error: error.stack
});

// Remove from main queue
await pgmq.delete('core_events_myapp', 12345);
```

## Visibility Timeout and Redelivery

### How Visibility Timeout Works

1. **Message Read**: `pgmq.read()` makes message invisible for 30 seconds
2. **Processing**: Handler executes within visibility timeout
3. **Acknowledge**: `pgmq.delete()` removes message (success)
4. **Timeout**: If not acknowledged, message becomes visible again (failure)

### Redelivery Scenarios

**Scenario 1: Handler Takes Too Long**

```
Time 0s:  Message read (invisible until 30s)
Time 25s: Handler still processing...
Time 30s: Visibility timeout expires
          Message becomes visible again
          read_ct increments to 1
          Another consumer can read it
```

**Scenario 2: Handler Crashes**

```
Time 0s:  Message read (invisible until 30s)
Time 10s: Handler throws error
          Transaction rolls back
          Message not acknowledged
Time 30s: Visibility timeout expires
          Message becomes visible again
          read_ct increments to 1
```

**Scenario 3: Handler Succeeds**

```
Time 0s:  Message read (invisible until 30s)
Time 5s:  Handler completes successfully
          Transaction commits
          pgmq.delete() called
          Message removed from queue
```

## Batch Processing

Messages are read in batches for efficiency:

```typescript
const batchSize = 10; // Default
const messages = await pgmq.read(queueName, vt, batchSize);
```

**Benefits**:
- Fewer database round-trips
- Better throughput
- Reduced latency per message

**Trade-offs**:
- Higher memory usage
- Higher latency for individual messages
- All messages in batch processed before next read

## Handler Execution Order

Handlers execute in **registration order**:

```typescript
// Handler 1 executes first
node.onEvent("user.created", async (event) => {
  console.log("Handler 1");
});

// Handler 2 executes second
node.onEvent("user.created", async (event) => {
  console.log("Handler 2");
});

// Handler 3 executes third
node.onEvent("user.created", async (event) => {
  console.log("Handler 3");
});
```

**Output**:
```
Handler 1
Handler 2
Handler 3
```

## Error Handling

### Handler Errors

If a handler throws an error:

1. **Transaction Rolls Back**: All database changes are undone
2. **Error Logged**: Error is logged with context
3. **Move to DLQ**: Message is moved to dead letter queue
4. **Remove from Queue**: Message is removed from main queue

### No Handler Registered

If no handler is registered for an event type:

1. **Message Not Acknowledged**: Message remains in queue
2. **Becomes Visible Again**: After visibility timeout
3. **Eventually Moved to DLQ**: If still no handlers after multiple attempts

## Scheduled Task Processing

Scheduled tasks emit events through the same mechanism:

```
[pg_cron] (at scheduled time)
  │
  ├─► Execute: core.run_scheduled_task(task_id)
  │     │
  │     ├─► Load task from core.scheduled_tasks
  │     │
  │     ├─► Construct event envelope
  │     │     - eventType: from task definition
  │     │     - payload: from task definition
  │     │     - producerNodeId: "scheduler"
  │     │     - scheduledTaskId: task UUID
  │     │
  │     ├─► pgmq.send(queue_name, envelope)
  │     │
  │     ├─► core.append_event_log(...)
  │     │
  │     └─► Update task updated_at
  │
  └─► Event flows through normal consumption
```

## Performance Characteristics

### Latency

- **Emission**: ~1-5ms (database round-trip)
- **Consumption**: ~10-50ms (polling interval + processing)
- **Total**: ~11-55ms from emission to handler execution

### Throughput

- **Single Instance**: ~100-1000 events/second (depends on handler complexity)
- **Multiple Instances**: Linear scaling (round-robin distribution)

### Resource Usage

- **CPU**: Constant polling (tunable via `idlePollIntervalMs`)
- **Memory**: Batch size × message size
- **Database**: Connection pool + transaction overhead

## Summary

Event processing in nexus-core follows a simple, reliable pattern:

1. **Emit**: Events are enqueued and logged
2. **Consume**: Messages are read in batches
3. **Process**: Handlers execute in transactions
4. **Acknowledge**: Successful processing removes messages
5. **Retry**: Failed messages become visible again
6. **DLQ**: Persistent failures move to dead letter queue

This design prioritizes reliability and simplicity over advanced features like guaranteed ordering or push-based delivery.

## Next Steps

- Learn about [transactions](./transactions.md)
- Understand [namespaces](./namespaces.md)
- Read [architecture overview](./architecture.md)

