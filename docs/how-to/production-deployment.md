# Production Deployment

This guide covers best practices for deploying nexus-core applications to production.

## Prerequisites

- PostgreSQL 17+ with required extensions
- Node.js 18+ runtime
- Proper monitoring and alerting
- Backup and disaster recovery plan

## Database Configuration

### Connection Pooling

Configure appropriate connection pool size:

```typescript
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.CORE_DATABASE_URL,
  max: 20,                    // Maximum connections
  min: 5,                     // Minimum connections
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 2000 // Timeout after 2s
});
```

### High Availability

For production, consider:

1. **PostgreSQL replication**: Set up primary-replica configuration
2. **Connection string with failover**:
   ```
   postgres://user:pass@primary:5432,replica:5432/core?target_session_attrs=read-write
   ```
3. **Read replicas**: Use read replicas for monitoring queries

### Database Backups

Set up regular backups:

```bash
# Daily backup script
pg_dump -h localhost -U postgres -d core -F c -f backup_$(date +%Y%m%d).dump
```

Or use managed database services (AWS RDS, Google Cloud SQL, etc.) with automated backups.

## Application Configuration

### Environment Variables

Use environment variables for all configuration:

```env
# Database
CORE_DATABASE_URL=postgres://user:pass@host:5432/core

# Application
CORE_NAMESPACE=production
CORE_NODE_ID=api-server-1

# Performance tuning
CORE_IDLE_POLL_INTERVAL_MS=500
CORE_VISIBILITY_TIMEOUT_SECONDS=60
CORE_BATCH_SIZE=20

# Worker mode (if using)
CORE_ENABLE_WORKERS=true
CORE_WORKER_API_ENDPOINT=http://nexus-workers:8080
```

### Configuration Management

Use a configuration management system:

```typescript
import { CoreSystem } from "@nexus-core/core";

const config = {
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: process.env.CORE_NAMESPACE || "production",
  idlePollIntervalMs: parseInt(process.env.CORE_IDLE_POLL_INTERVAL_MS || "1000"),
  visibilityTimeoutSeconds: parseInt(process.env.CORE_VISIBILITY_TIMEOUT_SECONDS || "30"),
  batchSize: parseInt(process.env.CORE_BATCH_SIZE || "10"),
  logger: createProductionLogger()
};

const system = await CoreSystem.connect(config);
```

## Performance Tuning

### Consumer Configuration

Tune based on your workload:

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "production",
  
  // Lower latency: reduce idle poll interval
  idlePollIntervalMs: 500,  // Default: 1000ms
  
  // Longer processing time: increase visibility timeout
  visibilityTimeoutSeconds: 60,  // Default: 30s
  
  // Higher throughput: increase batch size
  batchSize: 20  // Default: 10
});
```

**Trade-offs**:
- **Lower `idlePollIntervalMs`**: Faster message pickup, higher CPU usage
- **Higher `visibilityTimeoutSeconds`**: More time for processing, longer retry delay
- **Higher `batchSize`**: Better throughput, higher memory usage, higher latency

### Horizontal Scaling

Run multiple instances:

```bash
# Instance 1
CORE_NODE_ID=worker-1 npm start

# Instance 2
CORE_NODE_ID=worker-2 npm start

# Instance 3
CORE_NODE_ID=worker-3 npm start
```

Messages are distributed round-robin across instances.

## Monitoring

### Metrics Collection

Export metrics to your monitoring system:

```typescript
import { CoreSystem } from "@nexus-core/core";
import { PrometheusClient } from "prom-client";

const prometheus = new PrometheusClient();

// Collect metrics
setInterval(async () => {
  const metrics = await system.metrics();
  
  prometheus.gauge.set({ name: "nexus_queue_depth" }, metrics.queueDepth);
  prometheus.gauge.set({ name: "nexus_dlq_depth" }, metrics.deadLetterQueueDepth);
}, 5000);
```

### Health Checks

Implement health check endpoint:

```typescript
import Fastify from "fastify";

app.get("/health", async () => {
  const metrics = await system.metrics();
  const dbHealth = await checkDatabaseHealth();
  
  return {
    status: dbHealth ? "healthy" : "unhealthy",
    queueDepth: metrics.queueDepth,
    dlqDepth: metrics.deadLetterQueueDepth,
    timestamp: new Date().toISOString()
  };
});
```

### Logging

Use structured logging:

```typescript
import winston from "winston";

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "nexus-core.log" })
  ]
});

const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "production",
  logger: createWinstonLogger(logger)
});
```

## Error Handling

### Graceful Shutdown

Handle shutdown signals:

```typescript
const shutdown = async () => {
  console.log("Shutting down gracefully...");
  
  // Stop accepting new events
  await node.stop();
  
  // Wait for current handlers to complete
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Close system
  await system.close();
  
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

### Retry Logic

Implement retry for transient failures:

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

## Security

### Database Security

1. **Use strong passwords**: Generate secure passwords
2. **Limit connections**: Use firewall rules
3. **Use SSL**: Enable SSL connections
4. **Principle of least privilege**: Grant minimal required permissions

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!, // Use SSL in connection string
  namespace: "production"
});
```

### Application Security

1. **Environment variables**: Never commit secrets
2. **Secrets management**: Use AWS Secrets Manager, HashiCorp Vault, etc.
3. **Input validation**: Validate all event payloads
4. **Rate limiting**: Implement rate limiting for event emission

## Deployment Strategies

### Blue-Green Deployment

1. Deploy new version alongside old version
2. Gradually shift traffic
3. Monitor for errors
4. Roll back if needed

### Rolling Deployment

1. Deploy to one instance at a time
2. Wait for health checks
3. Continue to next instance

### Canary Deployment

1. Deploy to small subset of instances
2. Monitor metrics
3. Gradually expand if healthy

## Disaster Recovery

### Backup Strategy

1. **Database backups**: Daily full backups, hourly incremental
2. **Event log retention**: Configure appropriate retention
3. **DLQ monitoring**: Archive DLQ messages before deletion

### Recovery Procedures

1. **Database restore**: Restore from backup
2. **Event replay**: Reprocess events from event log if needed
3. **DLQ recovery**: Reprocess DLQ messages after fixing issues

## Checklist

Before deploying to production:

- [ ] PostgreSQL configured with proper connection limits
- [ ] Database backups configured
- [ ] Monitoring and alerting set up
- [ ] Logging configured
- [ ] Health checks implemented
- [ ] Graceful shutdown handling
- [ ] Environment variables secured
- [ ] Performance tuning completed
- [ ] Load testing performed
- [ ] Disaster recovery plan documented
- [ ] DLQ monitoring configured
- [ ] Scheduled tasks verified

## Next Steps

- Review [monitoring guide](./monitoring.md)
- Understand [performance considerations](../explanation/performance.md)
- See [architecture overview](../explanation/architecture.md)

