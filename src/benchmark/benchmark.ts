import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import dotenv from "dotenv";
import { CoreSystem } from "../core/index.ts";

dotenv.config();

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/core";

async function benchmark() {
  const connectionString = process.env.CORE_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const namespace = process.env.CORE_NAMESPACE ?? "demo";
  const eventType = process.env.BENCH_EVENT_TYPE ?? "benchmark.event";
  const totalEvents = Number.parseInt(process.env.BENCH_TOTAL ?? "200", 10);
  const concurrency = Number.parseInt(process.env.BENCH_CONCURRENCY ?? "16", 10);

  const system = await CoreSystem.connect({
    connectionString,
    namespace,
    application: "benchmark",
    visibilityTimeoutSeconds: 60,
    batchSize: Math.min(100, concurrency * 2)
  });

  const consumer = await system.registerNode({
    nodeId: `bench-consumer-${randomUUID().replace(/-/g, "").slice(0, 4)}`,
    displayName: "Benchmark Consumer",
    metadata: { role: "consumer", eventType }
  });

  let processed = 0;
  let consumeStart = 0;

  const completionPromise = new Promise<void>((resolve) => {
    consumer.onEvent(eventType, async () => {
      if (processed === 0) {
        consumeStart = performance.now();
      }
      processed += 1;
      if (processed >= totalEvents) {
        resolve();
      }
    });
  });

  await consumer.start();

  const producer = await system.registerNode({
    nodeId: `bench-producer-${randomUUID().replace(/-/g, "").slice(0, 4)}`,
    displayName: "Benchmark Producer",
    metadata: { role: "producer", eventType }
  });

  await producer.start();

  const produceStart = performance.now();
  const pending: Array<Promise<unknown>> = [];

  for (let i = 0; i < totalEvents; i += 1) {
    pending.push(
      producer.emit(eventType, {
        index: i,
        producedAt: new Date().toISOString()
      })
    );

    if (pending.length >= concurrency) {
      await Promise.all(pending.splice(0));
    }
  }

  if (pending.length > 0) {
    await Promise.all(pending);
  }

  const produceEnd = performance.now();
  await completionPromise;
  const consumeEnd = performance.now();

  const produceDurationMs = produceEnd - produceStart;
  const consumeDurationMs = consumeEnd - produceStart;
  const fromFirstConsumeMs = consumeEnd - consumeStart;
  const throughputPerSecond = (totalEvents / consumeDurationMs) * 1_000;

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

