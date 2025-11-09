# Worker-Optional Architecture

## Overview

nexus-core supports **two operational modes**:
1. **Standalone Mode** (Default): Works without nexus-core workers - direct CoreSystem usage
2. **Enhanced Mode** (Optional): Uses nexus-core workers for advanced features (fan-out, multi-worker coordination)

Applications can run in standalone mode and opt-in to enhanced features when workers are available.

## Design Principles

1. **Backward Compatible**: Existing code works without changes
2. **Graceful Degradation**: Works without workers, enhanced with workers
3. **Opt-In Enhancement**: Explicitly enable worker features when needed
4. **Auto-Detection**: Can detect if workers are available

## Architecture Modes

### Standalone Mode (Default)

```
┌─────────────────────────────────────────────────────────────┐
│              Application Worker                             │
│  - Uses CoreSystem directly                                 │
│  - Single consumer per worker                               │
│  - Routes to handlers within worker                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Direct pgmq operations
                            │
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL + pgmq                        │
│  - Single queue: core_events_{namespace}                   │
│  - All workers read from same queue                        │
└─────────────────────────────────────────────────────────────┘
```

**Characteristics:**
- ✅ No external dependencies (no nexus-core workers needed)
- ✅ Simple deployment (just your app + database)
- ✅ Works for single-worker scenarios
- ❌ No fan-out across workers
- ❌ Round-robin distribution (messages may go to wrong worker)

### Enhanced Mode (With Workers)

```
┌─────────────────────────────────────────────────────────────┐
│              Application Worker                             │
│  - Uses CoreSystem with worker features enabled            │
│  - Communicates with nexus-core workers                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ API or Queue
                            │
┌─────────────────────────────────────────────────────────────┐
│         nexus-core Workers (Infrastructure)                 │
│  - Router Service: Routes events                           │
│  - Registry Service: Tracks subscriptions                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Direct pgmq operations
                            │
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL + pgmq                        │
│  - Worker-specific queues                                  │
│  - True fan-out support                                    │
└─────────────────────────────────────────────────────────────┘
```

**Characteristics:**
- ✅ True fan-out across workers
- ✅ Efficient routing
- ✅ Multi-worker coordination
- ❌ Requires nexus-core workers running
- ❌ More complex deployment

## Implementation Strategy

### CoreSystem Modes

```typescript
interface CoreOptions {
  // ... existing options ...
  
  /** Enable enhanced features via nexus-core workers */
  enableWorkers?: boolean;
  
  /** nexus-core worker API endpoint (for enhanced mode) */
  workerApiEndpoint?: string;
  
  /** Worker ID for this application instance */
  workerId?: string;
  
  /** Auto-detect if workers are available */
  autoDetectWorkers?: boolean;
}
```

### Mode Detection

```typescript
class CoreSystem {
  private workerMode: "standalone" | "enhanced" | "auto";
  private workerClient?: WorkerClient;
  
  static async connect(options: CoreOptions): Promise<CoreSystem> {
    const system = new CoreSystem(options, ...);
    
    // Determine mode
    if (options.enableWorkers === true) {
      system.workerMode = "enhanced";
      await system.enableWorkerFeatures();
    } else if (options.enableWorkers === false) {
      system.workerMode = "standalone";
    } else if (options.autoDetectWorkers) {
      system.workerMode = "auto";
      await system.detectWorkerAvailability();
    } else {
      system.workerMode = "standalone"; // Default
    }
    
    return system;
  }
  
  private async detectWorkerAvailability(): Promise<void> {
    // Try to connect to worker API
    try {
      const client = new WorkerClient(this.options.workerApiEndpoint);
      const available = await client.healthCheck();
      
      if (available) {
        this.workerMode = "enhanced";
        await this.enableWorkerFeatures();
      } else {
        this.workerMode = "standalone";
      }
    } catch {
      this.workerMode = "standalone";
    }
  }
  
  private async enableWorkerFeatures(): Promise<void> {
    // Register with worker registry
    // Set up worker-specific queues
    // Enable fan-out capabilities
  }
}
```

### CoreNode Behavior

```typescript
class CoreNode {
  async emit(eventType: string, payload: unknown, options?: EmitOptions): Promise<number> {
    const envelope = { ... };
    
    if (this.system.isWorkerModeEnabled()) {
      // Enhanced mode: Route via workers
      return await this.system.getWorkerClient().routeEvent(envelope);
    } else {
      // Standalone mode: Direct queue send
      return await this.system.sendToQueue(envelope);
    }
  }
  
  onEvent(eventType: string, handler: EventHandler): void {
    // Register handler locally
    this.handlers.set(eventType, handler);
    
    if (this.system.isWorkerModeEnabled()) {
      // Enhanced mode: Register with worker registry
      await this.system.getWorkerClient().subscribe(eventType);
    }
    
    // Start consuming (mode-specific)
    this.startConsuming();
  }
  
  private async startConsuming(): Promise<void> {
    if (this.system.isWorkerModeEnabled()) {
      // Enhanced mode: Consume from worker-specific queues
      const queues = await this.system.getWorkerClient().getQueuesForWorker();
      await this.consumeFromQueues(queues);
    } else {
      // Standalone mode: Consume from default queue
      await this.consumeFromQueue(this.system.getQueueName());
    }
  }
}
```

