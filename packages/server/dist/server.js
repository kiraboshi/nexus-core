import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import Fastify from "fastify";
import { CoreSystem } from "@nexus-core/core";
dotenv.config();
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/core";
async function main() {
    const connectionString = process.env.CORE_DATABASE_URL ?? DEFAULT_DATABASE_URL;
    const namespace = process.env.CORE_NAMESPACE ?? "demo";
    const nodeId = process.env.CORE_NODE_ID ?? `server-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
    const system = await CoreSystem.connect({
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
    const app = Fastify({ logger: true });
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