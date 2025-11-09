# Using Worker-Optional Mode

nexus-core supports two modes: **standalone** (default) and **enhanced** (with workers). This guide explains how to use each mode and when to choose which.

## Modes Overview

### Standalone Mode (Default)

- **No external dependencies**: Works with just PostgreSQL
- **Single worker**: One consumer per application instance
- **Round-robin distribution**: Messages distributed across instances
- **Simple deployment**: Just run your application

### Enhanced Mode (With Workers)

- **Multiple workers**: True fan-out and load balancing
- **Broadcast support**: Events can be broadcast to all handlers
- **Worker coordination**: Centralized routing and coordination
- **Requires nexus-core workers**: Additional infrastructure component

## Standalone Mode

### Basic Usage

```typescript
import { CoreSystem } from "@nexus-core/core";

// Standalone mode (default)
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp"
  // enableWorkers not set or false = standalone mode
});

const node = await system.registerNode({ displayName: "My Node" });
await node.start();

// Emit events
await node.emit("user.created", { userId: "123" });

// Handle events
node.onEvent("user.created", async (event) => {
  console.log("Received:", event.payload);
});
```

### Explicit Standalone Mode

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp",
  enableWorkers: false  // Explicitly disable workers
});
```

### When to Use Standalone Mode

- ✅ Simple applications
- ✅ Single or few instances
- ✅ No need for broadcast events
- ✅ Minimal infrastructure
- ✅ Getting started / prototyping

## Enhanced Mode

### Basic Usage

```typescript
import { CoreSystem } from "@nexus-core/core";

// Enhanced mode (with workers)
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp",
  enableWorkers: true,  // Enable enhanced mode
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API || "http://nexus-workers:8080"
});

const node = await system.registerNode({ displayName: "My Node" });
await node.start();

// Same API works in both modes
await node.emit("user.created", { userId: "123" });
node.onEvent("user.created", async (event) => {
  console.log("Received:", event.payload);
});
```

### Broadcast Events (Enhanced Mode Only)

```typescript
// Broadcast event - delivered to ALL handlers across ALL nodes
await node.emit("system.shutdown", { reason: "maintenance" }, { broadcast: true });
```

**Note**: In standalone mode, `broadcast: true` is ignored and falls back to normal emission.

### When to Use Enhanced Mode

- ✅ Multiple worker instances
- ✅ Need broadcast events
- ✅ Complex routing requirements
- ✅ High-scale applications
- ✅ Worker coordination needed

## Auto-Detection Mode

Automatically detect if workers are available:

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp",
  autoDetectWorkers: true,  // Auto-detect workers
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API  // Optional fallback
});

// Uses enhanced mode if workers available, standalone otherwise
const node = await system.registerNode({ displayName: "My Node" });
await node.start();
```

**Benefits**:
- ✅ Graceful degradation
- ✅ No code changes needed
- ✅ Works in both environments

## Configuration Options

### CoreOptions

```typescript
interface CoreOptions {
  // Required
  connectionString: string;
  namespace: string;
  
  // Worker mode options
  enableWorkers?: boolean;        // Explicitly enable/disable
  workerApiEndpoint?: string;     // Worker API endpoint (required if enableWorkers: true)
  workerId?: string;              // Worker ID (auto-generated if not provided)
  autoDetectWorkers?: boolean;    // Auto-detect worker availability
  
  // Other options...
  logger?: CoreLogger;
  idlePollIntervalMs?: number;
  visibilityTimeoutSeconds?: number;
  batchSize?: number;
}
```

### Environment Variables

```env
# Required
CORE_DATABASE_URL=postgres://user:pass@host:5432/core
CORE_NAMESPACE=myapp

# Worker mode (optional)
CORE_ENABLE_WORKERS=true
CORE_WORKER_API_ENDPOINT=http://nexus-workers:8080
CORE_WORKER_ID=my-app-worker-1
CORE_AUTO_DETECT_WORKERS=true
```

## Checking Current Mode

```typescript
const system = await CoreSystem.connect({ ... });

// Check if enhanced mode is enabled
if (system.isWorkerModeEnabled()) {
  console.log("Running in enhanced mode");
} else {
  console.log("Running in standalone mode");
}
```

## Migration Guide

### From Standalone to Enhanced

1. **Deploy nexus-core workers** (infrastructure layer)

2. **Update configuration**:
   ```typescript
   // Before
   const system = await CoreSystem.connect({
     connectionString: process.env.CORE_DATABASE_URL!,
     namespace: "myapp"
   });
   
   // After
   const system = await CoreSystem.connect({
     connectionString: process.env.CORE_DATABASE_URL!,
     namespace: "myapp",
     enableWorkers: true,
     workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API
   });
   ```

3. **No code changes needed**: Same API works in both modes

### From Enhanced to Standalone

1. **Update configuration**:
   ```typescript
   // Before
   const system = await CoreSystem.connect({
     connectionString: process.env.CORE_DATABASE_URL!,
     namespace: "myapp",
     enableWorkers: true,
     workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API
   });
   
   // After
   const system = await CoreSystem.connect({
     connectionString: process.env.CORE_DATABASE_URL!,
     namespace: "myapp",
     enableWorkers: false  // Or remove enableWorkers
   });
   ```

2. **Remove broadcast events**: Broadcast events won't work in standalone mode

## Feature Comparison

| Feature | Standalone Mode | Enhanced Mode |
|---------|----------------|---------------|
| Single worker | ✅ | ✅ |
| Multiple workers | ⚠️ (round-robin) | ✅ (true fan-out) |
| Broadcast events | ❌ | ✅ |
| Worker coordination | ❌ | ✅ |
| Load balancing | ⚠️ (basic) | ✅ (advanced) |
| External dependencies | None | nexus-core workers |
| Deployment complexity | Low | Medium |
| Infrastructure cost | Low | Medium |

## Best Practices

1. **Start with standalone**: Use standalone mode for simple applications
2. **Upgrade when needed**: Migrate to enhanced mode when you need features
3. **Use auto-detection**: Use `autoDetectWorkers` for flexibility
4. **Monitor mode**: Log which mode is active for debugging
5. **Test both modes**: Ensure your code works in both modes

## Troubleshooting

### "Worker features not enabled"

**Cause**: Trying to use enhanced features in standalone mode.

**Solution**: Enable workers or use standalone-compatible features.

### "workerApiEndpoint required"

**Cause**: `enableWorkers: true` but no endpoint provided.

**Solution**: Provide `workerApiEndpoint` or set `enableWorkers: false`.

### Broadcast events not working

**Cause**: Running in standalone mode.

**Solution**: Enable enhanced mode or remove broadcast usage.

## Next Steps

- Read [worker-optional architecture](../explanation/worker-optional.md)
- See [multi-worker architecture](../explanation/multi-worker-architecture.md)
- Check [API reference](../reference/api-reference.md)

