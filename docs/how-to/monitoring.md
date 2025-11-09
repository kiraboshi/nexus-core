# Monitoring and Debugging

This guide covers how to monitor your nexus-core application and debug issues.

## System Metrics

Get queue metrics:

```typescript
const metrics = await system.metrics();

console.log(`Queue depth: ${metrics.queueDepth}`);
console.log(`DLQ depth: ${metrics.deadLetterQueueDepth}`);
```

### Metrics Snapshot

```typescript
interface CoreMetricsSnapshot {
  queueDepth: number;              // Number of messages in main queue
  deadLetterQueueDepth: number;   // Number of messages in DLQ
}
```

### Monitoring Loop

Set up periodic monitoring:

```typescript
setInterval(async () => {
  const metrics = await system.metrics();
  
  if (metrics.queueDepth > 1000) {
    console.warn(`High queue depth: ${metrics.queueDepth}`);
  }
  
  if (metrics.deadLetterQueueDepth > 0) {
    console.error(`DLQ has ${metrics.deadLetterQueueDepth} messages!`);
  }
}, 5000); // Check every 5 seconds
```

## Database Queries for Monitoring

### Queue Depths

```sql
-- Main queue depth
SELECT queue_length 
FROM pgmq.meta 
WHERE queue_name = 'core_events_myapp';

-- DLQ depth
SELECT queue_length 
FROM pgmq.meta 
WHERE queue_name = 'core_events_myapp_dlq';
```

### Active Nodes

```sql
-- List all active nodes
SELECT 
  node_id,
  display_name,
  namespace,
  last_heartbeat,
  now() - last_heartbeat AS time_since_heartbeat
FROM core.nodes
WHERE namespace = 'myapp'
ORDER BY last_heartbeat DESC;
```

### Recent Events

```sql
-- Recent events from event log
SELECT 
  event_id,
  event_type,
  producer_node_id,
  emitted_at,
  payload
FROM core.event_log
WHERE namespace = 'myapp'
ORDER BY emitted_at DESC
LIMIT 100;
```

### Event Statistics

```sql
-- Events by type (last 24 hours)
SELECT 
  event_type,
  COUNT(*) AS count,
  MIN(emitted_at) AS first_event,
  MAX(emitted_at) AS last_event
FROM core.event_log
WHERE namespace = 'myapp'
  AND emitted_at > now() - interval '24 hours'
GROUP BY event_type
ORDER BY count DESC;
```

### Scheduled Tasks Status

```sql
-- Check scheduled tasks
SELECT 
  name,
  cron_expression,
  event_type,
  active,
  updated_at,
  now() - updated_at AS time_since_update
FROM core.scheduled_tasks
WHERE namespace = 'myapp';
```

### Cron Job Execution History

```sql
-- Recent cron job runs
SELECT 
  j.jobname,
  jr.runid,
  jr.job_pid,
  jr.database,
  jr.username,
  jr.command,
  jr.status,
  jr.return_message,
  jr.start_time,
  jr.end_time,
  jr.end_time - jr.start_time AS duration
FROM cron.job j
JOIN cron.job_run_details jr ON j.jobid = jr.jobid
WHERE j.jobname LIKE '%myapp%'
ORDER BY jr.start_time DESC
LIMIT 50;
```

## Dead Letter Queue Inspection

### View DLQ Messages

```sql
-- Read DLQ messages (without consuming)
SELECT 
  msg_id,
  read_ct,
  enqueued_at,
  message->>'reason' AS failure_reason,
  message->'originalEvent'->>'eventType' AS original_event_type,
  message->'originalEvent'->'payload' AS original_payload
FROM pgmq.read('core_events_myapp_dlq', 0, 100);
```

### DLQ Message Details

```sql
-- Detailed DLQ inspection
SELECT 
  msg_id,
  read_ct,
  enqueued_at,
  message->>'reason' AS reason,
  message->>'failedAt' AS failed_at,
  message->'originalEvent' AS original_event,
  message->>'error' AS error_message
FROM pgmq.read('core_events_myapp_dlq', 0, 10);
```

## Using Nexus CLI

The Nexus CLI provides an interactive interface for monitoring:

```bash
npm run nexus
```

Features:
- Browse database tables
- View queue metrics
- Inspect event log
- Run SQL queries
- Check node status

## Logging

### Custom Logger

Implement a custom logger:

```typescript
import { CoreLogger } from "@nexus-core/core";

class MyLogger implements CoreLogger {
  debug(message: string, meta?: Record<string, unknown>) {
    console.debug(`[DEBUG] ${message}`, meta);
  }
  
  info(message: string, meta?: Record<string, unknown>) {
    console.info(`[INFO] ${message}`, meta);
  }
  
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(`[WARN] ${message}`, meta);
  }
  
  error(message: string | Error, meta?: Record<string, unknown>) {
    if (message instanceof Error) {
      console.error(`[ERROR] ${message.message}`, { ...meta, stack: message.stack });
    } else {
      console.error(`[ERROR] ${message}`, meta);
    }
  }
}

const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp",
  logger: new MyLogger()
});
```

