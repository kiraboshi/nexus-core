import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { CoreSystem } from "../core";

dotenv.config();

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/core";

async function main() {
  const connectionString = process.env.CORE_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const namespace = process.env.CORE_NAMESPACE ?? "demo";
  const nodeId =
    process.env.CORE_NODE_ID ?? `worker-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  const eventType = process.env.CORE_WORKER_EVENT ?? "demo.event";
  const scheduleHeartbeat = process.env.CORE_WORKER_SCHEDULE === "true";

  const system = await CoreSystem.connect({
    connectionString,
    namespace,
    application: "worker"
  });

  const node = await system.registerNode({
    nodeId,
    displayName: "Worker Node",
    description: "Consumes events and performs acknowledgements",
    metadata: { role: "consumer", eventType }
  });

  node.onEvent(eventType, async (event) => {
    // eslint-disable-next-line no-console
    console.log(`[worker:${nodeId}] received event`, {
      eventType: event.eventType,
      payload: event.payload,
      messageId: event.messageId,
      redeliveryCount: event.redeliveryCount
    });
  });

  await node.start();

  if (scheduleHeartbeat) {
    await node.scheduleTask({
      name: `worker-heartbeat-${nodeId}`,
      cronExpression: "* * * * *",
      eventType: `${eventType}.heartbeat`,
      payload: { nodeId }
    });
  }

  const shutdown = async () => {
    await node.stop();
    await system.close();
  };

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      // eslint-disable-next-line no-console
      console.log(`received ${signal}, shutting down worker`);
      await shutdown();
      process.exit(0);
    });
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Worker failed to start", error);
  process.exit(1);
});

