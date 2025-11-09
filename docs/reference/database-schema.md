# Database Schema Reference

Complete reference for the nexus-core database schema.

## Schema: `core`

All core tables and functions are in the `core` schema.

## Tables

### `core.namespaces`

Registry of logical namespaces.

**Columns**:
- `namespace` (TEXT, PRIMARY KEY) - Unique namespace identifier
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `metadata` (JSONB) - Namespace metadata

**Indexes**: Primary key on `namespace`

**Example**:
```sql
SELECT * FROM core.namespaces;
```

### `core.nodes`

Registry of active nodes with heartbeat tracking.

**Columns**:
- `node_id` (TEXT, PRIMARY KEY) - Unique node identifier
- `namespace` (TEXT) - Foreign key to `core.namespaces`
- `display_name` (TEXT) - Human-readable node name
- `description` (TEXT) - Node description
- `metadata` (JSONB) - Node-specific metadata
- `registered_at` (TIMESTAMPTZ) - Initial registration time
- `last_heartbeat` (TIMESTAMPTZ) - Last heartbeat timestamp

**Constraints**:
- `UNIQUE(namespace, node_id)` - One node ID per namespace

**Indexes**: 
- Primary key on `node_id`
- Index on `namespace`

**Example**:
```sql
SELECT 
  node_id,
  display_name,
  namespace,
  last_heartbeat,
  now() - last_heartbeat AS time_since_heartbeat
FROM core.nodes
WHERE namespace = 'myapp';
```

### `core.event_log`

Append-only audit log of all emitted events.

**Columns**:
- `event_id` (BIGSERIAL, PRIMARY KEY) - Auto-incrementing event identifier
- `namespace` (TEXT) - Event namespace
- `event_type` (TEXT) - Event type identifier
- `payload` (JSONB) - Event payload data
- `emitted_at` (TIMESTAMPTZ) - Event emission timestamp
- `producer_node_id` (TEXT) - Node that emitted the event
- `scheduled_task_id` (UUID) - Optional reference to scheduled task
- `metadata` (JSONB) - Additional metadata (messageId, redeliveryCount)

**Partitioning**: 
- Partitioned by `emitted_at` (monthly partitions)
- 6-month retention (old partitions automatically dropped)

**Indexes**:
- Primary key on `event_id`
- Index on `namespace`
- Index on `event_type`
- Index on `emitted_at`

**Example**:
```sql
SELECT 
  event_id,
  event_type,
  producer_node_id,
  emitted_at,
  payload
FROM core.event_log
WHERE namespace = 'myapp'
  AND event_type = 'user.created'
ORDER BY emitted_at DESC
LIMIT 100;
```

### `core.scheduled_tasks`

Metadata for cron-scheduled tasks that emit events.

**Columns**:
- `task_id` (UUID, PRIMARY KEY) - Unique task identifier
- `namespace` (TEXT) - Foreign key to `core.namespaces`
- `job_id` (INTEGER) - pg_cron job identifier
- `name` (TEXT) - Task name
- `cron_expression` (TEXT) - Cron schedule expression
- `event_type` (TEXT) - Event type to emit when task runs
- `payload` (JSONB) - Payload to include in emitted event
- `timezone` (TEXT) - Optional timezone for cron execution
- `active` (BOOLEAN) - Whether task is currently active
- `created_at` (TIMESTAMPTZ) - Creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

**Indexes**:
- Primary key on `task_id`
- Index on `namespace`

**Example**:
```sql
SELECT 
  name,
  cron_expression,
  event_type,
  active,
  updated_at
FROM core.scheduled_tasks
WHERE namespace = 'myapp';
```

## Functions

### `core.touch_node_heartbeat(p_node_id TEXT)`

Updates the `last_heartbeat` timestamp for a node.

**Parameters**:
- `p_node_id` (TEXT) - Node ID

**Returns**: `void`

**Example**:
```sql
SELECT core.touch_node_heartbeat('my-node-1');
```

### `core.append_event_log(...)`

Atomically inserts an event into the event log and returns the event_id.

**Parameters**:
- `p_namespace` (TEXT) - Namespace
- `p_event_type` (TEXT) - Event type
- `p_payload` (JSONB) - Event payload
- `p_producer_node_id` (TEXT) - Producer node ID
- `p_scheduled_task_id` (UUID, optional) - Scheduled task ID
- `p_metadata` (JSONB, optional) - Metadata

**Returns**: `BIGINT` (event_id)