### Structured Logging

Use structured logging for better observability:

```typescript
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: "nexus-core.log" })
  ]
});

class WinstonLogger implements CoreLogger {
  debug(message: string, meta?: Record<string, unknown>) {
    logger.debug(message, meta);
  }
  
  info(message: string, meta?: Record<string, unknown>) {
    logger.info(message, meta);
  }
  
  warn(message: string, meta?: Record<string, unknown>) {
    logger.warn(message, meta);
  }
  
  error(message: string | Error, meta?: Record<string, unknown>) {
    logger.error(message instanceof Error ? message.message : message, {
      ...meta,
      error: message instanceof Error ? message.stack : undefined
    });
  }
}
```

## Debugging Common Issues

### Events Not Being Consumed

1. **Check if node is running**:
   ```typescript
   // Ensure node.start() was called
   await node.start();
   ```

2. **Verify handlers are registered**:
   ```typescript
   // Register handler before starting
   node.onEvent("user.created", async (event) => {
     console.log("Handler called");
   });
   await node.start();
   ```

3. **Check queue depth**:
   ```sql
   SELECT queue_length FROM pgmq.meta WHERE queue_name = 'core_events_myapp';
   ```

4. **Verify namespace matches**:
   ```typescript
   // Ensure namespace is consistent
   const system = await CoreSystem.connect({
     namespace: "myapp" // Must match everywhere
   });
   ```

### High Queue Depth

If queue depth is growing:

1. **Check handler performance**:
   ```typescript
   node.onEvent("user.created", async (event) => {
     const start = Date.now();
     await processUser(event.payload);
     const duration = Date.now() - start;
     console.log(`Processing took ${duration}ms`);
   });
   ```

2. **Increase batch size**:
   ```typescript
   const system = await CoreSystem.connect({
     batchSize: 20 // Default is 10
   });
   ```

3. **Reduce idle poll interval**:
   ```typescript
   const system = await CoreSystem.connect({
     idlePollIntervalMs: 500 // Default is 1000ms
   });
   ```

### Dead Letter Queue Growing

1. **Inspect DLQ messages**:
   ```sql
   SELECT * FROM pgmq.read('core_events_myapp_dlq', 0, 10);
   ```

2. **Check error patterns**:
   ```sql
   SELECT 
     message->>'reason' AS reason,
     COUNT(*) AS count
   FROM pgmq.read('core_events_myapp_dlq', 0, 1000)
   GROUP BY reason;
   ```

3. **Fix handler errors** and reprocess DLQ messages

### Scheduled Tasks Not Running

1. **Check task is active**:
   ```sql
   SELECT active FROM core.scheduled_tasks WHERE name = 'your-task';
   ```

2. **Verify cron job**:
   ```sql
   SELECT * FROM cron.job WHERE jobname LIKE '%your-task%';
   ```

3. **Check cron execution logs**:
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'your-task')
   ORDER BY start_time DESC LIMIT 10;
   ```

### Node Heartbeat Issues

1. **Check last heartbeat**:
   ```sql
   SELECT 
     node_id,
     last_heartbeat,
     now() - last_heartbeat AS time_since_heartbeat
   FROM core.nodes
   WHERE node_id = 'your-node-id';
   ```

2. **Verify node is running**:
   ```typescript
   // Ensure node.start() was called
   await node.start();
   ```

## Performance Monitoring

### Query Performance

Enable `pg_stat_statements`:

```sql
-- Top slow queries
SELECT 
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%pgmq%' OR query LIKE '%core.%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Connection Pool Monitoring

Monitor PostgreSQL connections:

```sql
-- Active connections
SELECT 
  datname,
  usename,
  state,
  query,
  state_change
FROM pg_stat_activity
WHERE datname = 'core';
```

## Alerting

Set up alerts for critical metrics:

```typescript
async function checkHealth() {
  const metrics = await system.metrics();
  
  if (metrics.deadLetterQueueDepth > 100) {
    await sendAlert({
      level: "critical",
      message: `DLQ has ${metrics.deadLetterQueueDepth} messages`
    });
  }
  
  if (metrics.queueDepth > 10000) {
    await sendAlert({
      level: "warning",
      message: `Queue depth is high: ${metrics.queueDepth}`
    });
  }
}

setInterval(checkHealth, 60000); // Check every minute
```

## Next Steps

- Learn about [dead letter queue handling](./dead-letter-queue.md)
- Understand [performance optimization](../explanation/performance.md)
- See [production deployment](./production-deployment.md)