## Feature Matrix

| Feature | Standalone Mode | Enhanced Mode |
|---------|----------------|---------------|
| Single worker | ✅ | ✅ |
| Multiple workers | ⚠️ (round-robin) | ✅ (true fan-out) |
| Broadcast events | ❌ | ✅ |
| Worker coordination | ❌ | ✅ |
| Load balancing | ⚠️ (basic) | ✅ (advanced) |
| Deployment complexity | Low | Medium |
| External dependencies | None | nexus-core workers |

## Usage Examples

### Standalone Mode (Default)

```typescript
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

### Enhanced Mode (Explicit)

```typescript
// Explicitly enable worker features
const system = await CoreSystem.connect({
  connectionString: process.env.DATABASE_URL,
  namespace: "myapp",
  enableWorkers: true,
  workerApiEndpoint: "http://nexus-core:8080",
  workerId: "my-app-worker-1"
});

// Same API, but with enhanced features
const node = await system.registerNode({ nodeId: "worker-1" });

node.onEvent("signal.heartbeat", async (event) => {
  // Process event
});

// Broadcast works in enhanced mode
await node.emit("system.shutdown", { reason: "maintenance" }, { broadcast: true });
await node.start();
```

### Auto-Detection Mode

```typescript
// Automatically detect if workers are available
const system = await CoreSystem.connect({
  connectionString: process.env.DATABASE_URL,
  namespace: "myapp",
  autoDetectWorkers: true,
  workerApiEndpoint: "http://nexus-core:8080" // Optional fallback
});

// Uses enhanced mode if workers available, standalone otherwise
const node = await system.registerNode({ nodeId: "worker-1" });
// ... same API works in both modes
```

## Migration Path

### For Existing Applications

1. **No Changes Required**: Existing code works in standalone mode
2. **Opt-In Enhancement**: Add `enableWorkers: true` when ready
3. **Gradual Migration**: Can run mixed (some workers enhanced, some standalone)

### For New Applications

1. **Start Standalone**: Develop and test without workers
2. **Enable When Needed**: Add worker support when scaling
3. **Use Auto-Detection**: Let system choose best mode

## Implementation Details

### Worker Client Abstraction

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

class ApiWorkerClient implements WorkerClient {
  constructor(private apiEndpoint: string) {}
  
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiEndpoint}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
  
  async routeEvent(envelope: EventEnvelope): Promise<string[]> {
    const response = await fetch(`${this.apiEndpoint}/api/v1/events/route`, {
      method: "POST",
      body: JSON.stringify(envelope)
    });
    const data = await response.json();
    return data.routedQueues;
  }
  
  // ... other methods
}

class QueueWorkerClient implements WorkerClient {
  // Direct queue-based communication
  // Uses shared registry in database
}
```

### CoreSystem Integration

```typescript
class CoreSystem {
  private workerClient?: WorkerClient;
  private workerMode: "standalone" | "enhanced" = "standalone";
  
  isWorkerModeEnabled(): boolean {
    return this.workerMode === "enhanced" && this.workerClient !== undefined;
  }
  
  getWorkerClient(): WorkerClient {
    if (!this.workerClient) {
      throw new Error("Worker features not enabled");
    }
    return this.workerClient;
  }
  
  async enableWorkerFeatures(): Promise<void> {
    if (this.options.workerApiEndpoint) {
      this.workerClient = new ApiWorkerClient(this.options.workerApiEndpoint);
    } else if (this.options.databaseUrl) {
      this.workerClient = new QueueWorkerClient(this.db);
    } else {
      throw new Error("Worker endpoint or database URL required");
    }
    
    // Register worker
    await this.workerClient.registerWorker(this.options.workerId);
    
    this.workerMode = "enhanced";
  }
  
  async sendToQueue(envelope: EventEnvelope): Promise<number> {
    if (this.isWorkerModeEnabled()) {
      // Enhanced mode: Route via workers
      const queues = await this.workerClient!.routeEvent(envelope);
      return queues.length;
    } else {
      // Standalone mode: Direct send
      const { rows } = await this.db.query(
        `SELECT pgmq.send($1, $2::jsonb)`,
        [this.queueName, envelope]
      );
      return rows[0]?.send ?? 0;
    }
  }
}
```

## Benefits

### For Applications

- ✅ **Flexibility**: Choose mode based on needs
- ✅ **Simplicity**: Start simple, enhance when needed
- ✅ **Compatibility**: Existing code works without changes
- ✅ **Gradual Migration**: Enable features incrementally

### For Infrastructure

- ✅ **Optional Dependency**: Workers are optional, not required
- ✅ **Backward Compatible**: Existing deployments continue working
- ✅ **Progressive Enhancement**: Can add workers to existing systems

## Configuration Examples

### Environment-Based

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

### Feature Flags

```typescript
// Enable worker features via feature flag
const system = await CoreSystem.connect({
  connectionString: process.env.DATABASE_URL,
  namespace: "myapp",
  enableWorkers: featureFlags.isEnabled("nexus-core-workers"),
  workerApiEndpoint: process.env.NEXUS_CORE_WORKER_API
});
```

