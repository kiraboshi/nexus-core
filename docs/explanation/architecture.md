# Architecture Overview

This document explains the architecture and design decisions behind nexus-core.

## System Architecture

nexus-core is a PostgreSQL-native event-driven message bus system that provides publish-subscribe messaging, event logging, scheduled task execution, and node lifecycle management entirely within PostgreSQL.

### Core Principles

1. **PostgreSQL-Native**: No external dependencies (Redis, RabbitMQ, etc.)
2. **Namespace Isolation**: Logical separation via namespaces
3. **Node-Based Architecture**: Services register as "nodes" that can both produce and consume events
4. **Transactional Guarantees**: Event handlers execute within database transactions
5. **At-Least-Once Delivery**: Messages are acknowledged after successful handler execution

## Component Overview

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                     │
│  (Your Code: HTTP servers, workers, services)           │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ Uses
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  nexus-core Library                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ CoreSystem   │  │  CoreNode    │  │   Database   │ │
│  │              │  │              │  │   Abstractions│ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ Uses
                       ▼
┌─────────────────────────────────────────────────────────┐
│              PostgreSQL Database                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   pgmq       │  │   pg_cron    │  │ pg_partman  │ │
│  │  (Queues)    │  │ (Scheduling) │  │(Partitioning)│ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│  ┌──────────────┐  ┌──────────────┐                   │
│  │ core schema  │  │  Event Log   │                   │
│  │ (Tables)     │  │  (Partitioned)│                  │
│  └──────────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

### Event Publishing Flow

```
[Node] emit(eventType, payload)
  │
  ├─► Construct EventEnvelope
  │     - namespace (from system)
  │     - eventType (from parameter)
  │     - payload (from parameter)
  │     - emittedAt (current time)
  │     - producerNodeId (node ID)
  │
  ├─► pgmq.send(queue_name, envelope)
  │     - Enqueue to core_events_{namespace}
  │     - Returns messageId
  │
  ├─► core.append_event_log(...)
  │     - Insert into core.event_log
  │     - Returns event_id
  │
  └─► Return messageId to caller
```

### Event Consumption Flow

```
[Consumer Loop] (runs continuously)
  │
  ├─► pgmq.read(queue_name, vt, batch_size)
  │     - Read messages with visibility timeout
  │     - Returns array of messages
  │
  ├─► For each message:
  │     │
  │     ├─► Decorate envelope
  │     │     - Set messageId, redeliveryCount
  │     │
  │     ├─► Lookup handlers by eventType
  │     │     - Get handlers from registry
  │     │
  │     ├─► BEGIN TRANSACTION
  │     │     │
  │     │     ├─► Execute all handlers
  │     │     │     - Handler(event, { client })
  │     │     │
  │     │     ├─► IF success:
  │     │     │     - COMMIT TRANSACTION
  │     │     │     - pgmq.delete(messageId)
  │     │     │
  │     │     └─► IF failure:
  │     │           - ROLLBACK TRANSACTION
  │     │           - Move to DLQ
  │     │
  │     └─► Continue to next message
  │
  └─► Sleep (idlePollIntervalMs) if no messages
```

## Key Design Decisions

### 1. PostgreSQL-Native

**Decision**: Build entirely on PostgreSQL primitives.

**Rationale**:
- ✅ No external dependencies
- ✅ Leverages existing database infrastructure
- ✅ ACID guarantees for event processing
- ✅ Single source of truth
- ✅ Simplified deployment

**Trade-offs**:
- ⚠️ Single database becomes bottleneck
- ⚠️ Limited horizontal scaling options

### 2. Namespace Isolation

**Decision**: Logical separation via namespaces, not physical.

**Rationale**:
- ✅ Simple multi-tenancy
- ✅ Shared infrastructure
- ✅ Easy namespace management
- ✅ Cost-effective

**Trade-offs**:
- ⚠️ Namespaces share database resources
- ⚠️ No physical isolation

### 3. Polling-Based Consumption

**Decision**: Poll for messages instead of push-based delivery.

**Rationale**:
- ✅ Simpler implementation
- ✅ Works with pgmq
- ✅ No need for LISTEN/NOTIFY
- ✅ Predictable behavior

**Trade-offs**:
- ⚠️ Higher latency (polling interval)
- ⚠️ Higher CPU usage (constant polling)

### 4. Transactional Handlers

**Decision**: All handlers for an event execute in a single transaction.

