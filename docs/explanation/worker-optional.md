# Worker-Optional Architecture

This document explains the worker-optional architecture that allows nexus-core to work in both standalone and enhanced modes.

## Two Modes

nexus-core supports two operational modes:

### Standalone Mode (Default)

- **No external dependencies**: Works with just PostgreSQL
- **Single consumer**: One consumer per application instance
- **Round-robin distribution**: Messages distributed across instances
- **Simple deployment**: Just run your application

### Enhanced Mode (With Workers)

- **Multiple workers**: True fan-out and load balancing
- **Broadcast support**: Events can be broadcast to all handlers
- **Worker coordination**: Centralized routing and coordination
- **Requires nexus-core workers**: Additional infrastructure component

## Architecture Comparison

### Standalone Mode

```
┌─────────────────────────────────────────┐
│         Application Instance 1          │
│  ┌──────────────┐  ┌──────────────┐   │
│  │   CoreNode   │  │   Consumer   │   │
│  │              │──▶│   Loop       │   │
│  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────┘
           │                    │
           │ emit()             │ consume()
           ▼                    ▼
┌─────────────────────────────────────────┐
│      PostgreSQL Queue                   │
│      core_events_myapp                  │
│      (Round-robin distribution)         │
└─────────────────────────────────────────┘
           ▲                    ▲
           │                    │
┌─────────────────────────────────────────┐
│         Application Instance 2          │
│  ┌──────────────┐  ┌──────────────┐   │
│  │   CoreNode   │  │   Consumer   │   │
│  │              │──▶│   Loop       │   │
│  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────┘
```

**Characteristics**:
- Each instance has its own consumer
- Messages distributed round-robin
- No cross-instance coordination
- Simple and reliable

### Enhanced Mode

```
┌─────────────────────────────────────────┐
│         Application Instance 1          │
│  ┌──────────────┐                      │
│  │   CoreNode   │                      │
│  │  (Client SDK)│                      │
│  └──────┬───────┘                      │
└─────────┼──────────────────────────────┘
          │ HTTP/gRPC
          ▼
┌─────────────────────────────────────────┐
│      nexus-core Workers                 │
│  ┌──────────────┐  ┌──────────────┐   │
│  │   Router      │  │   Consumer   │   │
│  │   (Fan-out)   │──▶│   Pool       │   │
│  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────┘
          │                    │
          │ route()            │ consume()
          ▼                    ▼
┌─────────────────────────────────────────┐
│      PostgreSQL Queues                 │
│  ┌──────────────┐  ┌──────────────┐   │
│  │ Queue 1      │  │ Queue 2      │   │
│  │ (Worker 1)   │  │ (Worker 2)   │   │
│  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────┘
```

**Characteristics**:
- Centralized routing and coordination
- True fan-out to multiple workers
- Broadcast event support
- Advanced load balancing

## Mode Selection

### Automatic Selection

```typescript
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp",
  autoDetectWorkers: true,  // Auto-detect
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API
});

// Uses enhanced mode if workers available, standalone otherwise
```

### Explicit Selection

```typescript
// Standalone mode
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp",
  enableWorkers: false  // Explicit standalone
});

// Enhanced mode
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp",
  enableWorkers: true,  // Explicit enhanced
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API!
});
```

## API Compatibility

**The same API works in both modes**:

```typescript
// Same code works in both modes
const node = await system.registerNode({ displayName: "My Node" });

await node.emit("user.created", { userId: "123" });

node.onEvent("user.created", async (event) => {
  console.log("Received:", event.payload);
});

await node.start();
```

**Mode-specific features**:
- Broadcast events (enhanced mode only)
- Worker coordination (enhanced mode only)
- Advanced routing (enhanced mode only)

## Feature Comparison

| Feature | Standalone | Enhanced |
|---------|-----------|----------|
| Single consumer | ✅ | ✅ |
| Multiple consumers | ⚠️ (round-robin) | ✅ (true fan-out) |
| Broadcast events | ❌ | ✅ |
| Worker coordination | ❌ | ✅ |
| Load balancing | ⚠️ (basic) | ✅ (advanced) |
| External dependencies | None | nexus-core workers |
| Deployment complexity | Low | Medium |
| Infrastructure cost | Low | Medium |

