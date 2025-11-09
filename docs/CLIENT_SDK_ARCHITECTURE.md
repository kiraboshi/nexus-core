# nexus-core Client SDK Architecture

## Overview

nexus-core operates as a **two-tier architecture**:
1. **nexus-core Workers** (Infrastructure Layer) - Handle routing, coordination, and complex requirements
2. **Client SDK** (Application Layer) - Simple API for applications to emit events and register handlers

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│              Application Workers (Your Code)                │
│  - Use nexus-core Client SDK                                │
│  - Simple API: emit(), onEvent()                            │
│  - No knowledge of routing/queues                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Client SDK API
                            │
┌─────────────────────────────────────────────────────────────┐
│            nexus-core Client SDK                            │
│  - Abstracts complexity                                     │
│  - Communicates with nexus-core workers                    │
│  - Handles worker registration                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP/gRPC API or Queue-based
                            │
┌─────────────────────────────────────────────────────────────┐
│         nexus-core Workers (Infrastructure)                 │
│  - Router Service: Routes events to worker queues          │
│  - Registry Service: Tracks worker subscriptions           │
│  - Queue Management: Creates/manages queues                │
│  - Monitoring: Health checks, metrics                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Direct pgmq operations
                            │
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL + pgmq                       │
│  - Event queues                                            │
│  - Worker registry                                         │
│  - Event log                                               │
└─────────────────────────────────────────────────────────────┘
```

## Client SDK API

### Core Interface

```typescript
// Client SDK - Simple API for applications
interface NexusCoreClient {
  // Connect to nexus-core infrastructure
  connect(options: ClientOptions): Promise<void>;
  
  // Create a node (represents your application component)
  createNode(config?: NodeConfig): Promise<Node>;
  
  // Disconnect
  disconnect(): Promise<void>;
}

interface Node {
  // Emit an event (automatically routed by nexus-core workers)
  emit<T>(eventType: string, payload: T, options?: EmitOptions): Promise<number>;
  
  // Register event handler (automatically registered with nexus-core workers)
  onEvent<T>(eventType: string, handler: EventHandler<T>): void;
  
  // Unregister handler
  offEvent(eventType: string, handler: EventHandler): void;
  
  // Start node (begins consuming events)
  start(): Promise<void>;
  
  // Stop node
  stop(): Promise<void>;
}

interface ClientOptions {
  // Connection to nexus-core workers (HTTP/gRPC endpoint or queue)
  nexusCoreEndpoint?: string;
  
  // Or direct database connection (for queue-based communication)
  databaseUrl?: string;
  
  // Worker identification
  workerId?: string;
  namespace?: string;
  
  // Communication mode
  mode?: "api" | "queue"; // API mode uses HTTP/gRPC, queue mode uses pgmq directly
}
```

### Usage Example

```typescript
// Application code - simple and clean
import { NexusCoreClient } from "@reflex/nexus-core/client";

const client = new NexusCoreClient({
  nexusCoreEndpoint: "http://nexus-core:8080", // nexus-core worker API
  workerId: "my-app-worker-1",
  namespace: "observability",
  mode: "api" // Use API mode (recommended)
});

await client.connect();

const node = await client.createNode({
  nodeId: "enricher-1",
  displayName: "Data Enricher"
});

// Register handler - SDK automatically registers with nexus-core workers
node.onEvent("signal.periodic.heartbeat", async (event, context) => {
  // Process event
  await enrich(event.payload);
  
  // Emit new event - SDK automatically routes through nexus-core workers
  await node.emit("enriched.periodic.heartbeat", { ... });
});

await node.start();
```

## Communication Modes

### Mode 1: API-Based (Recommended)

**How it works:**
- Client SDK communicates with nexus-core workers via HTTP/gRPC API
- nexus-core workers handle all routing and queue management
- Applications don't need direct database access

**Pros:**
- ✅ Simple for applications
- ✅ No database credentials needed
- ✅ Centralized control
- ✅ Easy to add features (auth, rate limiting, etc.)

**Cons:**
- ❌ Extra network hop
- ❌ Requires nexus-core API server

### Mode 2: Queue-Based (Direct)

**How it works:**
- Client SDK communicates directly with PostgreSQL/pgmq
- Still uses nexus-core workers for routing (via shared registry)
- Applications need database access

**Pros:**
- ✅ Lower latency (no API hop)
- ✅ Works offline (if router is running)

**Cons:**
- ❌ Requires database credentials
- ❌ More complex for applications
- ❌ Less centralized control

## nexus-core Worker Services

### 1. Router Service

**Purpose**: Routes events to appropriate worker queues

**Responsibilities:**
- Consumes from router queue
- Maintains worker subscription registry
- Calls `pgmq.send()` for each worker queue
- Handles broadcast events

**API:**
```typescript
// Internal API (used by SDK)
POST /api/v1/events/route
{
  "eventType": "signal.periodic.heartbeat",
  "payload": { ... },
  "broadcast": false
}

// Returns: { routedQueues: ["worker-1_queue", "worker-2_queue"] }
```

### 2. Registry Service

**Purpose**: Tracks worker subscriptions and capabilities

**Responsibilities:**
- Worker registration/deregistration
- Event type subscription management
- Health checks
- Queue creation/management

**API:**
```typescript
// Register worker subscription
POST /api/v1/workers/{workerId}/subscribe
{
  "eventTypes": ["signal.periodic.heartbeat", "enriched.periodic.heartbeat"]
}

// Get worker subscriptions
GET /api/v1/workers/{workerId}/subscriptions

