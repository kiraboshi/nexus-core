# How to Handle Events

This guide explains how to register event handlers and process events in nexus-core.

## Basic Event Handling

Register a handler for an event type:

```typescript
import { CoreSystem, EventEnvelope } from "@nexus-core/core";

const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp"
});

const node = await system.registerNode({
  displayName: "Event Processor"
});

// Register handler
node.onEvent("user.created", async (event, { client }) => {
  console.log("User created:", event.payload);
  console.log("Message ID:", event.messageId);
});

// Start the node (begins consuming)
await node.start();
```

## Handler Function Signature

Event handlers receive two parameters:

```typescript
type EventHandler<TPayload = unknown> = (
  event: EventEnvelope<TPayload>,
  context: EventContext
) => Promise<void> | void;

interface EventContext {
  client: PoolClient; // PostgreSQL client for database operations
}
```

### Event Parameter

The `event` parameter contains:

```typescript
interface EventEnvelope<TPayload> {
  namespace: string;           // Namespace identifier
  eventType: string;            // Event type (e.g., "user.created")
  payload: TPayload;            // Event payload (typed)
  emittedAt: string;            // ISO timestamp
  producerNodeId: string;       // Node that emitted the event
  messageId?: number;           // pgmq message ID
  redeliveryCount?: number;     // Number of times message was read
  broadcast?: boolean;          // Whether this is a broadcast event
}
```

### Context Parameter

The `context` provides a PostgreSQL client for database operations:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // Use client for database operations
  await client.query(
    "INSERT INTO user_log (user_id, event_id) VALUES ($1, $2)",
    [event.payload.userId, event.messageId]
  );
});
```

**Important**: All handlers for the same event execute within a **single transaction**. If any handler fails, the entire transaction rolls back.

## Typed Event Handlers

Use TypeScript generics for type safety:

```typescript
interface UserCreatedPayload {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
}

node.onEvent<UserCreatedPayload>("user.created", async (event, { client }) => {
  // event.payload is typed as UserCreatedPayload
  const { userId, email, name } = event.payload;
  
  await client.query(
    "INSERT INTO users (id, email, name) VALUES ($1, $2, $3)",
    [userId, email, name]
  );
});
```

## Multiple Handlers for Same Event Type

You can register multiple handlers for the same event type:

```typescript
// Handler 1: Send welcome email
node.onEvent("user.created", async (event, { client }) => {
  await sendWelcomeEmail(event.payload.email);
});

// Handler 2: Create user profile
node.onEvent("user.created", async (event, { client }) => {
  await client.query(
    "INSERT INTO user_profiles (user_id) VALUES ($1)",
    [event.payload.userId]
  );
});

// Handler 3: Update analytics
node.onEvent("user.created", async (event, { client }) => {
  await updateUserCount();
});
```

**Important**: All handlers execute in the **same transaction**. If any handler fails, all handlers roll back.

## Transactional Processing

All handlers for an event execute within a single database transaction:

```typescript
node.onEvent("order.placed", async (event, { client }) => {
  // All these operations are atomic
  await client.query("INSERT INTO orders ...", [event.payload.orderId]);
  await client.query("UPDATE inventory ...", [event.payload.items]);
  await client.query("INSERT INTO order_log ...", [event.payload.orderId]);
  
  // If any query fails, all are rolled back
});
```

**Benefits**:
- Atomicity: All handlers succeed or fail together
- Consistency: Shared database state
- Isolation: Handler operations are isolated

## Error Handling

### Throwing Errors

If a handler throws an error, the event is moved to the dead letter queue:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  try {
    await processUser(event.payload);
  } catch (error) {
    // Log error
    console.error("Failed to process user:", error);
    
    // Re-throw to trigger DLQ
    throw error;
  }
});
```

### Graceful Error Handling

Handle errors without triggering DLQ:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  try {
    await sendEmail(event.payload.email);
  } catch (error) {
    // Log but don't throw - event will be acknowledged
    console.error("Email failed, but continuing:", error);
    // Optionally: schedule retry or notify admin
  }
});
```

## Removing Handlers

Unregister a handler:

```typescript
const handler = async (event, { client }) => {
  // Handler logic
};

