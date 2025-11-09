# How to Emit Events

This guide explains how to emit events in nexus-core. Events are the primary mechanism for communication between nodes in the system.

## Basic Event Emission

The simplest way to emit an event:

```typescript
import { CoreSystem } from "@nexus-core/core";

const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp"
});

const node = await system.registerNode({
  displayName: "My Node"
});

await node.start();

// Emit an event
const messageId = await node.emit("user.created", {
  userId: "123",
  email: "user@example.com"
});

console.log(`Event emitted with message ID: ${messageId}`);
```

## Event Structure

When you call `node.emit()`, nexus-core creates an `EventEnvelope`:

```typescript
interface EventEnvelope {
  namespace: string;           // From system configuration
  eventType: string;           // First parameter to emit()
  payload: unknown;            // Second parameter to emit()
  emittedAt: string;           // ISO timestamp (auto-generated)
  producerNodeId: string;       // Your node's ID (auto-generated)
  messageId?: number;           // pgmq message ID (returned)
  redeliveryCount?: number;     // Set during consumption
  broadcast?: boolean;          // Optional broadcast flag
}
```

## Event Types

Event types are strings that identify the kind of event. Use a consistent naming convention:

```typescript
// Good: Hierarchical naming
await node.emit("user.created", { ... });
await node.emit("user.updated", { ... });
await node.emit("user.deleted", { ... });

await node.emit("order.placed", { ... });
await node.emit("order.shipped", { ... });
await node.emit("order.delivered", { ... });

// Good: Domain-based naming
await node.emit("payment.processed", { ... });
await node.emit("inventory.low_stock", { ... });
await node.emit("notification.sent", { ... });
```

**Best Practices**:
- Use dot notation for hierarchy (`domain.action`)
- Use lowercase with underscores or dots
- Be consistent across your application
- Document your event types

## Event Payloads

The payload can be any serializable data:

```typescript
// Simple object
await node.emit("user.created", {
  userId: "123",
  email: "user@example.com",
  name: "John Doe"
});

// Nested objects
await node.emit("order.placed", {
  orderId: "ord-123",
  customer: {
    id: "cust-456",
    email: "customer@example.com"
  },
  items: [
    { productId: "prod-1", quantity: 2 },
    { productId: "prod-2", quantity: 1 }
  ],
  total: 99.99
});

// Arrays
await node.emit("batch.processed", {
  batchId: "batch-789",
  items: ["item1", "item2", "item3"],
  processedAt: new Date().toISOString()
});
```

**Important**: Payloads are stored as JSONB in PostgreSQL, so ensure your data is JSON-serializable.

## Broadcast Events

Broadcast events are delivered to **all handlers** across **all nodes**, regardless of event type:

```typescript
// Normal event: only handlers for "system.shutdown" receive it
await node.emit("system.shutdown", { reason: "maintenance" });

// Broadcast event: ALL handlers receive it
await node.emit("system.shutdown", { reason: "maintenance" }, { broadcast: true });
```

**Use Cases**:
- System-wide notifications
- Cache invalidation
- Coordination signals

**Note**: Broadcast events are only available in enhanced mode (with workers). In standalone mode, broadcast falls back to normal emission.

## Emitting from HTTP Handlers

Example: Emit events from a Fastify/Express route:

```typescript
import Fastify from "fastify";
import { CoreSystem } from "@nexus-core/core";

const system = await CoreSystem.connect({ ... });
const node = await system.registerNode({ displayName: "API Server" });
await node.start();

const app = Fastify();

app.post("/users", async (request, reply) => {
  const { email, name } = request.body;

  // Create user in database
  const result = await db.query(
    "INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id",
    [email, name]
  );
  const userId = result.rows[0].id;

  // Emit event
  await node.emit("user.created", {
    userId,
    email,
    name,
    createdAt: new Date().toISOString()
  });

  return { userId, status: "created" };
});
```

## Emitting from Scheduled Tasks

Scheduled tasks automatically emit events. See [Scheduling Tasks](./schedule-tasks.md) for details.

## Error Handling

Event emission can fail in rare cases:

```typescript
try {
  const messageId = await node.emit("user.created", { ... });
} catch (error) {
  // Handle database connection errors, queue creation failures, etc.
  console.error("Failed to emit event:", error);
  // Consider retry logic or fallback behavior
}
```

## Performance Considerations

### Batch Emission

For high-throughput scenarios, consider batching:

```typescript
// Emit multiple events in parallel
const events = [
  { type: "user.created", payload: { userId: "1" } },
  { type: "user.created", payload: { userId: "2" } },
  { type: "user.created", payload: { userId: "3" } }
];

await Promise.all(
  events.map(e => node.emit(e.type, e.payload))
);
```

### Message ID Tracking

The returned `messageId` can be used for tracking:

```typescript
const messageId = await node.emit("order.placed", orderData);

// Store messageId for correlation
await db.query(
  "INSERT INTO order_events (order_id, message_id) VALUES ($1, $2)",
  [orderId, messageId]
);
```

## What Happens When You Emit?

1. **Enqueue**: Event is sent to `pgmq` queue (`core_events_{namespace}`)
2. **Log**: Event is appended to `core.event_log` table
3. **Return**: `messageId` is returned to caller
4. **Consumption**: Event becomes available for handlers (see [Handling Events](./handle-events.md))

## Examples

### User Registration Flow

```typescript
async function registerUser(email: string, password: string) {
  // Create user account
  const userId = await createUserAccount(email, password);

  // Emit registration event
  await node.emit("user.registered", {
    userId,
    email,
    registeredAt: new Date().toISOString()
  });

  // Emit welcome email event
  await node.emit("email.send", {
    to: email,
    template: "welcome",
    userId
  });

  return userId;
}
```

### Order Processing

```typescript
async function processOrder(orderId: string) {
  const order = await getOrder(orderId);

  // Emit order placed event
  await node.emit("order.placed", {
    orderId,
    customerId: order.customerId,
    items: order.items,
    total: order.total
  });

  // Check inventory
  for (const item of order.items) {
    await node.emit("inventory.check", {
      productId: item.productId,
      quantity: item.quantity,
      orderId
    });
  }
}
```

## Next Steps

- Learn about [handling events](./handle-events.md)
- Understand [event processing](../explanation/event-processing.md)
- See [API reference](../reference/api-reference.md)

