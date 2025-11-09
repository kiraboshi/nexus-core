# Multi-Worker Architecture

> **Note**: This document describes the proposed multi-worker architecture for enhanced mode. For current usage, see [Using Worker-Optional Mode](../how-to/worker-optional-mode.md).

## Overview

This document explains how the nexus-core system can support multiple worker processes while maintaining reliable message delivery, fan-out capabilities, and load balancing.

**Key Design Principle**: nexus-core workers run as **infrastructure services** that handle routing and coordination. Applications use a **simple Client SDK** that abstracts away complexity.

**Worker-Optional Design**: Applications can run in **standalone mode** (no workers) or **enhanced mode** (with workers). See [Worker-Optional Architecture](./worker-optional.md) for details.

**Related Documentation**:
- [Worker-Optional Architecture](./worker-optional.md) - Overview of standalone vs enhanced modes
- [Client SDK Architecture](./client-sdk-architecture.md) - Client SDK API details
- [Using Worker-Optional Mode](../how-to/worker-optional-mode.md) - Usage guide

## Current Architecture (Single Worker)

- **One consumer per worker** reads from a single queue (`core_events_{namespace}`)
- **Central handler registry** routes messages to correct handlers within the worker
- **No cross-worker communication** - each worker is independent

## Multi-Worker Challenges

1. **Message Distribution**: Multiple workers reading from the same queue get round-robin distribution
2. **Fan-Out**: How to deliver a message to handlers in multiple workers
3. **Load Balancing**: How to distribute work across workers efficiently
4. **Reliability**: Ensure messages aren't lost or duplicated

## How pgmq Works

**Important**: `pgmq.send(queueName, message)` sends to **ONE** queue. pgmq does NOT automatically fan-out to multiple queues.

For fan-out, you must:
1. Call `pgmq.send()` **multiple times** - once for each queue
2. The router component handles this logic

## Proposed Architecture

### Option 1: Queue-per-Worker-per-Event-Type (True Fan-Out)

**Concept**: Create separate queues for each worker+event-type combination. Router calls `pgmq.send()` multiple times.

#### Components

1. **Event Router Service**
   - Maintains registry of which workers handle which event types
   - When event is emitted, calls `pgmq.send()` for EACH worker's queue
   - For broadcast: calls `pgmq.send()` for ALL worker queues

2. **Queue Naming Strategy**
   ```
   core_events_{namespace}_{workerId}_{eventType}
   ```
   - Example: `core_events_observability_worker-1_signal.periodic.heartbeat`
   - Each worker only reads from queues with its own workerId

3. **Worker Registration**
   - Workers register their handlers with a central registry (database table)
   - Registry tracks: `worker_id`, `event_type`, `node_id`, `handler_count`

#### Flow

```
Event Emitted via node.emit()
    ↓
CoreNode calls router.routeEvent(envelope)
    ↓
Router checks registry: Which workers handle this event type?
    ↓
Router calls pgmq.send() MULTIPLE times:
  - Normal: pgmq.send(queue_worker1, message)
           pgmq.send(queue_worker2, message)
           pgmq.send(queue_worker3, message)
  - Broadcast: pgmq.send() for ALL worker queues
    ↓
Each worker consumes from queues with its own workerId
    ↓
Single consumer in each worker routes to handlers
```

**Key Point**: The router explicitly calls `pgmq.send()` multiple times - once per queue. pgmq itself doesn't know about fan-out.

#### Implementation

```typescript
// In MultiWorkerRouter.routeEvent()
async routeEvent(envelope: EventEnvelope): Promise<string[]> {
  const route = this.routes.get(envelope.eventType);
  
  // Loop through each worker's queue
  for (const [workerId, queueName] of route.workerQueues.entries()) {
    // Call pgmq.send() for EACH queue
    await this.db.query(`SELECT pgmq.send($1, $2::jsonb)`, [queueName, envelope]);
  }
}

// In CoreNode.emit() - needs to use router
async emit(eventType: string, payload: TPayload): Promise<number> {
  const envelope = { ... };
  
  // Instead of: pgmq.send(defaultQueue, envelope)
  // Use router:
  const queues = await this.system.getRouter().routeEvent(envelope);
  return queues.length; // Return count of queues message was sent to
}
```

