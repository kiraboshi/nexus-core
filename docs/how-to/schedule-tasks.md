# How to Schedule Recurring Tasks

This guide explains how to schedule recurring tasks using cron expressions in nexus-core.

## Basic Task Scheduling

Schedule a task that emits an event on a schedule:

```typescript
import { CoreSystem } from "@nexus-core/core";

const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp"
});

const node = await system.registerNode({
  displayName: "Scheduler"
});

await node.start();

// Schedule a daily cleanup task
const task = await node.scheduleTask({
  name: "daily-cleanup",
  cronExpression: "0 2 * * *", // 2 AM daily
  eventType: "cleanup.daily",
  payload: { retentionDays: 30 }
});

console.log(`Task scheduled: ${task.taskId}`);
```

## Cron Expression Format

nexus-core uses standard cron syntax:

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
* * * * *
```

### Common Examples

```typescript
// Every minute
"* * * * *"

// Every hour (at minute 0)
"0 * * * *"

// Every day at 2 AM
"0 2 * * *"

// Every Monday at 9 AM
"0 9 * * 1"

// Every 5 minutes
"*/5 * * * *"

// Every weekday at 8 AM
"0 8 * * 1-5"

// First day of every month at midnight
"0 0 1 * *"

// Every 15 minutes
"*/15 * * * *"
```

## Task Definition

```typescript
interface ScheduledTaskDefinition {
  name: string;                    // Unique task name
  cronExpression: string;           // Cron schedule
  eventType: string;                // Event type to emit
  payload?: Record<string, unknown>; // Event payload
  timezone?: string;                // Optional timezone
}
```

## Handling Scheduled Task Events

Scheduled tasks emit events that you can handle like any other event:

```typescript
// Schedule the task
await node.scheduleTask({
  name: "daily-report",
  cronExpression: "0 9 * * *", // 9 AM daily
  eventType: "report.generate",
  payload: { reportType: "daily" }
});

// Handle the event
node.onEvent("report.generate", async (event, { client }) => {
  const { reportType } = event.payload;
  console.log(`Generating ${reportType} report...`);
  
  // Generate report
  const report = await generateReport(reportType);
  
  // Store report
  await client.query(
    "INSERT INTO reports (type, data) VALUES ($1, $2)",
    [reportType, JSON.stringify(report)]
  );
});
```

## Task Return Value

`scheduleTask()` returns a `ScheduledTaskRecord`:

```typescript
interface ScheduledTaskRecord {
  name: string;
  cronExpression: string;
  eventType: string;
  payload: Record<string, unknown>;
  taskId: string;              // UUID
  jobId: number;               // pg_cron job ID
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
  active: boolean;             // Whether task is active
  timezone?: string;           // Timezone if specified
}
```

## Timezone Support

Specify a timezone for cron execution:

```typescript
await node.scheduleTask({
  name: "daily-backup",
  cronExpression: "0 3 * * *", // 3 AM
  eventType: "backup.daily",
  timezone: "America/New_York"  // Uses NY timezone
});
```

Common timezones:
- `"UTC"` - Coordinated Universal Time
- `"America/New_York"` - Eastern Time
- `"America/Los_Angeles"` - Pacific Time
- `"Europe/London"` - GMT/BST
- `"Asia/Tokyo"` - Japan Standard Time

See [IANA Time Zone Database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) for full list.

## Common Use Cases

### Daily Cleanup

```typescript
await node.scheduleTask({
  name: "daily-cleanup",
  cronExpression: "0 2 * * *", // 2 AM daily
  eventType: "cleanup.daily",
  payload: { retentionDays: 30 }
});

node.onEvent("cleanup.daily", async (event, { client }) => {
  const { retentionDays } = event.payload;
  
  await client.query(
    `DELETE FROM old_data 
     WHERE created_at < now() - interval '${retentionDays} days'`
  );
});
```

### Periodic Health Checks

```typescript
await node.scheduleTask({
  name: "health-check",
  cronExpression: "*/5 * * * *", // Every 5 minutes
  eventType: "health.check",
  payload: {}
});

