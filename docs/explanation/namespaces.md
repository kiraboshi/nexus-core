# Namespace Isolation

This document explains how namespaces work in nexus-core and how they provide logical isolation.

## What is a Namespace?

A namespace is a logical grouping of nodes, events, and queues. It provides:

- **Logical Isolation**: Events and queues are scoped to a namespace
- **Multi-Tenancy**: Multiple applications can share the same database
- **Resource Sharing**: Namespaces share database infrastructure
- **Simple Management**: Easy to create and manage namespaces

## Namespace Structure

Each namespace has:

1. **Queue**: `core_events_{namespace}` - Main event queue
2. **Dead Letter Queue**: `core_events_{namespace}_dlq` - Failed messages
3. **Event Log Partition**: Events logged to `core.event_log` with namespace filter
4. **Nodes**: Registered nodes belong to a namespace
5. **Scheduled Tasks**: Tasks are scoped to a namespace

## Namespace Isolation

### Queue Isolation

```typescript
// Namespace: "production"
const prodSystem = await CoreSystem.connect({
  namespace: "production"
});
// Queue: "core_events_production"

// Namespace: "staging"
const stagingSystem = await CoreSystem.connect({
  namespace: "staging"
});
// Queue: "core_events_staging"
```

Events emitted in one namespace **cannot** be consumed by nodes in another namespace.

### Event Log Isolation

Events are logged with namespace:

```sql
SELECT * FROM core.event_log WHERE namespace = 'production';
SELECT * FROM core.event_log WHERE namespace = 'staging';
```

### Node Isolation

Nodes are scoped to a namespace:

```sql
SELECT * FROM core.nodes WHERE namespace = 'production';
SELECT * FROM core.nodes WHERE namespace = 'staging';
```

### Scheduled Task Isolation

Tasks are scoped to a namespace:

```sql
SELECT * FROM core.scheduled_tasks WHERE namespace = 'production';
SELECT * FROM core.scheduled_tasks WHERE namespace = 'staging';
```

## Use Cases

### Environment Separation

Separate namespaces for different environments:

```typescript
// Production
const prodSystem = await CoreSystem.connect({
  namespace: "production"
});

// Staging
const stagingSystem = await CoreSystem.connect({
  namespace: "staging"
});

// Development
const devSystem = await CoreSystem.connect({
  namespace: "development"
});
```

### Multi-Tenant Applications

Separate namespaces for different tenants:

```typescript
// Tenant A
const tenantASystem = await CoreSystem.connect({
  namespace: "tenant-a"
});

// Tenant B
const tenantBSystem = await CoreSystem.connect({
  namespace: "tenant-b"
});
```

### Feature Isolation

Separate namespaces for different features:

```typescript
// User service
const userSystem = await CoreSystem.connect({
  namespace: "users"
});

// Order service
const orderSystem = await CoreSystem.connect({
  namespace: "orders"
});
```

## Namespace Naming

### Valid Names

Namespaces must be valid identifiers:

- ✅ Alphanumeric: `"production"`, `"staging"`, `"myapp"`
- ✅ Hyphens: `"my-app"`, `"tenant-1"`
- ✅ Underscores: `"my_app"`, `"tenant_1"`
- ✅ Mixed: `"my-app_v1"`

### Invalid Names

- ❌ Spaces: `"my app"`
- ❌ Special characters: `"my@app"`, `"my.app"`
- ❌ Reserved words: `"core"`, `"pgmq"`

**Note**: Namespaces are automatically sanitized, so invalid characters are replaced.

## Namespace Management

### Creating Namespaces

Namespaces are created automatically when you connect:

```typescript
const system = await CoreSystem.connect({
  namespace: "myapp"  // Created automatically if doesn't exist
});
```

This:
- Creates entry in `core.namespaces`
- Creates queue `core_events_myapp`
- Creates DLQ `core_events_myapp_dlq`
- Sets up partitioning for event log

### Listing Namespaces

```sql
SELECT * FROM core.namespaces;
```

### Namespace Metadata

Store metadata with namespaces:

```sql
UPDATE core.namespaces
SET metadata = '{"environment": "production", "region": "us-east-1"}'::jsonb
WHERE namespace = 'production';
```

## Cross-Namespace Communication

Namespaces are **isolated** - events cannot cross namespace boundaries.

If you need cross-namespace communication:

### Option 1: Bridge Node

Create a node that listens in one namespace and emits in another:

```typescript
// Listen in namespace A
const systemA = await CoreSystem.connect({ namespace: "namespace-a" });
const nodeA = await systemA.registerNode({ displayName: "Bridge" });

nodeA.onEvent("user.created", async (event) => {
  // Emit in namespace B
  const systemB = await CoreSystem.connect({ namespace: "namespace-b" });
  const nodeB = await systemB.registerNode({ displayName: "Bridge" });
  await nodeB.emit("user.created", event.payload);
});
```

### Option 2: Shared Namespace

Use a shared namespace for cross-service communication:

```typescript
// Shared namespace for inter-service events
const sharedSystem = await CoreSystem.connect({
  namespace: "shared"
});
```

## Resource Sharing

Namespaces share database resources:

- **Database Connections**: All namespaces use the same connection pool
- **CPU/Memory**: Shared across namespaces
- **Disk Space**: Event log partitions shared
- **Extensions**: Shared PostgreSQL extensions

### Resource Limits

Consider:
- **Queue Depth**: Monitor per-namespace queue depths
- **Event Volume**: High-volume namespaces can impact others
- **Handler Performance**: Slow handlers affect all namespaces

## Monitoring Per-Namespace

### Queue Metrics

```sql
-- Queue depth per namespace
SELECT 
  queue_name,
  queue_length
FROM pgmq.meta
WHERE queue_name LIKE 'core_events_%';
```

### Event Statistics

```sql
-- Events per namespace (last 24 hours)
SELECT 
  namespace,
  COUNT(*) AS event_count,
  COUNT(DISTINCT event_type) AS event_types
FROM core.event_log
WHERE emitted_at > now() - interval '24 hours'
GROUP BY namespace
ORDER BY event_count DESC;
```

### Node Statistics

```sql
-- Active nodes per namespace
SELECT 
  namespace,
  COUNT(*) AS node_count,
  MAX(last_heartbeat) AS latest_heartbeat
FROM core.nodes
GROUP BY namespace;
```

## Best Practices

1. **Use Descriptive Names**: `"production"` not `"prod"`
2. **Environment-Based**: Separate namespaces per environment
3. **Monitor Per-Namespace**: Track metrics per namespace
4. **Document Namespaces**: Document what each namespace is for
5. **Limit Cross-Namespace**: Minimize cross-namespace communication

## Summary

Namespaces provide:

- ✅ Logical isolation of events and queues
- ✅ Simple multi-tenancy
- ✅ Environment separation
- ✅ Resource sharing
- ✅ Easy management

They enable multiple applications or tenants to share the same database infrastructure while maintaining logical separation.

## Next Steps

- Learn about [architecture](./architecture.md)
- Understand [event processing](./event-processing.md)
- Read about [transactions](./transactions.md)