**Pros:**
- ✅ True fan-out across workers
- ✅ Works with pgmq's single-queue model
- ✅ Clear separation of concerns
- ✅ Scalable

**Cons:**
- ❌ More queues to manage (one per worker per event type)
- ❌ More database writes (one `pgmq.send()` per worker)
- ❌ Router must be integrated into emit flow

---

### Option 2: Shared Queue with Worker Coordination (NOT Recommended)

**Concept**: All workers read from the same queue, but coordinate via a shared registry.

**Problem**: pgmq distributes round-robin, so this doesn't work for fan-out!

#### Why This Doesn't Work

- `pgmq.read()` gives each message to exactly ONE consumer
- If Worker A reads a message, Worker B won't see it
- For fan-out, we'd need to re-queue messages, causing:
  - Message bouncing between workers
  - Inefficient processing
  - Potential message loss

**Conclusion**: This approach doesn't support true fan-out with pgmq.

---

## Recommended Implementation: Option 1 (Queue-per-Worker-per-Event-Type)

**Architecture**: Two-tier design with nexus-core workers as infrastructure and Client SDK for applications.

### Components

1. **nexus-core Workers** (Infrastructure Layer)
   - Router Service: Routes events to worker queues
   - Registry Service: Tracks worker subscriptions
   - Monitoring Service: Health checks, metrics

2. **Client SDK** (Application Layer)
   - Simple API: `emit()`, `onEvent()`
   - Abstracts routing complexity
   - Communicates with nexus-core workers via API or queue

3. **Application Workers** (Your Code)
   - Use Client SDK
   - No knowledge of routing/queues
   - Just emit events and register handlers

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│         Application Workers (Your Code)                    │
│  - Use nexus-core Client SDK                               │
│  - Simple: node.emit(), node.onEvent()                     │
│  - No knowledge of routing/queues                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Client SDK API
                            │ (HTTP/gRPC or Queue)
                            │
┌─────────────────────────────────────────────────────────────┐
│            nexus-core Client SDK                            │
│  - Abstracts complexity                                     │
│  - Communicates with nexus-core workers                    │
│  - Handles worker registration                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ API or Queue
                            │
┌─────────────────────────────────────────────────────────────┐
│         nexus-core Workers (Infrastructure)                 │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │ Router Service   │  │ Registry Service │              │
│  │ - Routes events  │  │ - Tracks workers │              │
│  │ - Calls pgmq.send│  │ - Manages queues │              │
│  │   multiple times │  │                  │              │
│  └──────────────────┘  └──────────────────┘              │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Direct pgmq operations
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
        ▼                                       ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│ worker-1_signal.*        │    │ worker-2_signal.*        │
│ (pgmq.send called)       │    │ (pgmq.send called)       │
└──────────────────────────┘    └──────────────────────────┘
        │                                       │
        │                                       │
        ▼                                       ▼