// Register
node.onEvent("user.created", handler);

// Later, unregister
node.offEvent("user.created", handler);
```

## Handler Execution Order

Handlers are executed in **registration order**:

```typescript
// Handler 1 executes first
node.onEvent("user.created", async (event) => {
  console.log("First");
});

// Handler 2 executes second
node.onEvent("user.created", async (event) => {
  console.log("Second");
});
```

## Broadcast Event Handling

Broadcast events are delivered to **all handlers** across **all nodes**:

```typescript
// This handler will receive ALL broadcast events
node.onEvent("system.shutdown", async (event) => {
  if (event.broadcast) {
    console.log("Received broadcast shutdown signal");
    await gracefulShutdown();
  }
});
```

## Common Patterns

### Database Operations

```typescript
node.onEvent("user.created", async (event, { client }) => {
  const { userId, email } = event.payload;
  
  // Insert into multiple tables atomically
  await client.query(
    "INSERT INTO user_profiles (user_id) VALUES ($1)",
    [userId]
  );
  
  await client.query(
    "INSERT INTO user_preferences (user_id) VALUES ($1)",
    [userId]
  );
  
  // Update counters
  await client.query(
    "UPDATE stats SET user_count = user_count + 1"
  );
});
```

### External API Calls

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // External API call (not transactional)
  await fetch("https://api.example.com/users", {
    method: "POST",
    body: JSON.stringify(event.payload)
  });
  
  // Record API call in database (transactional)
  await client.query(
    "INSERT INTO api_calls (user_id, endpoint) VALUES ($1, $2)",
    [event.payload.userId, "create-user"]
  );
});
```

### Conditional Processing

```typescript
node.onEvent("order.placed", async (event, { client }) => {
  const { orderId, customerId, total } = event.payload;
  
  // Only process orders over $100
  if (total > 100) {
    await client.query(
      "INSERT INTO premium_orders (order_id) VALUES ($1)",
      [orderId]
    );
  }
});
```

### Redelivery Handling

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // Check if this is a redelivery
  if (event.redeliveryCount && event.redeliveryCount > 0) {
    console.warn(`Redelivery #${event.redeliveryCount} for message ${event.messageId}`);
    
    // Implement idempotency check
    const existing = await client.query(
      "SELECT id FROM processed_events WHERE message_id = $1",
      [event.messageId]
    );
    
    if (existing.rows.length > 0) {
      console.log("Already processed, skipping");
      return; // Skip processing
    }
  }
  
  // Process event
  await processUser(event.payload);
  
  // Mark as processed
  await client.query(
    "INSERT INTO processed_events (message_id) VALUES ($1)",
    [event.messageId]
  );
});
```

## Performance Considerations

### Async Operations

Handlers can be async or sync:

```typescript
// Async (recommended)
node.onEvent("user.created", async (event, { client }) => {
  await processUser(event.payload);
});

// Sync (for simple operations)
node.onEvent("user.created", (event, { client }) => {
  console.log("User created:", event.payload);
});
```

### Batch Processing

For high-volume events, consider batching:

```typescript
const batch: EventEnvelope[] = [];

node.onEvent("user.created", async (event, { client }) => {
  batch.push(event);
  
  if (batch.length >= 100) {
    await processBatch(batch);
    batch.length = 0;
  }
});
```

## Best Practices

1. **Keep handlers focused**: One handler, one responsibility
2. **Use transactions**: Leverage the transactional context
3. **Handle errors gracefully**: Decide when to throw vs. log
4. **Make handlers idempotent**: Handle redeliveries safely
5. **Type your payloads**: Use TypeScript generics
6. **Log important operations**: For debugging and auditing

## Next Steps

- Learn about [scheduling tasks](./schedule-tasks.md)
- Understand [dead letter queues](./dead-letter-queue.md)
- Read about [event processing](../explanation/event-processing.md)

