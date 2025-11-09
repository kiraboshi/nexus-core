# Core System Prototype

TypeScript / Node.js prototype of a centrally managed workflow and eventing core built entirely on PostgreSQL primitives. The library exposes a simple integration surface that lets independently deployed services register as "nodes" inside a namespace, emit events, consume events, and schedule recurring tasks without relying on external brokers or schedulers.

## Postgres Architecture

The system assumes a PostgreSQL database named `core` is available with the following extensions installed:

- `pgmq` — queue abstraction with visibility timeouts and dead-letter queues.
- `pg_cron` — in-database job scheduling, used for cron-style triggers.
- `pg_partman` — automated partition management for the `core.event_log` table.
- `pg_stat_statements` — query-level observability.

The `CoreInitializer` runs `CREATE EXTENSION IF NOT EXISTS` statements for each of these, so the connecting role must have sufficient privileges (e.g. superuser). It also installs helper functions, schedules table partitioning, and ensures the queues (`core_events_<namespace>`, `<namespace>_dlq`) exist.

### Schema Highlights

- `core.namespaces` — registered namespaces.
- `core.nodes` — active nodes with heartbeat tracking.
- `core.event_log` — partitioned append-only log of emitted events.
- `core.scheduled_tasks` — metadata for pg_cron jobs that enqueue events.
- `core.run_scheduled_task(uuid)` — invoked by cron to enqueue task payloads.

## Getting Started

### Option 1: Docker/Containerd Setup (Recommended for Windows)

The easiest way to get started on Windows is using Docker or containerd:

```powershell
# Start PostgreSQL with all extensions pre-installed
.\scripts\setup-docker.ps1 -StartContainer

# Or use docker-compose/nerdctl compose directly
docker-compose up -d
# OR (if using containerd)
nerdctl compose up -d
```

The setup script automatically detects whether you're using Docker or containerd (via nerdctl).

This will:
- Build a custom PostgreSQL image with all required extensions
- Start a container with the `core` database
- Automatically install all extensions on first startup

Connection details:
- URL: `postgres://postgres:postgres@localhost:6543/core`
- See `docker/README.md` for more details

### Option 2: Local PostgreSQL Setup

If you have PostgreSQL installed locally:

```bash
npm install
cp example.env .env        # adjust connection details
npm run build
```

**Installing Extensions:**

- **Windows**: See `scripts/INSTALL_EXTENSIONS_WINDOWS.md`
- **Linux/macOS**: Install via package manager (e.g., `apt-get install postgresql-17-cron`)
- **Or use the installation script**: `.\scripts\install_extensions.ps1`

### Environment Variables

Environment variables (see `example.env`):

- `CORE_DATABASE_URL` — Postgres URL, defaults to `postgres://postgres:postgres@localhost:5432/core`.
- `CORE_NAMESPACE` — logical namespace grouping related nodes (defaults to `demo`).
- `CORE_NODE_ID` — optional stable node identifier.
- `PORT` — HTTP port for the sample server.
- Worker / benchmark knobs (`CORE_WORKER_EVENT`, `CORE_WORKER_SCHEDULE`, `BENCH_TOTAL`, `BENCH_CONCURRENCY`).

## Library Usage

```ts
import { CoreSystem } from "@nexus-core/core";

const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "demo"
});

const node = await system.registerNode({
  displayName: "api",
  metadata: { role: "producer" }
});

node.onEvent("demo.event", async (event, { client }) => {
  await client.query("insert into acknowledgements(node_id, msg_id) values ($1, $2)", [
    node.nodeId,
    event.messageId
  ]);
});

await node.start();
await node.emit("demo.event", { hello: "world" });
```

### Scheduling Tasks

```ts
await node.scheduleTask({
  name: "cleanup",
  cronExpression: "*/5 * * * *",
  eventType: "maintenance.cleanup",
  payload: { limit: 100 }
});
```

This registers metadata in `core.scheduled_tasks` and calls `cron.schedule` to execute `core.run_scheduled_task(uuid)` on the specified cadence.

## Monorepo Structure

This project is organized as a monorepo with the following packages:

- `packages/core` — Core library providing `CoreSystem`, `CoreNode`, and database abstractions
- `packages/server` — Fastify HTTP API that emits events via `POST /events` and exposes queue metrics at `GET /metrics`
- `packages/worker` — Simple worker that consumes events, logs acknowledgements, and (optionally) schedules a heartbeat task
- `packages/nexus-cli` — Interactive CLI tool for database interrogation using a menu-driven interface

## Example Applications

Run them during development:

```bash
npm run dev:server
npm run dev:worker
```

## Nexus CLI

The `nexus-cli` package provides an interactive terminal interface for quickly interrogating the database:

```bash
npm run nexus
```

Features:
- Browse database tables and view data
- Run SQL queries
- View system metrics (queue depths, registered nodes)

See `packages/nexus-cli/README.md` for more details.

## Benchmark Harness

`npm run benchmark` sends a configurable burst of events and measures enqueue / dequeue throughput using in-process producer and consumer nodes. Tune concurrency and batch sizes with `BENCH_TOTAL` and `BENCH_CONCURRENCY`.

## Graceful Shutdown & Heartbeats

Each node maintains a heartbeat by calling `core.touch_node_heartbeat`. Consumers poll `pgmq.read` with configurable visibility timeout and batch size, move failures into a namespace-specific dead-letter queue, and wrap handler execution inside a single transaction to simplify side-effect management.

## Next Steps

- Harden schema migrations (ideally integrate with a migration tool instead of bootstrapping ad-hoc).
- Layer richer metrics (e.g. using Prometheus) and alerting for DLQ backlogs.
- Add integration tests that spin up ephemeral Postgres containers to validate queue behaviour end-to-end.

