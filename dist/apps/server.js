"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const fastify_1 = __importDefault(require("fastify"));
const dotenv_1 = __importDefault(require("dotenv"));
const core_1 = require("../core");
dotenv_1.default.config();
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/core";
async function main() {
    const connectionString = process.env.CORE_DATABASE_URL ?? DEFAULT_DATABASE_URL;
    const namespace = process.env.CORE_NAMESPACE ?? "demo";
    const nodeId = process.env.CORE_NODE_ID ?? `server-${(0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 6)}`;
    const system = await core_1.CoreSystem.connect({
        connectionString,
        namespace,
        application: "http-api"
    });
    const node = await system.registerNode({
        nodeId,
        displayName: "HTTP API Server",
        description: "Accepts API requests and emits events",
        metadata: { role: "producer" }
    });
    await node.start();
    const app = (0, fastify_1.default)({ logger: true });
    app.get("/health", async () => ({ status: "ok" }));
    app.get("/metrics", async () => {
        const metrics = await system.metrics();
        return metrics;
    });
    app.post("/events", async (request, reply) => {
        const { eventType, payload } = request.body;
        if (!eventType) {
            return reply.status(400).send({ error: "eventType is required" });
        }
        const messageId = await node.emit(eventType, payload ?? {});
        return { status: "queued", messageId };
    });
    const port = Number.parseInt(process.env.PORT ?? "3000", 10);
    const close = async () => {
        await app.close();
        await node.stop();
        await system.close();
    };
    const signals = ["SIGINT", "SIGTERM"];
    signals.forEach((signal) => {
        process.on(signal, async () => {
            app.log.info({ signal }, "shutting down");
            await close();
            process.exit(0);
        });
    });
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info({ port, namespace }, "HTTP API ready");
}
main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start server", error);
    process.exit(1);
});
//# sourceMappingURL=server.js.map