┌──────────────────────┐              ┌──────────────────────┐
│   Application        │              │   Application        │
│   Worker 1          │              │   Worker 2          │
│   (via SDK)         │              │   (via SDK)         │
│   - Consumes from   │              │   - Consumes from   │
│     worker-1_*      │              │     worker-2_*      │
│   - Routes to       │              │   - Routes to       │
│     handlers        │              │     handlers        │
└──────────────────────┘              └──────────────────────┘
```

**Key Points**:
1. **nexus-core Workers**: Infrastructure services handle routing and coordination
2. **Client SDK**: Simple API abstracts complexity from applications
3. **Application Workers**: Use SDK, don't know about routing/queues
4. **Router**: Calls `pgmq.send()` MULTIPLE times (once per queue) = true fan-out

### Implementation Steps

1. **Create nexus-core Worker Services**
   - **Router Service**: Routes events to worker queues
   - **Registry Service**: Tracks worker subscriptions
   - **API Server**: Exposes HTTP/gRPC API for Client SDK
   - Run as separate infrastructure processes

2. **Create Client SDK**
   - Simple API: `connect()`, `createNode()`, `node.emit()`, `node.onEvent()`
   - Two modes: API-based (HTTP/gRPC) or Queue-based (direct pgmq)
   - Abstracts routing complexity from applications

3. **Application Workers Use SDK**
   - Applications use Client SDK, not direct CoreSystem
   - SDK handles communication with nexus-core workers
   - SDK automatically registers workers and subscriptions

4. **Router Routes to Worker Queues**
   - Router service calls `pgmq.send()` for each worker that handles the event type
   - Creates fan-out by sending to multiple queues

5. **Workers Consume from Own Queues**
   - Each worker (via SDK) consumes from queues with its own workerId
   - Single consumer per worker routes to handlers

### Code Structure

#### nexus-core Router Service

```typescript
// Router Service (nexus-core infrastructure)
class RouterService {
  async start() {
    // Consume from central queue OR handle API requests
    while (running) {
      // Option 1: Queue-based
      const messages = await pgmq.read(ROUTER_QUEUE);
      for (const msg of messages) {
        await this.routeEvent(msg.envelope);
      }
      
      // Option 2: API-based (HTTP/gRPC)
      // Handled by API server
    }
  }
  
  async routeEvent(envelope: EventEnvelope): Promise<string[]> {
    const route = this.routes.get(envelope.eventType);
    
    // Call pgmq.send() for EACH worker's queue
    for (const [workerId, queueName] of route.workerQueues.entries()) {
      await this.db.query(`SELECT pgmq.send($1, $2::jsonb)`, [queueName, envelope]);
    }
    return Array.from(route.workerQueues.values());
  }
}
```

#### Client SDK (Application-facing)

```typescript
// Client SDK - Simple API for applications
import { NexusCoreClient } from "@reflex/nexus-core/client";

const client = new NexusCoreClient({
  nexusCoreEndpoint: "http://nexus-core:8080", // nexus-core worker API
  workerId: "my-app-worker-1",
  namespace: "observability"
});

await client.connect();

const node = await client.createNode({ nodeId: "enricher-1" });

// Simple API - SDK handles complexity
node.onEvent("signal.periodic.heartbeat", async (event) => {
  // Process event
});

await node.emit("enriched.periodic.heartbeat", { ... });
```

#### SDK Implementation (Internal)

```typescript
// Client SDK implementation
class NexusCoreClient {
  async emit(eventType: string, payload: unknown): Promise<number> {
    // Send to nexus-core router via API
    const response = await this.apiClient.post("/api/v1/events/route", {
      eventType,
      payload,
      namespace: this.namespace
    });
    return response.routedQueues.length;
  }
  
  onEvent(eventType: string, handler: EventHandler): void {
    // Register handler locally
    this.handlers.set(eventType, handler);
    
    // Register subscription with nexus-core registry
    this.apiClient.post(`/api/v1/workers/${this.workerId}/subscribe`, {
      eventTypes: [eventType]
    });
    
    // Start consuming from worker queues
    this.startConsuming();
  }
}
```

### Benefits

- ✅ **True Fan-Out**: Router explicitly sends to multiple queues
- ✅ **Works with pgmq**: Uses pgmq's single-queue model correctly
- ✅ **Scalability**: Add workers without code changes
- ✅ **Reliability**: pgmq handles delivery guarantees per queue

### Considerations

- **Router Service Required**: Must run a centralized nexus-core router service
- **Single Point of Failure**: Router service is critical (can be made HA with multiple instances)
- **Queue Count**: Could create many queues (one per worker per event type)
- **Write Performance**: Multiple `pgmq.send()` calls per event (router does this)
- **Latency**: Extra hop through router (minimal, but adds latency)
- **Monitoring**: Track queue depths, worker subscriptions, router health

## Migration Path

1. **Phase 1**: Implement router component (backward compatible)
2. **Phase 2**: Integrate router into CoreSystem and CoreNode.emit()
3. **Phase 3**: Add worker subscription API
4. **Phase 4**: Migrate to queue-per-worker-per-event-type (opt-in)
5. **Phase 5**: Make it default, deprecate single-queue mode
