/**
 * Router Service
 * 
 * Centralized service that routes events to worker-specific queues.
 * This service must be running for multi-worker fan-out to work.
 */

import { CoreSystem } from "../core/index.ts";
import { MultiWorkerRouter } from "../core/multiWorkerRouter.ts";
import type { EventEnvelope } from "../core/types.ts";
import { sleep } from "../core/utils.ts";

const ROUTER_QUEUE_NAME = "core_router_events";

async function main() {
  const connectionString = Deno.env.get("CORE_DATABASE_URL");
  const namespace = Deno.env.get("CORE_NAMESPACE") ?? "default";
  const workerId = Deno.env.get("WORKER_ID") ?? `router-${Date.now()}`;

  if (!connectionString) {
    throw new Error("CORE_DATABASE_URL environment variable is required");
  }

  console.log("=".repeat(60));
  console.log("nexus-core Router Service");
  console.log("=".repeat(60));
  console.log(`Namespace: ${namespace}`);
  console.log(`Router ID: ${workerId}`);

  // Connect to core system
  const system = await CoreSystem.connect({
    connectionString,
    namespace,
    application: "router-service"
  });

  // Create router
  const router = new MultiWorkerRouter(
    system.getDatabase(),
    system.getLogger(),
    namespace
  );

  console.log("Router service started");
  console.log("Listening for events on queue:", ROUTER_QUEUE_NAME);

  // Main router loop
  let running = true;
  const { visibilityTimeoutSeconds = 30, batchSize = 10 } = system.getOptions();

  while (running) {
    try {
      // Read from router queue
      const result = await system.getDatabase().query<{
        msg_id: number;
        read_ct: number;
        vt: string;
        enqueued_at: string;
        message: EventEnvelope;
      }>(
        `SELECT * FROM pgmq.read($1, $2, $3)`,
        [ROUTER_QUEUE_NAME, visibilityTimeoutSeconds, batchSize]
      );

      const rows = result.rows;

      if (!rows.length) {
        await sleep(1000);
        continue;
      }

      for (const row of rows) {
        const envelope = row.message ?? ({} as EventEnvelope);
        envelope.messageId = row.msg_id;
        envelope.redeliveryCount = row.read_ct;

        // Route event to worker queues
        const routedQueues = await router.routeEvent(envelope);

        // Acknowledge message after routing
        await system.getDatabase().query(
          `SELECT pgmq.delete($1::text, $2::bigint)`,
          [ROUTER_QUEUE_NAME, row.msg_id]
        );

        system.getLogger().info("Event routed", {
          eventType: envelope.eventType,
          messageId: row.msg_id,
          queueCount: routedQueues.length
        });
      }
    } catch (error) {
      system.getLogger().error(
        error instanceof Error ? error : new Error(String(error)),
        { phase: "router-loop" }
      );
      await sleep(2000);
    }
  }
}

main().catch((error) => {
  console.error("Router service failed:", error);
  Deno.exit(1);
});

