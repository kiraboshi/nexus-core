# Building Your First Event-Driven Application

This tutorial walks you through building a complete event-driven application using nexus-core. We'll create a simple user management system that demonstrates event emission, consumption, scheduled tasks, and error handling.

## Application Overview

We'll build a system that:
- Emits events when users are created
- Processes user creation events to send welcome emails
- Schedules daily cleanup tasks
- Handles errors gracefully with dead letter queues

## Project Structure

```
my-user-app/
├── src/
│   ├── index.ts          # Main application entry
│   ├── user-service.ts   # User service (emits events)
│   ├── email-service.ts  # Email service (consumes events)
│   └── cleanup-service.ts # Cleanup service (scheduled tasks)
├── .env
├── tsconfig.json
└── package.json
```

## Step 1: Project Setup

```bash
npm init -y
npm install @nexus-core/core pg dotenv
npm install -D typescript @types/node tsx
```

## Step 2: Database Schema

Create a simple users table. In your database:

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,
  message_id BIGINT,
  processed_at TIMESTAMPTZ DEFAULT now()
);
```

## Step 3: User Service (Event Producer)

Create `src/user-service.ts`:

```typescript
import { CoreSystem, CoreNode } from "@nexus-core/core";
import { Pool } from "pg";

export class UserService {
  private node: CoreNode;
  private db: Pool;

  constructor(system: CoreSystem, db: Pool) {
    this.db = db;
    // We'll register the node in start()
    this.node = null as any; // Temporary
  }

  async initialize(system: CoreSystem) {
    this.node = await system.registerNode({
      displayName: "User Service",
      description: "Handles user creation and emits events",
      metadata: { service: "user-service" }
    });
    await this.node.start();
  }

