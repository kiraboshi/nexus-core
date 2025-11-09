# Using Worker-Optional Architecture

## Quick Start

### Standalone Mode (Default - No Workers Required)

```typescript
import { CoreSystem } from "@reflex/nexus-core";

// Works without any nexus-core workers
const system = await CoreSystem.connect({
  connectionString: process.env.DATABASE_URL,
  namespace: "myapp"
});

const node = await system.registerNode({ nodeId: "worker-1" });

node.onEvent("signal.heartbeat", async (event) => {
  // Process event
});

await node.emit("processed.heartbeat", { ... });
await node.start();
```

**Benefits:**
- ✅ No external dependencies
- ✅ Simple deployment
- ✅ Works for single-worker scenarios

**Limitations:**
- ❌ No fan-out across multiple workers
- ❌ Round-robin distribution (messages may go to wrong worker)

### Enhanced Mode (With Workers)

```typescript
import { CoreSystem } from "@reflex/nexus-core";

// Enable enhanced features via nexus-core workers
const system = await CoreSystem.connect({
  connectionString: process.env.DATABASE_URL,
  namespace: "myapp",
  enableWorkers: true,
  workerApiEndpoint: "http://nexus-core:8080",
  workerId: "my-app-worker-1"
});

const node = await system.registerNode({ nodeId: "worker-1" });

node.onEvent("signal.heartbeat", async (event) => {
  // Process event
});

// Broadcast works in enhanced mode
await node.emit("system.shutdown", { reason: "maintenance" }, { broadcast: true });
await node.start();
```

**Benefits:**
- ✅ True fan-out across workers
- ✅ Efficient routing
- ✅ Multi-worker coordination
- ✅ Broadcast support

**Requirements:**
- ❌ Requires nexus-core workers running
- ❌ More complex deployment

### Auto-Detection Mode

```typescript
import { CoreSystem } from "@reflex/nexus-core";

// Automatically detect if workers are available
const system = await CoreSystem.connect({
  connectionString: process.env.DATABASE_URL,
  namespace: "myapp",
  autoDetectWorkers: true,
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API // Optional fallback
});

// Uses enhanced mode if workers available, standalone otherwise
const node = await system.registerNode({ nodeId: "worker-1" });
// ... same API works in both modes
```

**Benefits:**
- ✅ Best of both worlds
- ✅ Graceful degradation
- ✅ No code changes needed

## Configuration Options

### CoreOptions

```typescript
interface CoreOptions {
  // Required
  connectionString: string;
  namespace: string;
  
  // Optional - Worker features
  enableWorkers?: boolean;           // Explicitly enable/disable workers
  workerApiEndpoint?: string;        // nexus-core worker API endpoint
  workerId?: string;                 // Worker ID (auto-generated if not provided)
  autoDetectWorkers?: boolean;       // Auto-detect worker availability
  
  // Other options...
  logger?: CoreLogger;
  idlePollIntervalMs?: number;
  visibilityTimeoutSeconds?: number;
  batchSize?: number;
}
```

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@localhost/db

# Optional - Worker features
NEXUS_CORE_ENABLE_WORKERS=true
NEXUS_CORE_WORKER_API=http://nexus-core:8080
NEXUS_CORE_WORKER_ID=my-app-worker-1
NEXUS_CORE_AUTO_DETECT_WORKERS=true
```

## Feature Comparison

| Feature | Standalone Mode | Enhanced Mode |
|---------|----------------|---------------|
| Single worker | ✅ | ✅ |
| Multiple workers | ⚠️ (round-robin) | ✅ (true fan-out) |
| Broadcast events | ❌ | ✅ |
| Worker coordination | ❌ | ✅ |
| Load balancing | ⚠️ (basic) | ✅ (advanced) |
| Deployment complexity | Low | Medium |
| External dependencies | None | nexus-core workers |

## Migration Guide

### From Standalone to Enhanced

1. **Deploy nexus-core workers** (infrastructure)
2. **Update configuration**:
   ```typescript
   // Before
   const system = await CoreSystem.connect({
     connectionString: process.env.DATABASE_URL,
     namespace: "myapp"
   });
   
   // After
   const system = await CoreSystem.connect({
     connectionString: process.env.DATABASE_URL,
     namespace: "myapp",
     enableWorkers: true,
     workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API
   });
   ```
3. **No code changes needed** - same API works in both modes

### Using Auto-Detection

For applications that should use workers if available, but work without them:

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.DATABASE_URL,
  namespace: "myapp",
  autoDetectWorkers: true,
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API
});

// Check mode if needed
if (system.isWorkerModeEnabled()) {
  console.log("Using enhanced mode with workers");
} else {
  console.log("Using standalone mode");
}
```

## Best Practices

1. **Start with Standalone**: Develop and test without workers first
2. **Enable When Needed**: Add worker support when scaling to multiple workers
3. **Use Auto-Detection**: For applications that should work in both modes
4. **Monitor Mode**: Log which mode is active for debugging

## Troubleshooting

### Workers Not Detected

If `autoDetectWorkers: true` but workers aren't detected:

1. Check `workerApiEndpoint` is correct
2. Verify nexus-core workers are running
3. Check network connectivity
4. Review logs for detection errors

### Broadcast Not Working

If broadcast events aren't working:

1. Verify `enableWorkers: true` is set
2. Check workers are running and healthy
3. Ensure `broadcast: true` option is passed to `emit()`

### Worker Registration Fails

If worker registration fails:

1. Verify `workerApiEndpoint` is accessible
2. Check worker API is responding to `/health`
3. Review worker logs for errors
4. Ensure worker ID is unique