node.onEvent("health.check", async (event, { client }) => {
  const health = await checkSystemHealth();
  
  await client.query(
    "INSERT INTO health_checks (status, checked_at) VALUES ($1, $2)",
    [health.status, new Date()]
  );
});
```

### Weekly Reports

```typescript
await node.scheduleTask({
  name: "weekly-report",
  cronExpression: "0 9 * * 1", // Monday at 9 AM
  eventType: "report.weekly",
  payload: { reportType: "weekly" }
});

node.onEvent("report.weekly", async (event, { client }) => {
  const report = await generateWeeklyReport();
  await sendReport(report);
});
```

### Hourly Data Sync

```typescript
await node.scheduleTask({
  name: "sync-external-data",
  cronExpression: "0 * * * *", // Every hour
  eventType: "sync.external",
  payload: { source: "external-api" }
});

node.onEvent("sync.external", async (event, { client }) => {
  const data = await fetchExternalData();
  await syncToDatabase(data, client);
});
```

## Task Management

### Checking Task Status

Tasks are stored in `core.scheduled_tasks`:

```sql
SELECT 
  name,
  cron_expression,
  event_type,
  active,
  created_at,
  updated_at
FROM core.scheduled_tasks
WHERE namespace = 'myapp';
```

### Deactivating Tasks

Tasks can be deactivated in the database:

```sql
UPDATE core.scheduled_tasks
SET active = FALSE
WHERE name = 'daily-cleanup';
```

### Deleting Tasks

To permanently remove a task, you need to:
1. Unschedule the cron job
2. Delete from `core.scheduled_tasks`

```sql
-- Get job_id first
SELECT job_id FROM core.scheduled_tasks WHERE name = 'daily-cleanup';

-- Unschedule (replace JOB_ID)
SELECT cron.unschedule(JOB_ID);

-- Delete task record
DELETE FROM core.scheduled_tasks WHERE name = 'daily-cleanup';
```

## How Scheduled Tasks Work

1. **Task Registration**: Task metadata is stored in `core.scheduled_tasks`
2. **Cron Job Creation**: `pg_cron` schedules `core.run_scheduled_task(task_id)`
3. **Task Execution**: When cron fires, the function:
   - Loads task metadata
   - Constructs event envelope
   - Emits event to queue via `pgmq.send()`
   - Appends to event log
4. **Event Processing**: Event flows through normal consumption mechanism

## Best Practices

1. **Use descriptive names**: `"daily-cleanup"` not `"task1"`
2. **Document payloads**: Include comments explaining payload structure
3. **Handle task events**: Always register handlers for scheduled events
4. **Test cron expressions**: Use online cron validators
5. **Consider timezones**: Specify timezone for user-facing schedules
6. **Monitor task execution**: Check `updated_at` to verify tasks are running

## Troubleshooting

### Task Not Running

1. **Check if task is active**:
   ```sql
   SELECT active FROM core.scheduled_tasks WHERE name = 'your-task';
   ```

2. **Verify cron job exists**:
   ```sql
   SELECT * FROM cron.job WHERE jobname LIKE '%your-task%';
   ```

3. **Check cron logs**:
   ```sql
   SELECT * FROM cron.job_run_details 
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'your-task')
   ORDER BY start_time DESC LIMIT 10;
   ```

### Task Running Too Often/Too Rarely

Double-check your cron expression:
- Use [crontab.guru](https://crontab.guru/) to validate
- Remember: cron uses UTC by default (unless timezone specified)

### Task Events Not Being Handled

Ensure you've registered a handler:
```typescript
node.onEvent("your.event.type", async (event) => {
  // Handler logic
});
```

## Next Steps

- Learn about [monitoring tasks](./monitoring.md)
- Understand [event processing](../explanation/event-processing.md)
- See [API reference](../reference/api-reference.md)

