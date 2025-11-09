# nexus-core

A PostgreSQL-native event-driven message bus system that provides publish-subscribe messaging, event logging, scheduled task execution, and node lifecycle management entirely within PostgreSQL.

## Features

- **PostgreSQL-Native**: No external dependencies (Redis, RabbitMQ, etc.)
- **Event-Driven**: Publish and consume events with transactional guarantees
- **Scheduled Tasks**: Cron-based recurring tasks that emit events
- **Multi-Tenancy**: Namespace isolation for logical separation
- **Dead Letter Queue**: Failed messages preserved for inspection/recovery
- **Worker-Optional**: Standalone mode or enhanced mode with workers

## Quick Start

### Option 1: Docker (Recommended)

```powershell
# Start PostgreSQL with all extensions pre-installed
.\scripts\setup-docker.ps1 -StartContainer

# Or use docker-compose
docker-compose up -d
```

Connection: `postgres://postgres:postgres@localhost:6543/core`

See [Setting Up PostgreSQL](./docs/how-to/setup-postgres.md) for complete Docker setup instructions.

### Option 2: Local PostgreSQL

```bash
npm install
cp example.env .env
npm run build
```

Install extensions (see [docs/how-to/setup-postgres.md](./docs/how-to/setup-postgres.md)).

## Basic Usage

```typescript
import { CoreSystem } from "@nexus-core/core";

// Connect to system
const system = await CoreSystem.connect({
  connectionString: process.env.CORE_DATABASE_URL!,
  namespace: "myapp"
});

// Register a node
const node = await system.registerNode({
  displayName: "My Node"
});

// Register event handler
node.onEvent("user.created", async (event, { client }) => {
  console.log("User created:", event.payload);
});

// Start consuming
await node.start();

// Emit event
await node.emit("user.created", {
  userId: "123",
  email: "user@example.com"
});
```

## Documentation

📚 **Complete documentation is available in the [`docs/`](./docs/) directory:**

- **[Getting Started](./docs/tutorials/getting-started.md)** - Your first steps with nexus-core
- **[How-to Guides](./docs/how-to/)** - Task-oriented instructions
- **[API Reference](./docs/reference/api-reference.md)** - Complete API documentation
- **[Architecture](./docs/explanation/architecture.md)** - System design and concepts

See [docs/README.md](./docs/README.md) for the full documentation index.

## Monorepo Structure

- `packages/core` - Core library (`CoreSystem`, `CoreNode`, database abstractions)
- `packages/server` - Fastify HTTP API (emits events via `POST /events`)
- `packages/worker` - Simple worker (consumes events, logs acknowledgements)
- `packages/nexus-cli` - Interactive CLI for database interrogation

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run example applications
npm run dev:server
npm run dev:worker

# Run Nexus CLI
npm run cli

# Run benchmarks
npm run benchmark
```

## Environment Variables

See `example.env` for all available options:

- `CORE_DATABASE_URL` - PostgreSQL connection string
- `CORE_NAMESPACE` - Namespace identifier (defaults to `demo`)
- `CORE_NODE_ID` - Optional stable node identifier
- `PORT` - HTTP port for server package

## Requirements

- Node.js 18+
- PostgreSQL 17+ with extensions:
  - `pgmq` - Message queue functionality
  - `pg_cron` - In-database job scheduling
  - `pg_partman` - Automated partition management
  - `pg_stat_statements` - Query performance monitoring

## License

ISC

## Contributing

Contributions welcome! Please open an issue or submit a pull request.
