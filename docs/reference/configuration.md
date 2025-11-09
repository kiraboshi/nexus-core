# Configuration Reference

Complete reference for all configuration options in nexus-core.

## CoreOptions

All configuration is provided via `CoreOptions` when calling `CoreSystem.connect()`.

### Required Options

#### `connectionString: string`

PostgreSQL connection string.

**Format**: `postgres://user:password@host:port/database`

**Examples**:
```typescript
connectionString: "postgres://postgres:postgres@localhost:5432/core"
connectionString: "postgres://user:pass@db.example.com:5432/core?ssl=true"
```

**Environment Variable**: `CORE_DATABASE_URL`

#### `namespace: string`

Logical namespace identifier for grouping related nodes.

**Rules**:
- Must be a valid identifier (alphanumeric, hyphens, underscores)
- Namespace is sanitized automatically
- All nodes in the same namespace share queues and event log

**Examples**:
```typescript
namespace: "production"
namespace: "staging"
namespace: "my-app"
```

**Environment Variable**: `CORE_NAMESPACE`

### Optional Options

#### `application?: string`

Application identifier for logging purposes.

**Example**:
```typescript
application: "api-server"
application: "worker-service"
```

**Default**: `undefined`

#### `logger?: CoreLogger`

Custom logger implementation.

**Example**:
```typescript
import { CoreLogger } from "@nexus-core/core";

class MyLogger implements CoreLogger {
  debug(message: string, meta?: Record<string, unknown>) {
    console.debug(message, meta);
  }
  // ... implement other methods
}

logger: new MyLogger()
```

**Default**: `ConsoleLogger` with namespace prefix

#### `idlePollIntervalMs?: number`

Poll interval for event consumers when no messages are available (milliseconds).

**Trade-offs**:
- Lower = faster message pickup, higher CPU usage
- Higher = lower CPU usage, higher latency

**Example**:
```typescript
idlePollIntervalMs: 500  // Check every 500ms
idlePollIntervalMs: 2000 // Check every 2 seconds
```

**Default**: `1000` (1 second)

**Environment Variable**: `CORE_IDLE_POLL_INTERVAL_MS`

#### `visibilityTimeoutSeconds?: number`

Visibility timeout passed to `pgmq.read()` (seconds).

**Trade-offs**:
- Higher = more time for handler execution, longer retry delay
- Lower = faster retry, but may cause premature redelivery

**Example**:
```typescript
visibilityTimeoutSeconds: 30  // 30 seconds
visibilityTimeoutSeconds: 60  // 1 minute
```

**Default**: `30` seconds

**Environment Variable**: `CORE_VISIBILITY_TIMEOUT_SECONDS`

#### `batchSize?: number`

Maximum number of messages fetched per `pgmq.read()` invocation.

**Trade-offs**:
- Higher = better throughput, higher memory usage, higher latency per message
- Lower = lower latency, more database round-trips

**Example**:
```typescript
batchSize: 10   // Default
batchSize: 20   // Higher throughput
batchSize: 5    // Lower latency
```

**Default**: `10`

**Environment Variable**: `CORE_BATCH_SIZE`

### Worker Mode Options

#### `enableWorkers?: boolean`

Explicitly enable or disable enhanced worker mode.

**Values**:
- `true` - Enable enhanced mode (requires `workerApiEndpoint`)
- `false` - Use standalone mode
- `undefined` - Default to standalone mode

**Example**:
```typescript
enableWorkers: true   // Enhanced mode
enableWorkers: false  // Standalone mode
```

**Default**: `undefined` (standalone mode)

**Environment Variable**: `CORE_ENABLE_WORKERS`

#### `workerApiEndpoint?: string`

nexus-core worker API endpoint (required if `enableWorkers: true`).

**Format**: `http://host:port` or `https://host:port`

**Example**:
```typescript
workerApiEndpoint: "http://nexus-workers:8080"
workerApiEndpoint: "https://workers.example.com"
```

**Default**: `undefined`

**Environment Variable**: `CORE_WORKER_API_ENDPOINT`

#### `workerId?: string`

Worker ID for this application instance (for enhanced mode).

**Example**:
```typescript
workerId: "api-server-1"
workerId: "worker-abc123"
```

**Default**: Auto-generated if not provided

**Environment Variable**: `CORE_WORKER_ID`

#### `autoDetectWorkers?: boolean`

Auto-detect if workers are available and enable enhanced mode if so.

**Behavior**:
- `true` - Attempts to connect to `workerApiEndpoint`
- Falls back to standalone mode if workers unavailable
- Uses enhanced mode if workers available

**Example**:
```typescript
autoDetectWorkers: true
```

**Default**: `false`

**Environment Variable**: `CORE_AUTO_DETECT_WORKERS`

## Environment Variables

All configuration can be provided via environment variables:

```env
# Required
CORE_DATABASE_URL=postgres://postgres:postgres@localhost:5432/core
CORE_NAMESPACE=myapp

# Optional - Performance
CORE_IDLE_POLL_INTERVAL_MS=500
CORE_VISIBILITY_TIMEOUT_SECONDS=60
CORE_BATCH_SIZE=20

# Optional - Worker Mode
CORE_ENABLE_WORKERS=true
CORE_WORKER_API_ENDPOINT=http://nexus-workers:8080
CORE_WORKER_ID=my-worker-1
CORE_AUTO_DETECT_WORKERS=true

# Optional - Application
CORE_NODE_ID=my-node-1
PORT=3000
```

## Configuration Examples

### Basic Configuration

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: process.env.CORE_NAMESPACE || "default"
});
```

### Performance-Tuned Configuration

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "production",
  idlePollIntervalMs: 500,        // Faster polling
  visibilityTimeoutSeconds: 60,    // Longer timeout
  batchSize: 20                    // Larger batches
});
```

### Enhanced Mode Configuration

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "production",
  enableWorkers: true,
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API!,
  workerId: process.env.CORE_WORKER_ID
});
```

### Auto-Detection Configuration

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "production",
  autoDetectWorkers: true,
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API  // Optional fallback
});
```

### Custom Logger Configuration

```typescript
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "production",
  logger: createWinstonLogger(logger)
});
```

## Configuration Best Practices

1. **Use environment variables**: Store sensitive data in environment variables
2. **Namespace per environment**: Use different namespaces for dev/staging/prod
3. **Tune based on workload**: Adjust performance options based on your needs
4. **Monitor and adjust**: Monitor metrics and adjust configuration as needed
5. **Document your config**: Document why you chose specific values

## Configuration Validation

nexus-core validates configuration on connect:

- **Connection string**: Must be valid PostgreSQL connection string
- **Namespace**: Must be valid identifier
- **Worker mode**: If `enableWorkers: true`, `workerApiEndpoint` must be provided

Invalid configuration will throw errors during `CoreSystem.connect()`.

## Next Steps

- See [API reference](./api-reference.md)
- Check [database schema](./database-schema.md)
- Read [event envelope structure](./event-envelope.md)

