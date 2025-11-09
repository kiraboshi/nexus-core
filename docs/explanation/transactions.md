# Transactional Guarantees

This document explains how transactions work in nexus-core and what guarantees they provide.

## Transaction Model

All handlers for an event execute within a **single database transaction**:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // Handler 1
  await client.query("INSERT INTO users ...");
});

node.onEvent("user.created", async (event, { client }) => {
  // Handler 2
  await client.query("UPDATE user_stats ...");
});

node.onEvent("user.created", async (event, { client }) => {
  // Handler 3
  await client.query("INSERT INTO audit_log ...");
});
```

**All three handlers execute in the same transaction**:
- If all succeed → Transaction commits → Message acknowledged
- If any fails → Transaction rolls back → Message moved to DLQ

## ACID Properties

### Atomicity

**All handlers succeed or fail together**:

```typescript
node.onEvent("order.placed", async (event, { client }) => {
  // Handler 1: Create order
  await client.query("INSERT INTO orders ...");
  
  // Handler 2: Update inventory
  await client.query("UPDATE inventory ...");
  
  // Handler 3: Send notification
  await client.query("INSERT INTO notifications ...");
});
```

If Handler 2 fails:
- Handler 1's INSERT is rolled back
- Handler 3's INSERT is rolled back
- **Nothing is committed** → Transaction rolls back

### Consistency

**Database remains in consistent state**:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // All operations see consistent state
  const userCount = await client.query("SELECT COUNT(*) FROM users");
  await client.query("INSERT INTO users ...");
  const newCount = await client.query("SELECT COUNT(*) FROM users");
  // newCount = userCount + 1 (guaranteed)
});
```

### Isolation

**Handler operations are isolated from other transactions**:

```typescript
// Transaction 1 (processing message 1)
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
  // Other transactions don't see this until commit
});

// Transaction 2 (processing message 2)
// Doesn't see Transaction 1's changes until Transaction 1 commits
```

### Durability

**Committed changes are permanent**:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
  // Transaction commits
  // Changes are now permanent (even if database crashes)
});
```

## Transaction Scope

### What's Included

**All database operations within handlers**:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // ✅ Included in transaction
  await client.query("INSERT INTO users ...");
  
  // ✅ Included in transaction
  await client.query("UPDATE user_stats ...");
  
  // ✅ Included in transaction
  await client.query("DELETE FROM temp_data ...");
});
```

### What's Not Included

**Operations outside the transaction**:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // ✅ Included in transaction
  await client.query("INSERT INTO users ...");
  
  // ❌ NOT included (external API call)
  await fetch("https://api.example.com/users", {
    method: "POST",
    body: JSON.stringify(event.payload)
  });
  
  // ⚠️ If external API fails, transaction still commits
  // (database changes are committed even if API call fails)
});
```

## Transaction Lifecycle

### Successful Transaction

```
1. BEGIN TRANSACTION
   │
2. Execute Handler 1
   │
3. Execute Handler 2
   │
4. Execute Handler 3
   │
5. COMMIT TRANSACTION
   │
6. Acknowledge message (pgmq.delete)
```

### Failed Transaction

```
1. BEGIN TRANSACTION
   │
2. Execute Handler 1 ✅
   │
3. Execute Handler 2 ❌ (throws error)
   │
4. ROLLBACK TRANSACTION
   │   - Handler 1's changes are undone
   │
5. Move to DLQ
   │
6. Remove from main queue
```

## Error Handling

### Handler Errors

If a handler throws an error:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
  
  // This throws an error
  throw new Error("Something went wrong");
  
  // This never executes
  await client.query("UPDATE user_stats ...");
});
```

**Result**:
- Transaction rolls back
- All database changes are undone
- Message moved to DLQ
- Error is logged

### Partial Failures

If one handler fails, all handlers roll back:

```typescript
// Handler 1
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ..."); // ✅ Succeeds
});

// Handler 2
node.onEvent("user.created", async (event, { client }) => {
  throw new Error("Handler 2 failed"); // ❌ Fails
});

// Handler 3
node.onEvent("user.created", async (event, { client }) => {
  await client.query("UPDATE user_stats ..."); // Never executes
});
```

**Result**:
- Handler 1's INSERT is rolled back
- Handler 3 never executes
- Transaction rolls back
- Message moved to DLQ

## Best Practices

### 1. Keep Transactions Short

**Avoid long-running operations**:

```typescript
// ❌ Bad: Long-running operation holds transaction
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
  await longRunningOperation(); // Holds transaction open
  await client.query("UPDATE user_stats ...");
});

// ✅ Good: Do long operations outside transaction
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
});

// Do long operation after transaction commits
await longRunningOperation();
```

### 2. Handle External APIs Carefully

**External APIs are not transactional**:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // ✅ Database operation (transactional)
  await client.query("INSERT INTO users ...");
  
  // ⚠️ External API (not transactional)
  try {
    await sendEmail(event.payload.email);
  } catch (error) {
    // Email fails, but transaction still commits
    // Consider: Log error, schedule retry, or throw to rollback
  }
});
```

### 3. Make Handlers Idempotent

**Handle redeliveries safely**:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  // Check if already processed
  const existing = await client.query(
    "SELECT id FROM processed_events WHERE message_id = $1",
    [event.messageId]
  );
  
  if (existing.rows.length > 0) {
    // Already processed, skip
    return;
  }
  
  // Process event
  await client.query("INSERT INTO users ...");
  
  // Mark as processed
  await client.query(
    "INSERT INTO processed_events (message_id) VALUES ($1)",
    [event.messageId]
  );
});
```

### 4. Use Transactions for Consistency

**Group related operations**:

```typescript
node.onEvent("order.placed", async (event, { client }) => {
  // All these operations are atomic
  await client.query("INSERT INTO orders ...");
  await client.query("UPDATE inventory ...");
  await client.query("INSERT INTO order_log ...");
  
  // Either all succeed or all fail
});
```

## Limitations

### Single Transaction Per Event

**All handlers execute in one transaction**:

- ✅ Simple and consistent
- ⚠️ Can't mix transactional and non-transactional handlers
- ⚠️ Long-running handlers hold transaction open

### No Cross-Event Transactions

**Each event has its own transaction**:

```typescript
// Event 1
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
  // Transaction commits here
});

// Event 2 (separate transaction)
node.onEvent("order.placed", async (event, { client }) => {
  await client.query("INSERT INTO orders ...");
  // Different transaction
});
```

### External Operations Not Transactional

**External APIs, file I/O, etc. are not transactional**:

```typescript
node.onEvent("user.created", async (event, { client }) => {
  await client.query("INSERT INTO users ...");
  await fetch("https://api.example.com/users"); // Not transactional
  // If API fails, database change still commits
});
```

## Summary

nexus-core provides:

- ✅ **Atomicity**: All handlers succeed or fail together
- ✅ **Consistency**: Database remains in consistent state
- ✅ **Isolation**: Handler operations are isolated
- ✅ **Durability**: Committed changes are permanent

Transactions ensure that event processing is reliable and consistent, with all handlers executing atomically.

## Next Steps

- Learn about [event processing](./event-processing.md)
- Understand [architecture](./architecture.md)
- Read about [performance](./performance.md)