  async createUser(email: string, name: string) {
    // Insert user into database
    const result = await this.db.query(
      `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
      [email, name]
    );
    const userId = result.rows[0].id;

    // Emit event
    const messageId = await this.node.emit("user.created", {
      userId,
      email,
      name,
      createdAt: new Date().toISOString()
    });

    console.log(`User created: ${email} (event ID: ${messageId})`);
    return { userId, messageId };
  }

  async stop() {
    await this.node.stop();
  }
}
```

## Step 4: Email Service (Event Consumer)

Create `src/email-service.ts`:

```typescript
import { CoreSystem, CoreNode, EventEnvelope } from "@nexus-core/core";
import { Pool } from "pg";

interface UserCreatedPayload {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
}

export class EmailService {
  private node: CoreNode;
  private db: Pool;

  constructor(system: CoreSystem, db: Pool) {
    this.db = db;
    this.node = null as any; // Temporary
  }

  async initialize(system: CoreSystem) {
    this.node = await system.registerNode({
      displayName: "Email Service",
      description: "Sends welcome emails to new users",
      metadata: { service: "email-service" }
    });

    // Register handler for user.created events
    this.node.onEvent("user.created", async (event: EventEnvelope<UserCreatedPayload>, { client }) => {
      const { userId, email, name } = event.payload;

      // Simulate sending email (in production, call your email API)
      console.log(`📧 Sending welcome email to ${email}...`);
      
      // Record that we processed this event
      await client.query(
        `INSERT INTO user_events (user_id, event_type, message_id) 
         VALUES ($1, $2, $3)`,
        [userId, event.eventType, event.messageId]
      );

      // Simulate email delay
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log(`✅ Welcome email sent to ${name} (${email})`);
    });

    await this.node.start();
  }

  async stop() {
    await this.node.stop();
  }
}
```

## Step 5: Cleanup Service (Scheduled Tasks)

Create `src/cleanup-service.ts`:

```typescript
import { CoreSystem, CoreNode } from "@nexus-core/core";
import { Pool } from "pg";

export class CleanupService {
  private node: CoreNode;
  private db: Pool;

  constructor(system: CoreSystem, db: Pool) {
    this.db = db;
    this.node = null as any; // Temporary
  }

  async initialize(system: CoreSystem) {
    this.node = await system.registerNode({
      displayName: "Cleanup Service",
      description: "Runs daily cleanup tasks",
      metadata: { service: "cleanup-service" }
    });

    // Register handler for cleanup events
    this.node.onEvent("cleanup.daily", async (event, { client }) => {
      console.log("🧹 Running daily cleanup...");

      // Delete old user_events older than 30 days
      const result = await client.query(
        `DELETE FROM user_events 
         WHERE processed_at < now() - interval '30 days'`
      );

      console.log(`✅ Cleaned up ${result.rowCount} old event records`);
    });

    // Schedule daily cleanup at 2 AM
    await this.node.scheduleTask({
      name: "daily-cleanup",
      cronExpression: "0 2 * * *", // 2 AM daily
      eventType: "cleanup.daily",
      payload: { retentionDays: 30 }
    });

    await this.node.start();
  }

  async stop() {
    await this.node.stop();
  }
}
```

## Step 6: Main Application

Create `src/index.ts`:

```typescript
import { CoreSystem } from "@nexus-core/core";
import { Pool } from "pg";
import dotenv from "dotenv";
import { UserService } from "./user-service";
import { EmailService } from "./email-service";
import { CleanupService } from "./cleanup-service";

dotenv.config();

async function main() {
  // Connect to database
  const db = new Pool({
    connectionString: process.env.CORE_DATABASE_URL || 
      "postgres://postgres:postgres@localhost:5432/core"
  });

  // Connect to core system
  const system = await CoreSystem.connect({
    connectionString: process.env.CORE_DATABASE_URL || 
      "postgres://postgres:postgres@localhost:5432/core",
    namespace: "userapp"
  });

  // Initialize services
  const userService = new UserService(system, db);
  const emailService = new EmailService(system, db);
  const cleanupService = new CleanupService(system, db);

  await userService.initialize(system);
  await emailService.initialize(system);
  await cleanupService.initialize(system);

  console.log("🚀 Application started!");

  // Create some test users
  await userService.createUser("alice@example.com", "Alice");
  await userService.createUser("bob@example.com", "Bob");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down...");
    await userService.stop();
    await emailService.stop();
    await cleanupService.stop();
    await system.close();
    await db.end();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process running
  setInterval(() => {
    // Application keeps running
  }, 1000);
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

## Step 7: Run the Application

```bash
npm run dev
```

You should see:
```
🚀 Application started!
User created: alice@example.com (event ID: 1)
📧 Sending welcome email to alice@example.com...
✅ Welcome email sent to Alice (alice@example.com)
User created: bob@example.com (event ID: 2)
📧 Sending welcome email to bob@example.com...
✅ Welcome email sent to Bob (bob@example.com)
```

## Step 8: Add Error Handling

Let's enhance the email service to handle errors:

```typescript
this.node.onEvent("user.created", async (event: EventEnvelope<UserCreatedPayload>, { client }) => {
  const { userId, email, name } = event.payload;

  try {
    // Validate email format
    if (!email.includes("@")) {
      throw new Error(`Invalid email format: ${email}`);
    }

    console.log(`📧 Sending welcome email to ${email}...`);
    
    await client.query(
      `INSERT INTO user_events (user_id, event_type, message_id) 
       VALUES ($1, $2, $3)`,
      [userId, event.eventType, event.messageId]
    );

    // Simulate potential failure
    if (Math.random() < 0.1) {
      throw new Error("Email service temporarily unavailable");
    }

    console.log(`✅ Welcome email sent to ${name} (${email})`);
  } catch (error) {
    console.error(`❌ Failed to send email to ${email}:`, error);
    // Event will be moved to dead letter queue automatically
    throw error; // Re-throw to trigger DLQ
  }
});
```

## Step 9: Monitor Dead Letter Queue

Add monitoring to check the DLQ:

```typescript
// In main()
setInterval(async () => {
  const metrics = await system.metrics();
  if (metrics.deadLetterQueueDepth > 0) {
    console.warn(`⚠️  DLQ has ${metrics.deadLetterQueueDepth} messages`);
  }
}, 5000);
```

## Key Concepts Demonstrated

1. **Event Emission**: User service emits events when users are created
2. **Event Consumption**: Email service consumes and processes events
3. **Scheduled Tasks**: Cleanup service runs on a cron schedule
4. **Transactional Processing**: All handlers execute within transactions
5. **Error Handling**: Failed events move to dead letter queue
6. **Multiple Services**: Different services can consume the same events

## Next Steps

- Add more event types (user.updated, user.deleted)
- Implement retry logic for failed emails
- Add monitoring and metrics
- Scale horizontally with multiple workers
- Read about [production deployment](../how-to/production-deployment.md)

## Summary

You've built a complete event-driven application that:
- ✅ Emits events when users are created
- ✅ Consumes events to send emails
- ✅ Schedules recurring cleanup tasks
- ✅ Handles errors with dead letter queues
- ✅ Uses transactions for consistency

This pattern can be extended to build complex, scalable event-driven systems!