// Health check
GET /api/v1/workers/{workerId}/health
```

### 3. Monitoring Service (Optional)

**Purpose**: Observability and metrics

**Responsibilities:**
- Queue depth monitoring
- Worker health tracking
- Event throughput metrics
- Error tracking

## Client SDK Implementation

### API Mode Implementation

```typescript
class NexusCoreClient {
  private apiClient: ApiClient;
  private workerId: string;
  private namespace: string;
  
  async connect(options: ClientOptions): Promise<void> {
    this.apiClient = new ApiClient(options.nexusCoreEndpoint);
    this.workerId = options.workerId ?? generateWorkerId();
    this.namespace = options.namespace ?? "default";
    
    // Register this worker with nexus-core
    await this.apiClient.post(`/api/v1/workers/${this.workerId}/register`, {
      namespace: this.namespace,
      capabilities: []
    });
  }
  
  async createNode(config?: NodeConfig): Promise<Node> {
    const nodeId = config?.nodeId ?? generateNodeId();
    
    // Register node with nexus-core
    await this.apiClient.post(`/api/v1/workers/${this.workerId}/nodes`, {
      nodeId,
      ...config
    });
    
    return new Node(this.apiClient, this.workerId, nodeId, this.namespace);
  }
}

class Node {
  async emit<T>(eventType: string, payload: T, options?: EmitOptions): Promise<number> {
    // Send to nexus-core router via API
    const response = await this.apiClient.post("/api/v1/events/route", {
      eventType,
      payload,
      broadcast: options?.broadcast ?? false,
      namespace: this.namespace,
      producerNodeId: this.nodeId
    });
    
    return response.routedQueues.length;
  }
  
  onEvent<T>(eventType: string, handler: EventHandler<T>): void {
    // Register handler locally
    this.handlers.set(eventType, handler);
    
    // Register subscription with nexus-core
    this.apiClient.post(`/api/v1/workers/${this.workerId}/subscribe`, {
      eventTypes: [eventType]
    });
    
    // Start consuming if not already started
    if (!this.consuming) {
      this.startConsuming();
    }
  }
  
  private async startConsuming(): Promise<void> {
    // Get queues for this worker
    const queues = await this.apiClient.get(
      `/api/v1/workers/${this.workerId}/queues`
    );
    
    // Consume from worker-specific queues
    for (const queueName of queues) {
      this.consumeFromQueue(queueName);
    }
  }
}
```

### Queue Mode Implementation

```typescript
class NexusCoreClient {
  private db: CoreDatabase;
  private router: MultiWorkerRouter;
  private workerId: string;
  
  async connect(options: ClientOptions): Promise<void> {
    this.db = await CoreDatabase.connect(options.databaseUrl);
    this.workerId = options.workerId ?? generateWorkerId();
    
    // Create router instance (shared with nexus-core workers)
    this.router = new MultiWorkerRouter(this.db, logger, options.namespace);
    
    // Register worker with router
    // (This updates shared registry that nexus-core workers also use)
    await this.router.subscribeWorker(this.workerId, []);
  }
  
  async createNode(config?: NodeConfig): Promise<Node> {
    const nodeId = config?.nodeId ?? generateNodeId();
    return new Node(this.db, this.router, this.workerId, nodeId);
  }
}

class Node {
  async emit<T>(eventType: string, payload: T, options?: EmitOptions): Promise<number> {
    const envelope = { eventType, payload, ... };
    
    // Send to router queue (nexus-core router service will pick it up)
    await this.db.query(
      `SELECT pgmq.send($1, $2::jsonb)`,
      ["core_router_events", envelope]
    );
    
    return 1;
  }
  
  onEvent<T>(eventType: string, handler: EventHandler<T>): void {
    // Register handler locally
    this.handlers.set(eventType, handler);
    
    // Update router subscription (shared registry)
    this.router.subscribeWorker(this.workerId, [eventType]);
    
    // Start consuming from worker queues
    this.startConsuming();
  }
  
  private async startConsuming(): Promise<void> {
    // Get queues for this worker from router
    const queues = this.router.getQueuesForWorker(this.workerId);
    
    // Consume from worker-specific queues
    for (const queueName of queues) {
      this.consumeFromQueue(queueName);
    }
  }
}
```

## Benefits of This Architecture

### For Applications

- ✅ **Simple API**: Just `emit()` and `onEvent()`
- ✅ **No Infrastructure Knowledge**: Don't need to know about queues, routing, etc.
- ✅ **Automatic Routing**: nexus-core workers handle all routing
- ✅ **Scalability**: Add workers without code changes

### For Infrastructure

- ✅ **Centralized Control**: All routing logic in nexus-core workers
- ✅ **Observability**: Can monitor all events and workers
- ✅ **Flexibility**: Can add features (auth, rate limiting, etc.) without changing SDK
- ✅ **Upgradeability**: Update nexus-core workers independently

## Deployment Model

```
┌─────────────────────────────────────────────────────────────┐
│         Kubernetes / Docker Compose / etc.                  │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │ nexus-core       │  │ nexus-core       │              │
│  │ Router Service   │  │ Registry Service │              │
│  │ (3 replicas)     │  │ (2 replicas)     │              │
│  └──────────────────┘  └──────────────────┘              │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │ Your App         │  │ Your App         │              │
│  │ Worker 1         │  │ Worker 2         │              │
│  │ (uses SDK)       │  │ (uses SDK)       │              │
│  └──────────────────┘  └──────────────────┘              │
│                                                             │
│  ┌──────────────────────────────────────────┐              │
│  │ PostgreSQL + pgmq                        │              │
│  └──────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

## Migration Path

1. **Phase 1**: Implement nexus-core worker services (Router, Registry)
2. **Phase 2**: Create Client SDK with API mode
3. **Phase 3**: Add queue mode for direct database access
4. **Phase 4**: Migrate applications to use SDK
5. **Phase 5**: Deprecate direct CoreSystem usage