**Example**:
```sql
SELECT core.append_event_log(
  'myapp',
  'user.created',
  '{"userId": "123"}'::jsonb,
  'node-1',
  NULL,
  '{"messageId": 1}'::jsonb
);
```

### `core.queue_name_for_namespace(p_namespace TEXT)`

Generates queue name from namespace.

**Parameters**:
- `p_namespace` (TEXT) - Namespace

**Returns**: `TEXT` - Queue name (e.g., `'core_events_myapp'`)

**Example**:
```sql
SELECT core.queue_name_for_namespace('myapp');
-- Returns: 'core_events_myapp'
```

### `core.dead_letter_queue_name_for_namespace(p_namespace TEXT)`

Generates dead letter queue name from namespace.

**Parameters**:
- `p_namespace` (TEXT) - Namespace

**Returns**: `TEXT` - DLQ name (e.g., `'core_events_myapp_dlq'`)

**Example**:
```sql
SELECT core.dead_letter_queue_name_for_namespace('myapp');
-- Returns: 'core_events_myapp_dlq'
```

### `core.run_scheduled_task(p_task_id UUID)`

Executed by pg_cron to trigger scheduled task execution.

**Parameters**:
- `p_task_id` (UUID) - Task ID

**Returns**: `void`

**Mechanism**:
1. Loads task metadata from `core.scheduled_tasks` (if active)
2. Constructs event envelope with task payload
3. Sends event to namespace queue via `pgmq.send()`
4. Appends event to `core.event_log`
5. Updates task `updated_at` timestamp

**Example**:
```sql
SELECT core.run_scheduled_task('123e4567-e89b-12d3-a456-426614174000');
```

## Queues (pgmq)

### Main Queue

Queue name: `core_events_{namespace}`

**Example**: `core_events_myapp`

Created automatically on system initialization.

### Dead Letter Queue

Queue name: `core_events_{namespace}_dlq`

**Example**: `core_events_myapp_dlq`

Created automatically on system initialization.

### Queue Operations

```sql
-- Check queue depth
SELECT queue_length 
FROM pgmq.meta 
WHERE queue_name = 'core_events_myapp';

-- Read messages (without consuming)
SELECT * FROM pgmq.read('core_events_myapp', 0, 10);

-- Send message
SELECT pgmq.send('core_events_myapp', '{"key": "value"}'::jsonb);

-- Delete message
SELECT pgmq.delete('core_events_myapp', 123);
```

## Cron Jobs (pg_cron)

Scheduled tasks create cron jobs via `pg_cron`.

### Viewing Cron Jobs

```sql
SELECT 
  jobid,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active
FROM cron.job
WHERE jobname LIKE '%myapp%';
```

### Viewing Cron Execution History

```sql
SELECT 
  j.jobname,
  jr.runid,
  jr.status,
  jr.return_message,
  jr.start_time,
  jr.end_time
FROM cron.job j
JOIN cron.job_run_details jr ON j.jobid = jr.jobid
WHERE j.jobname LIKE '%myapp%'
ORDER BY jr.start_time DESC
LIMIT 50;
```

## Partitioning (pg_partman)

The `core.event_log` table is partitioned monthly.

### Viewing Partitions

```sql
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE tablename LIKE 'event_log%';
```

### Partition Retention

Partitions older than 6 months are automatically dropped by `pg_partman`.

## Common Queries

### Recent Events by Type

```sql
SELECT 
  event_type,
  COUNT(*) AS count,
  MIN(emitted_at) AS first_event,
  MAX(emitted_at) AS last_event
FROM core.event_log
WHERE namespace = 'myapp'
  AND emitted_at > now() - interval '24 hours'
GROUP BY event_type
ORDER BY count DESC;
```

### Active Nodes

```sql
SELECT 
  node_id,
  display_name,
  last_heartbeat,
  now() - last_heartbeat AS time_since_heartbeat
FROM core.nodes
WHERE namespace = 'myapp'
  AND last_heartbeat > now() - interval '5 minutes'
ORDER BY last_heartbeat DESC;
```

### Queue Metrics

```sql
SELECT 
  queue_name,
  queue_length,
  newest_msg_age_seconds,
  oldest_msg_age_seconds
FROM pgmq.meta
WHERE queue_name LIKE 'core_events_%';
```

## Next Steps

- See [API reference](./api-reference.md)
- Check [configuration options](./configuration.md)
- Read [event envelope structure](./event-envelope.md)

