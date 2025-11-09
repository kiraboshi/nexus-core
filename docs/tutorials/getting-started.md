# Getting Started with nexus-core

This tutorial will guide you through setting up nexus-core and creating your first event-driven application. By the end, you'll have a working application that can emit and consume events.

## Prerequisites

- Node.js 18+ installed
- PostgreSQL 17+ installed (or Docker)
- Basic knowledge of TypeScript/JavaScript
- Basic understanding of event-driven architecture

## Step 1: Install Dependencies

Create a new project directory and initialize it:

```bash
mkdir my-nexus-app
cd my-nexus-app
npm init -y
npm install @nexus-core/core pg
npm install -D typescript @types/node tsx
```

## Step 2: Set Up PostgreSQL

### Option A: Using Docker (Recommended)

If you have Docker installed, use the provided setup:

```bash
# Clone or download nexus-core repository
cd nexus-core
docker-compose up -d
```

This starts PostgreSQL with all required extensions on port `6543`.

### Option B: Local PostgreSQL

If you have PostgreSQL installed locally:

1. Create a database:
```sql
CREATE DATABASE core;
```

2. Install required extensions:
```sql
CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_partman;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

See [Setting Up PostgreSQL](../how-to/setup-postgres.md) for detailed instructions.

## Step 3: Create Your First Application

Create a file `src/index.ts`:

```typescript
import { CoreSystem } from "@nexus-core/core";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  // Connect to the core system
  const system = await CoreSystem.connect({
    connectionString: process.env.CORE_DATABASE_URL || 
      "postgres://postgres:postgres@localhost:5432/core",
    namespace: "tutorial"
  });

  // Register a node
  const node = await system.registerNode({
    displayName: "Tutorial Node",
    description: "My first nexus-core node",
    metadata: { version: "1.0.0" }
  });

  // Register an event handler
  node.onEvent("greeting", async (event, { client }) => {
    console.log("Received greeting:", event.payload);
    console.log("Message ID:", event.messageId);
    console.log("From node:", event.producerNodeId);
  });

  // Start the node (begins consuming events)
  await node.start();

  // Emit an event
  const messageId = await node.emit("greeting", {
    message: "Hello, nexus-core!",
    timestamp: new Date().toISOString()
  });

  console.log(`Event emitted with message ID: ${messageId}`);

  // Keep the process running
  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await node.stop();
    await system.close();
    process.exit(0);
  });
}

main().catch(console.error);
```

## Step 4: Configure Environment

Create a `.env` file:

```env
CORE_DATABASE_URL=postgres://postgres:postgres@localhost:5432/core
CORE_NAMESPACE=tutorial
```

**Note**: If using Docker, the port is `6543`:
```env
CORE_DATABASE_URL=postgres://postgres:postgres@localhost:6543/core
```

## Step 5: Create TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

## Step 6: Add Scripts

Update `package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

## Step 7: Run Your Application

```bash
npm run dev
```

You should see output like:
```
Event emitted with message ID: 1
Received greeting: { message: 'Hello, nexus-core!', timestamp: '...' }
Message ID: 1
From node: <node-id>
```

## What Happened?

1. **System Connection**: `CoreSystem.connect()` initializes the database schema, creates queues, and sets up partitioning.

2. **Node Registration**: Your application registers as a "node" in the namespace. Each node can both emit and consume events.

3. **Event Handler**: `onEvent()` registers a handler that will be called when events of type `"greeting"` are received.

4. **Node Start**: `node.start()` begins the consumer loop that polls for messages.

5. **Event Emission**: `node.emit()` sends an event to the queue. The event is:
   - Enqueued via `pgmq`
   - Logged to `core.event_log`
   - Consumed by your handler
   - Acknowledged after successful processing

## Next Steps

- Learn about [emitting events](../how-to/emit-events.md)
- Learn about [handling events](../how-to/handle-events.md)
- Explore [scheduling tasks](../how-to/schedule-tasks.md)
- Read the [architecture overview](../explanation/architecture.md)

## Troubleshooting

### "Extension pgmq does not exist"
Make sure PostgreSQL extensions are installed. See [Setting Up PostgreSQL](../how-to/setup-postgres.md).

### "Connection refused"
- Check PostgreSQL is running
- Verify connection string in `.env`
- If using Docker, ensure container is running: `docker ps`

### "No handlers registered for event type"
This is normal if you emit an event before starting the node or registering handlers. Events are queued and will be processed when handlers are available.

## Summary

You've successfully:
- ✅ Set up PostgreSQL with required extensions
- ✅ Created a nexus-core application
- ✅ Emitted and consumed your first event
- ✅ Understood the basic flow

Congratulations! You're ready to build event-driven applications with nexus-core.

