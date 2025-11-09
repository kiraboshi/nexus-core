# Performance Considerations

This document covers performance characteristics, tuning options, and optimization strategies for nexus-core.

## Performance Characteristics

### Latency

**Event Emission**:
- Database round-trip: ~1-5ms
- Queue insertion: ~1-2ms
- Event log insertion: ~1-2ms
- **Total**: ~3-9ms

**Event Consumption**:
- Polling interval: ~10-1000ms (configurable)
- Queue read: ~1-5ms
- Handler execution: Variable (depends on handler)
- Transaction commit: ~1-2ms
- **Total**: ~12-1008ms + handler time

### Throughput

**Single Instance**:
- ~100-1000 events/second (depends on handler complexity)
- Limited by handler execution time
- Database connection pool size

**Multiple Instances**:
- Linear scaling (round-robin distribution)
- ~N × single instance throughput (N = number of instances)
- Limited by database capacity

## Configuration Tuning

### idlePollIntervalMs

**Purpose**: Poll interval when no messages are available.

**Default**: `1000` (1 second)

**Trade-offs**:
- **Lower** (e.g., 500ms):
  - ✅ Faster message pickup
  - ✅ Lower latency
  - ⚠️ Higher CPU usage
  - ⚠️ More database queries

- **Higher** (e.g., 2000ms):
  - ✅ Lower CPU usage
  - ✅ Fewer database queries
  - ⚠️ Higher latency
  - ⚠️ Slower message pickup

**Recommendation**:
- **Low latency requirements**: 500ms
- **Balanced**: 1000ms (default)
- **High throughput**: 2000ms

### visibilityTimeoutSeconds

**Purpose**: How long messages are invisible to other consumers.

**Default**: `30` seconds

**Trade-offs**:
- **Lower** (e.g., 15 seconds):
  - ✅ Faster retry on failure
  - ⚠️ May cause premature redelivery
  - ⚠️ Less time for handler execution

- **Higher** (e.g., 60 seconds):
  - ✅ More time for handler execution
  - ✅ Prevents premature redelivery
  - ⚠️ Longer retry delay on failure

**Recommendation**:
- **Fast handlers** (< 5 seconds): 15-30 seconds
- **Medium handlers** (5-20 seconds): 30-60 seconds
- **Slow handlers** (> 20 seconds): 60+ seconds

### batchSize

**Purpose**: Number of messages fetched per read.

**Default**: `10`

**Trade-offs**:
- **Lower** (e.g., 5):
  - ✅ Lower latency per message
  - ✅ Lower memory usage
  - ⚠️ More database round-trips
  - ⚠️ Lower throughput

- **Higher** (e.g., 20):
  - ✅ Better throughput
  - ✅ Fewer database round-trips
  - ⚠️ Higher latency per message
  - ⚠️ Higher memory usage

**Recommendation**:
- **Low latency**: 5-10
- **Balanced**: 10 (default)
- **High throughput**: 20-50

## Handler Optimization

### Keep Handlers Fast

**Slow handlers reduce throughput**:

```typescript
// ❌ Bad: Slow handler
node.onEvent("user.created", async (event, { client }) => {
  await sleep(5000); // 5 second delay
  await client.query("INSERT INTO users ...");
});

// ✅ Good: Fast handler
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
  // Do slow operations outside transaction
  await slowOperation(); // After transaction commits
});
```

### Minimize Transaction Time

**Long transactions hold locks**:

```typescript
// ❌ Bad: Long transaction
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
  await longRunningOperation(); // Holds transaction
  await client.query("UPDATE user_stats ...");
});

// ✅ Good: Short transaction
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
  await client.query("UPDATE user_stats ...");
  // Transaction commits quickly
});
// Do long operations after transaction
await longRunningOperation();
```

### Batch Database Operations

**Reduce database round-trips**:

```typescript
// ❌ Bad: Multiple queries
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
  await client.query("INSERT INTO user_profiles ...");
  await client.query("INSERT INTO user_preferences ...");
});

// ✅ Good: Single query with multiple inserts
node.onEvent("user.created", async (event, { client }) => {
  await client.query(`
    INSERT INTO users ...;
    INSERT INTO user_profiles ...;
    INSERT INTO user_preferences ...;
  `);
});
```

