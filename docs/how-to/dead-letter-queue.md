# Handling Dead Letter Queue

This guide explains how to work with the Dead Letter Queue (DLQ) in nexus-core, where failed messages are stored for inspection and recovery.

## What is the Dead Letter Queue?

The Dead Letter Queue (DLQ) is a special queue where messages are moved when they cannot be processed successfully. This happens when:

1. **No handler registered**: No handler exists for the event type
2. **Handler failure**: Handler throws an error during execution
3. **Transaction failure**: Database transaction fails

## DLQ Message Structure

DLQ messages contain:

```typescript
interface DeadLetterPayload {
  originalEvent: EventEnvelope;  // Original event that failed
  reason: string;                // Failure reason
  failedAt: string;              // ISO timestamp of failure
  error?: string;                // Error stack trace (if available)
}
```

## Inspecting DLQ Messages

### Using SQL

```sql
-- Read DLQ messages (without consuming)
SELECT 
  msg_id,
  read_ct,
  enqueued_at,
  message->>'reason' AS reason,
  message->>'failedAt' AS failed_at,
  message->'originalEvent'->>'eventType' AS event_type,
  message->'originalEvent'->'payload' AS payload,
  message->>'error' AS error_message
FROM pgmq.read('core_events_myapp_dlq', 0, 100);
```

### Using Nexus CLI

```bash
npm run nexus
# Navigate to "View Dead Letter Queue"
```

### Programmatic Inspection

```typescript
import { CoreSystem } from "@nexus-core/core";

const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp"
});

// Get DLQ metrics
const metrics = await system.metrics();
console.log(`DLQ depth: ${metrics.deadLetterQueueDepth}`);

// Read DLQ messages
const { rows } = await system.getDatabase().query(
  `SELECT * FROM pgmq.read($1, 0, 10)`,
  [system.getDeadLetterQueueName()]
);

for (const row of rows) {
  const dlqMessage = row.message;
  console.log("Reason:", dlqMessage.reason);
  console.log("Original event:", dlqMessage.originalEvent);
  console.log("Error:", dlqMessage.error);
}
```

## Common Failure Reasons

### "No handler for event {eventType}"

**Cause**: Event was emitted but no handler was registered.

**Solution**:
1. Register a handler for the event type
2. Reprocess the DLQ message (see below)

### "Handler execution error"

**Cause**: Handler threw an exception.

**Solution**:
1. Fix the handler code
2. Ensure handler is idempotent (handles redeliveries)
3. Reprocess the DLQ message

### Transaction failure

**Cause**: Database transaction failed (constraint violation, deadlock, etc.).

**Solution**:
1. Check database logs
2. Fix data issues
3. Reprocess the DLQ message

## Reprocessing DLQ Messages

### Manual Reprocessing

1. **Read DLQ message**:
```sql
SELECT * FROM pgmq.read('core_events_myapp_dlq', 30, 1);
```

2. **Extract original event**:
```sql
SELECT 
  msg_id,
  message->'originalEvent' AS original_event
FROM pgmq.read('core_events_myapp_dlq', 30, 1);
```

3. **Re-emit the event**:
```typescript
// Get original event from DLQ
const { rows } = await db.query(
  `SELECT message->'originalEvent' AS event FROM pgmq.read($1, 30, 1)`,
  [dlqName]
);

const originalEvent = rows[0].event;

// Re-emit
await node.emit(originalEvent.eventType, originalEvent.payload);
```

4. **Delete from DLQ**:
```sql
-- After successful reprocessing
SELECT pgmq.delete('core_events_myapp_dlq', msg_id);
```

### Automated Reprocessing

Create a handler to automatically reprocess DLQ messages:

```typescript
// Register handler for DLQ events
node.onEvent("dlq.reprocess", async (event, { client }) => {
  const { messageId } = event.payload;
  
  // Read DLQ message
  const { rows } = await client.query(
    `SELECT * FROM pgmq.read($1, 30, 1) WHERE msg_id = $2`,
    [system.getDeadLetterQueueName(), messageId]
  );
  
  if (rows.length === 0) {
    console.log(`Message ${messageId} not found in DLQ`);
    return;
  }
  
  const dlqMessage = rows[0].message;
  const originalEvent = dlqMessage.originalEvent;
  
  // Re-emit original event
  await node.emit(originalEvent.eventType, originalEvent.payload);
  
  // Delete from DLQ
  await client.query(
    `SELECT pgmq.delete($1, $2)`,
    [system.getDeadLetterQueueName(), messageId]
  );
  
  console.log(`Reprocessed message ${messageId}`);
});
```