**Rationale**:
- ✅ Atomicity: All handlers succeed or fail together
- ✅ Consistency: Shared database state
- ✅ Isolation: Handler operations are isolated
- ✅ Simpler error handling

**Trade-offs**:
- ⚠️ Can't mix transactional and non-transactional handlers
- ⚠️ Long-running handlers hold transaction open

### 5. At-Least-Once Delivery

**Decision**: Messages can be redelivered if not acknowledged.

**Rationale**:
- ✅ Handles failures gracefully
- ✅ No message loss
- ✅ Works with visibility timeout

**Trade-offs**:
- ⚠️ Handlers must be idempotent
- ⚠️ Potential duplicate processing

### 6. Dead Letter Queue

**Decision**: Failed messages moved to DLQ instead of dropping.

**Rationale**:
- ✅ No message loss
- ✅ Inspection and recovery
- ✅ Debugging failed messages
- ✅ Audit trail

**Trade-offs**:
- ⚠️ DLQ can grow if not monitored
- ⚠️ Requires manual intervention

## Architecture Patterns

### Node Pattern

Each application instance registers as a "node":

```
Application Instance
  │
  ├─► CoreSystem.connect()
  │     - Initialize database connection
  │     - Create schema if needed
  │     - Set up queues
  │
  ├─► system.registerNode()
  │     - Register in core.nodes table
  │     - Create CoreNode instance
  │
  ├─► node.onEvent(...)
  │     - Register event handlers
  │
  ├─► node.start()
  │     - Start heartbeat loop
  │     - Start consumer loop
  │
  └─► node.emit(...)
        - Emit events
```

### Handler Registry Pattern

Handlers are registered in a central registry:

```
CoreSystem
  │
  └─► handlerRegistry: Map<eventType, Set<Handler>>
        │
        ├─► node.onEvent("user.created", handler1)
        │     - Add handler1 to registry["user.created"]
        │
        ├─► node.onEvent("user.created", handler2)
        │     - Add handler2 to registry["user.created"]
        │
        └─► Consumer reads message
              - Lookup handlers by eventType
              - Execute all handlers in transaction
```

### Queue Pattern

Each namespace has its own queue:

```
Namespace: "myapp"
  │
  ├─► Main Queue: "core_events_myapp"
  │     - All events for this namespace
  │     - Consumed by handlers
  │
  └─► Dead Letter Queue: "core_events_myapp_dlq"
        - Failed messages
        - For inspection/recovery
```

## Scalability Considerations

### Vertical Scaling

- Increase database resources (CPU, memory, I/O)
- Tune PostgreSQL configuration
- Optimize queries and indexes

### Horizontal Scaling

- Run multiple application instances
- Messages distributed round-robin (standalone mode)
- True fan-out with workers (enhanced mode)

### Performance Tuning

- Adjust `batchSize` for throughput vs latency
- Tune `idlePollIntervalMs` for responsiveness
- Configure `visibilityTimeoutSeconds` for processing time

## Security Considerations

### Database Security

- Use SSL connections
- Strong passwords
- Principle of least privilege
- Network isolation

### Application Security

- Validate event payloads
- Rate limiting
- Input sanitization
- Secrets management

## Monitoring and Observability

### Metrics

- Queue depth
- Dead letter queue depth
- Node heartbeats
- Event throughput

### Logging

- Structured logging
- Event emission logs
- Handler execution logs
- Error logs

### Health Checks

- Database connectivity
- Queue availability
- Node status
- Extension availability

## Future Considerations

### Potential Enhancements

1. **Message Ordering**: Guaranteed ordering for events
2. **Deduplication**: Prevent duplicate processing
3. **Push-Based Delivery**: Lower latency with LISTEN/NOTIFY
4. **Multi-Database Support**: Distribute across databases
5. **Message TTL**: Automatic expiration of old messages

## Summary

nexus-core provides a simple, PostgreSQL-native event-driven architecture that:

- ✅ Eliminates external dependencies
- ✅ Provides transactional guarantees
- ✅ Supports multi-tenancy via namespaces
- ✅ Handles failures gracefully
- ✅ Scales horizontally with multiple instances

The architecture prioritizes simplicity and reliability over advanced features, making it ideal for PostgreSQL-centric applications.

## Next Steps

- Learn about [event processing](./event-processing.md)
- Understand [namespaces](./namespaces.md)
- Read about [transactions](./transactions.md)

