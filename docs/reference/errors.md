# Error Reference

Complete reference for errors in nexus-core.

## Error Types

### Database Connection Errors

#### `ECONNREFUSED`

**Cause**: Database server is not running or not accessible.

**Solution**:
- Verify PostgreSQL is running
- Check connection string
- Verify network connectivity
- Check firewall rules

**Example**:
```typescript
try {
  const system = await CoreSystem.connect({ ... });
} catch (error) {
  if (error.code === "ECONNREFUSED") {
    console.error("Database not available");
  }
}
```

#### `ENOTFOUND`

**Cause**: Database hostname cannot be resolved.

**Solution**:
- Verify hostname is correct
- Check DNS configuration
- Verify network connectivity

#### `ETIMEDOUT`

**Cause**: Connection timeout.

**Solution**:
- Check network connectivity
- Increase connection timeout
- Verify database is accessible

### Authentication Errors

#### `password authentication failed`

**Cause**: Invalid database credentials.

**Solution**:
- Verify username and password
- Check database user permissions
- Reset password if needed

**Example**:
```typescript
// Verify connection string
const connectionString = process.env.CORE_DATABASE_URL;
// Should be: postgres://user:password@host:port/database
```

### Schema Errors

#### `relation "core.namespaces" does not exist`

**Cause**: Schema not initialized.

**Solution**:
- Ensure `CoreSystem.connect()` is called (initializes schema automatically)
- Check database user has CREATE privileges
- Verify extensions are installed

#### `extension "pgmq" does not exist`

**Cause**: Required PostgreSQL extension not installed.

**Solution**:
- Install pgmq extension
- See [Setting Up PostgreSQL](../how-to/setup-postgres.md)

**Example**:
```sql
CREATE EXTENSION IF NOT EXISTS pgmq;
```

### Handler Errors

#### Handler Execution Errors

**Cause**: Handler throws an exception.

**Behavior**: Event is moved to Dead Letter Queue.

**Solution**:
- Fix handler code
- Handle errors gracefully
- Make handlers idempotent

**Example**:
```typescript
node.onEvent("user.created", async (event) => {
  try {
    await processUser(event.payload);
  } catch (error) {
    // Log error
    console.error("Handler error:", error);
    // Re-throw to trigger DLQ
    throw error;
  }
});
```

### Queue Errors

#### `queue "core_events_myapp" does not exist`

**Cause**: Queue not created.

**Solution**:
- Ensure `CoreSystem.connect()` is called (creates queues automatically)
- Check namespace is correct
- Verify pgmq extension is installed

#### `no handler for event {eventType}`

**Cause**: Event emitted but no handler registered.

**Behavior**: Event is moved to Dead Letter Queue.

**Solution**:
- Register handler for event type
- Ensure handler is registered before emitting events
- Check event type spelling matches

**Example**:
```typescript
// Register handler first
node.onEvent("user.created", async (event) => {
  // Handler logic
});

await node.start();

// Then emit events
await node.emit("user.created", { ... });
```

### Worker Mode Errors

#### `Worker features not enabled`

**Cause**: Trying to use enhanced features in standalone mode.

**Solution**:
- Enable worker mode: `enableWorkers: true`
- Or use standalone-compatible features

**Example**:
```typescript
// Enable workers
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp",
  enableWorkers: true,
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API!
});
```

#### `workerApiEndpoint required`

**Cause**: `enableWorkers: true` but no endpoint provided.

**Solution**:
- Provide `workerApiEndpoint` option
- Or set `enableWorkers: false`

**Example**:
```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp",
  enableWorkers: true,
  workerApiEndpoint: "http://nexus-workers:8080"  // Required
});
```

### Scheduled Task Errors

#### `Failed to schedule cron job`

**Cause**: pg_cron job creation failed.

**Solution**:
- Verify pg_cron extension is installed
- Check cron configuration in postgresql.conf
- Verify database user has permissions

**Example**:
```sql
-- Verify pg_cron is installed
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- Check cron configuration
SHOW shared_preload_libraries;
-- Should include 'pg_cron'
```

## Error Handling Patterns

### Graceful Error Handling

```typescript
node.onEvent("user.created", async (event, { client }) => {
  try {
    await processUser(event.payload);
  } catch (error) {
    // Log error
    console.error("Failed to process user:", error);
    
    // Decide: throw or handle gracefully
    if (error instanceof RecoverableError) {
      // Don't throw - event will be acknowledged
      await scheduleRetry(event);
      return;
    }
    
    // Throw for unrecoverable errors - moves to DLQ
    throw error;
  }
});
```

### Retry Logic

```typescript
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(1000 * (i + 1)); // Exponential backoff
    }
  }
  throw new Error("Max retries exceeded");
}
```

### Error Logging

```typescript
import { CoreLogger } from "@nexus-core/core";

class ErrorLogger implements CoreLogger {
  error(message: string | Error, meta?: Record<string, unknown>) {
    if (message instanceof Error) {
      // Log to error tracking service
      errorTrackingService.captureException(message, {
        extra: meta
      });
    } else {
      errorTrackingService.captureMessage(message, {
        extra: meta
      });
    }
  }
  // ... implement other methods
}
```

## Dead Letter Queue Errors

### Inspecting DLQ Errors

```sql
-- View DLQ messages with error details
SELECT 
  msg_id,
  message->>'reason' AS reason,
  message->>'error' AS error_message,
  message->'originalEvent' AS original_event
FROM pgmq.read('core_events_myapp_dlq', 0, 100);
```

### Common DLQ Reasons

1. **"No handler for event {eventType}"**
   - Solution: Register handler

2. **"Handler execution error"**
   - Solution: Fix handler code

3. **"Transaction failure"**
   - Solution: Check database constraints, deadlocks

## Debugging Tips

### Enable Debug Logging

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp",
  logger: {
    debug: (msg, meta) => console.debug(`[DEBUG] ${msg}`, meta),
    info: (msg, meta) => console.info(`[INFO] ${msg}`, meta),
    warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta),
    error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta)
  }
});
```

### Check System Health

```typescript
// Check metrics
const metrics = await system.metrics();
console.log("Queue depth:", metrics.queueDepth);
console.log("DLQ depth:", metrics.deadLetterQueueDepth);

// Check node status
const { rows } = await system.getDatabase().query(
  "SELECT * FROM core.nodes WHERE namespace = $1",
  [system.namespace]
);
console.log("Active nodes:", rows);
```

### Verify Configuration

```typescript
// Check current mode
if (system.isWorkerModeEnabled()) {
  console.log("Enhanced mode enabled");
} else {
  console.log("Standalone mode");
}

// Check queue names
console.log("Queue:", system.getQueueName());
console.log("DLQ:", system.getDeadLetterQueueName());
```

## Next Steps

- Learn about [monitoring](../how-to/monitoring.md)
- Understand [dead letter queue](../how-to/dead-letter-queue.md)
- See [troubleshooting guide](../how-to/monitoring.md#debugging-common-issues)