## Preventing DLQ Messages

### Register Handlers Before Starting

```typescript
// ✅ Good: Register handlers first
node.onEvent("user.created", async (event) => {
  // Handler logic
});

await node.start();

// ❌ Bad: Start before registering handlers
await node.start();
node.onEvent("user.created", async (event) => {
  // Handler might miss early events
});
```

### Make Handlers Idempotent

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // Check if already processed
  const existing = await client.query(
    "SELECT id FROM processed_events WHERE message_id = $1",
    [event.messageId]
  );
  
  if (existing.rows.length > 0) {
    console.log("Already processed, skipping");
    return;
  }
  
  // Process event
  await processUser(event.payload);
  
  // Mark as processed
  await client.query(
    "INSERT INTO processed_events (message_id) VALUES ($1)",
    [event.messageId]
  );
});
```

### Handle Errors Gracefully

```typescript
node.onEvent("user.created", async (event, { client }) => {
  try {
    await processUser(event.payload);
  } catch (error) {
    // Log error but don't throw if it's recoverable
    if (error instanceof RecoverableError) {
      console.error("Recoverable error:", error);
      // Schedule retry or notify admin
      return; // Don't throw - event will be acknowledged
    }
    
    // Throw only for unrecoverable errors
    throw error; // Will move to DLQ
  }
});
```

## DLQ Monitoring

### Set Up Alerts

```typescript
setInterval(async () => {
  const metrics = await system.metrics();
  
  if (metrics.deadLetterQueueDepth > 0) {
    console.warn(`⚠️  DLQ has ${metrics.deadLetterQueueDepth} messages`);
    
    // Send alert if threshold exceeded
    if (metrics.deadLetterQueueDepth > 100) {
      await sendAlert({
        level: "critical",
        message: `DLQ has ${metrics.deadLetterQueueDepth} messages`
      });
    }
  }
}, 60000); // Check every minute
```

### Analyze DLQ Patterns

```sql
-- Group by failure reason
SELECT 
  message->>'reason' AS reason,
  COUNT(*) AS count,
  MIN(enqueued_at) AS first_failure,
  MAX(enqueued_at) AS last_failure
FROM pgmq.read('core_events_myapp_dlq', 0, 1000)
GROUP BY reason
ORDER BY count DESC;

-- Group by event type
SELECT 
  message->'originalEvent'->>'eventType' AS event_type,
  COUNT(*) AS count
FROM pgmq.read('core_events_myapp_dlq', 0, 1000)
GROUP BY event_type
ORDER BY count DESC;
```

## DLQ Cleanup

### Manual Cleanup

```sql
-- Delete specific message
SELECT pgmq.delete('core_events_myapp_dlq', msg_id);

-- Archive old messages before deleting
CREATE TABLE dlq_archive AS
SELECT * FROM pgmq.read('core_events_myapp_dlq', 0, 1000)
WHERE enqueued_at < now() - interval '30 days';

-- Then delete from DLQ
```

### Automated Cleanup

Schedule a cleanup task:

```typescript
node.onEvent("dlq.cleanup", async (event, { client }) => {
  const { retentionDays = 30 } = event.payload;
  
  // Read old messages
  const { rows } = await client.query(
    `SELECT * FROM pgmq.read($1, 0, 1000) 
     WHERE enqueued_at < now() - interval '${retentionDays} days'`,
    [system.getDeadLetterQueueName()]
  );
  
  // Archive or delete
  for (const row of rows) {
    // Archive to separate table or delete
    await client.query(
      `SELECT pgmq.delete($1, $2)`,
      [system.getDeadLetterQueueName(), row.msg_id]
    );
  }
  
  console.log(`Cleaned up ${rows.length} old DLQ messages`);
});

// Schedule cleanup
await node.scheduleTask({
  name: "dlq-cleanup",
  cronExpression: "0 3 * * *", // 3 AM daily
  eventType: "dlq.cleanup",
  payload: { retentionDays: 30 }
});
```

## Best Practices

1. **Monitor DLQ regularly**: Set up alerts for DLQ growth
2. **Investigate failures**: Understand why messages failed
3. **Fix root causes**: Don't just reprocess - fix the underlying issue
4. **Make handlers idempotent**: Handle redeliveries safely
5. **Archive before deleting**: Keep DLQ messages for analysis
6. **Document failure patterns**: Track common failure reasons

## Next Steps

- Learn about [monitoring](./monitoring.md)
- Understand [error handling](../explanation/transactions.md)
- See [production deployment](./production-deployment.md)

