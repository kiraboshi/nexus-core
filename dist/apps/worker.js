"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const dotenv_1 = __importDefault(require("dotenv"));
const core_1 = require("../core");
dotenv_1.default.config();
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/core";
async function main() {
    const connectionString = process.env.CORE_DATABASE_URL ?? DEFAULT_DATABASE_URL;
    const namespace = process.env.CORE_NAMESPACE ?? "demo";
    const nodeId = process.env.CORE_NODE_ID ?? `worker-${(0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 6)}`;
    const eventType = process.env.CORE_WORKER_EVENT ?? "demo.event";
    const scheduleHeartbeat = process.env.CORE_WORKER_SCHEDULE === "true";
    const system = await core_1.CoreSystem.connect({
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
    const signals = ["SIGINT", "SIGTERM"];
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
//# sourceMappingURL=worker.js.map