## When to Use Each Mode

### Use Standalone Mode When:

- ✅ Simple applications
- ✅ Single or few instances
- ✅ No need for broadcast events
- ✅ Minimal infrastructure
- ✅ Getting started / prototyping

### Use Enhanced Mode When:

- ✅ Multiple worker instances
- ✅ Need broadcast events
- ✅ Complex routing requirements
- ✅ High-scale applications
- ✅ Worker coordination needed

## Migration Path

### From Standalone to Enhanced

1. **Deploy nexus-core workers** (infrastructure layer)
2. **Update configuration**: Add `enableWorkers: true` and `workerApiEndpoint`
3. **No code changes needed**: Same API works in both modes

### From Enhanced to Standalone

1. **Update configuration**: Set `enableWorkers: false` or remove worker options
2. **Remove broadcast usage**: Broadcast events won't work in standalone mode
3. **No code changes needed**: Same API works in both modes

## Benefits of Worker-Optional Design

### For Developers

- ✅ **Simple API**: Same API regardless of mode
- ✅ **Flexibility**: Choose mode based on needs
- ✅ **Gradual Migration**: Start simple, upgrade when needed
- ✅ **No Lock-in**: Can switch modes without code changes

### For Operations

- ✅ **Deployment Flexibility**: Deploy with or without workers
- ✅ **Cost Optimization**: Use standalone for simple cases
- ✅ **Scalability**: Upgrade to enhanced mode when needed
- ✅ **Reliability**: Standalone mode has fewer moving parts

## Implementation Details

### Standalone Mode Implementation

```typescript
// Direct queue operations
await pgmq.send(queueName, envelope);
const messages = await pgmq.read(queueName, vt, batchSize);
```

### Enhanced Mode Implementation

```typescript
// Route via workers
await workerClient.routeEvent(envelope);
// Workers handle queue operations
```

### Worker Client Abstraction

The enhanced mode uses a `WorkerClient` abstraction:

```typescript
interface WorkerClient {
  // Check if workers are available
  healthCheck(): Promise<boolean>;
  
  // Route event (enhanced mode)
  routeEvent(envelope: EventEnvelope): Promise<string[]>;
  
  // Register subscription
  subscribe(eventType: string): Promise<void>;
  
  // Get queues for this worker
  getQueuesForWorker(): Promise<string[]>;
}
```

### Configuration Examples

**Environment-Based:**
```typescript
// .env
NEXUS_CORE_WORKER_API=http://nexus-core:8080
NEXUS_CORE_WORKER_ID=my-app-worker-1
NEXUS_CORE_ENABLE_WORKERS=true

// Code
const system = await CoreSystem.connect({
  connectionString: process.env.DATABASE_URL,
  namespace: "myapp",
  enableWorkers: process.env.NEXUS_CORE_ENABLE_WORKERS === "true",
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API,
  workerId: process.env.NEXUS_CORE_WORKER_ID
});
```

**Feature Flags:**
```typescript
// Enable worker features via feature flag
const system = await CoreSystem.connect({
  connectionString: process.env.DATABASE_URL,
  namespace: "myapp",
  enableWorkers: featureFlags.isEnabled("nexus-core-workers"),
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API
});
```

## Summary

The worker-optional architecture provides:

- ✅ **Flexibility**: Choose the right mode for your needs
- ✅ **Simplicity**: Same API in both modes
- ✅ **Scalability**: Upgrade path from standalone to enhanced
- ✅ **Reliability**: Standalone mode has fewer dependencies

This design allows you to start simple and scale up as needed, without changing your application code.

## Related Documentation

- [Using Worker-Optional Mode](../how-to/worker-optional-mode.md) - How-to guide for using both modes
- [Multi-Worker Architecture](./multi-worker-architecture.md) - Detailed multi-worker architecture proposal
- [Client SDK Architecture](./client-sdk-architecture.md) - Client SDK architecture for enhanced mode
- [Architecture Overview](./architecture.md) - General system architecture

## Next Steps

- Learn about [using worker-optional mode](../how-to/worker-optional-mode.md)
- Understand [multi-worker architecture](./multi-worker-architecture.md)
- Read [client SDK architecture](./client-sdk-architecture.md)