## Database Optimization

### Connection Pooling

**Configure appropriate pool size**:

```typescript
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.CORE_DATABASE_URL,
  max: 20,                    // Maximum connections
  min: 5,                     // Minimum connections
  idleTimeoutMillis: 30000    // Close idle connections
});
```

**Recommendation**:
- **Small applications**: 5-10 connections
- **Medium applications**: 10-20 connections
- **Large applications**: 20-50 connections

### Indexes

**Ensure proper indexes**:

```sql
-- Event log indexes
CREATE INDEX idx_event_log_namespace ON core.event_log(namespace);
CREATE INDEX idx_event_log_event_type ON core.event_log(event_type);
CREATE INDEX idx_event_log_emitted_at ON core.event_log(emitted_at);

-- Nodes index
CREATE INDEX idx_nodes_namespace ON core.nodes(namespace);
CREATE INDEX idx_nodes_last_heartbeat ON core.nodes(last_heartbeat);
```

### Partitioning

**Event log is automatically partitioned**:
- Monthly partitions
- 6-month retention
- Automatic cleanup

**Benefits**:
- Faster queries (smaller partitions)
- Easier maintenance
- Automatic retention

## Scaling Strategies

### Vertical Scaling

**Increase database resources**:
- More CPU cores
- More memory
- Faster disk (SSD)
- Better network

**Benefits**:
- Simple to implement
- No code changes
- Immediate improvement

**Limitations**:
- Hardware limits
- Cost increases
- Single point of failure

### Horizontal Scaling

**Run multiple instances**:

```bash
# Instance 1
CORE_NODE_ID=worker-1 npm start

# Instance 2
CORE_NODE_ID=worker-2 npm start

# Instance 3
CORE_NODE_ID=worker-3 npm start
```

**Benefits**:
- Linear scaling
- Fault tolerance
- Cost-effective

**Considerations**:
- Load balancing (round-robin)
- Shared database
- Coordination needed

### Enhanced Mode Scaling

**Use enhanced mode for better scaling**:

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "production",
  enableWorkers: true,
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API!
});
```

**Benefits**:
- True fan-out
- Advanced load balancing
- Worker coordination

## Monitoring Performance

### Queue Depth

**Monitor queue depth**:

```typescript
const metrics = await system.metrics();

if (metrics.queueDepth > 1000) {
  console.warn("High queue depth:", metrics.queueDepth);
  // Consider: Increase instances, optimize handlers, increase batch size
}
```

### Handler Execution Time

**Track handler performance**:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  const start = Date.now();
  
  await processUser(event.payload);
  
  const duration = Date.now() - start;
  if (duration > 1000) {
    console.warn(`Slow handler: ${duration}ms`);
  }
});
```

### Database Performance

**Monitor database queries**:

```sql
-- Top slow queries
SELECT 
  query,
  calls,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE query LIKE '%pgmq%' OR query LIKE '%core.%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Performance Best Practices

1. **Keep handlers fast**: Minimize handler execution time
2. **Minimize transaction time**: Keep transactions short
3. **Batch operations**: Reduce database round-trips
4. **Monitor metrics**: Track queue depth and handler performance
5. **Tune configuration**: Adjust based on workload
6. **Scale horizontally**: Add instances for throughput
7. **Optimize database**: Proper indexes and connection pooling

## Performance Checklist

- [ ] Handlers execute quickly (< 1 second)
- [ ] Transactions are short (< 5 seconds)
- [ ] Database indexes are in place
- [ ] Connection pool is configured
- [ ] Queue depth is monitored
- [ ] Handler performance is tracked
- [ ] Configuration is tuned for workload
- [ ] Multiple instances are running (if needed)

## Summary

nexus-core performance depends on:

- ✅ **Handler speed**: Fast handlers = high throughput
- ✅ **Configuration**: Tune based on workload
- ✅ **Database optimization**: Proper indexes and pooling
- ✅ **Scaling**: Horizontal scaling for throughput

Optimize handlers first, then tune configuration, then scale horizontally as needed.

## Next Steps

- Learn about [monitoring](../how-to/monitoring.md)
- Understand [production deployment](../how-to/production-deployment.md)
- Read [architecture overview](./architecture.md)

