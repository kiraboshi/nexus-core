"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const node_perf_hooks_1 = require("node:perf_hooks");
const dotenv_1 = __importDefault(require("dotenv"));
const core_1 = require("../core");
dotenv_1.default.config();
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/core";
async function benchmark() {
    const connectionString = process.env.CORE_DATABASE_URL ?? DEFAULT_DATABASE_URL;
    const namespace = process.env.CORE_NAMESPACE ?? "demo";
    const eventType = process.env.BENCH_EVENT_TYPE ?? "benchmark.event";
    const totalEvents = Number.parseInt(process.env.BENCH_TOTAL ?? "200", 10);
    const concurrency = Number.parseInt(process.env.BENCH_CONCURRENCY ?? "16", 10);
    const system = await core_1.CoreSystem.connect({
        connectionString,
        namespace,
        application: "benchmark",
        visibilityTimeoutSeconds: 60,
        batchSize: Math.min(100, concurrency * 2)
    });
    const consumer = await system.registerNode({
        nodeId: `bench-consumer-${(0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 4)}`,
        displayName: "Benchmark Consumer",
        metadata: { role: "consumer", eventType }
    });
    let processed = 0;
    let consumeStart = 0;
    const completionPromise = new Promise((resolve) => {
        consumer.onEvent(eventType, async () => {
            if (processed === 0) {
                consumeStart = node_perf_hooks_1.performance.now();
            }
            processed += 1;
            if (processed >= totalEvents) {
                resolve();
            }
        });
    });
    await consumer.start();
    const producer = await system.registerNode({
        nodeId: `bench-producer-${(0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 4)}`,
        displayName: "Benchmark Producer",
        metadata: { role: "producer", eventType }
    });
    await producer.start();
    const produceStart = node_perf_hooks_1.performance.now();
    const pending = [];
    for (let i = 0; i < totalEvents; i += 1) {
        pending.push(producer.emit(eventType, {
            index: i,
            producedAt: new Date().toISOString()
        }));
        if (pending.length >= concurrency) {
            await Promise.all(pending.splice(0));
        }
    }
    if (pending.length > 0) {
        await Promise.all(pending);
    }
    const produceEnd = node_perf_hooks_1.performance.now();
    await completionPromise;
    const consumeEnd = node_perf_hooks_1.performance.now();
    const produceDurationMs = produceEnd - produceStart;
    const consumeDurationMs = consumeEnd - produceStart;
    const fromFirstConsumeMs = consumeEnd - consumeStart;
    const throughputPerSecond = (totalEvents / consumeDurationMs) * 1000;
    // eslint-disable-next-line no-console
    console.log("Benchmark complete", {
        totalEvents,
        concurrency,
        produceDurationMs: produceDurationMs.toFixed(2),
        endToEndDurationMs: consumeDurationMs.toFixed(2),
        consumerDurationMs: fromFirstConsumeMs.toFixed(2),
        throughputPerSecond: throughputPerSecond.toFixed(2)
    });
    await producer.stop();
    await consumer.stop();
    await system.close();
}
benchmark().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Benchmark failed", error);
    process.exit(1);
});
//# sourceMappingURL=benchmark.js.map