"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCoreRuntime = void 0;
const node_crypto_1 = require("node:crypto");
const pg_1 = require("pg");
const effect_1 = require("effect");
const utils_1 = require("./utils");
const toError = (error) => (error instanceof Error ? error : new Error(String(error)));
const acquirePool = (connectionString) => effect_1.Effect.tryPromise({
    try: () => Promise.resolve(new pg_1.Pool({ connectionString })),
    catch: toError
});
const releasePool = (pool) => effect_1.Effect.promise(() => pool.end());
const withClient = (pool, f) => effect_1.Effect.acquireUseRelease(effect_1.Effect.tryPromise({
    try: () => pool.connect(),
    catch: toError
}), (client) => f(client), (client) => effect_1.Effect.sync(() => client.release()));
const withTransaction = (pool, f) => withClient(pool, (client) => effect_1.Effect.uninterruptibleMask((restore) => effect_1.Effect.flatMap(effect_1.Effect.tryPromise({
    try: () => client.query("begin"),
    catch: toError
}), () => effect_1.Effect.matchEffect(restore(f(client)), {
    onFailure: (error) => effect_1.Effect.flatMap(effect_1.Effect.tryPromise({
        try: () => client.query("rollback"),
        catch: toError
    }), () => effect_1.Effect.fail(error)),
    onSuccess: (result) => effect_1.Effect.flatMap(effect_1.Effect.tryPromise({
        try: () => client.query("commit"),
        catch: toError
    }), () => effect_1.Effect.succeed(result))
}))));
const sleep = (ms) => effect_1.Effect.sleep(effect_1.Duration.millis(ms));
const EXTENSION_QUERIES = [
    "CREATE EXTENSION IF NOT EXISTS pg_cron",
    "CREATE EXTENSION IF NOT EXISTS pg_stat_statements",
    "CREATE EXTENSION IF NOT EXISTS pg_partman",
    "CREATE EXTENSION IF NOT EXISTS pgmq"
];
const ensureExtensions = (pool) => effect_1.Effect.forEach(EXTENSION_QUERIES, (query) => withClient(pool, (client) => effect_1.Effect.tryPromise({
    try: () => client.query(query),
    catch: toError
}).pipe(effect_1.Effect.asVoid)), { discard: true });
const ensureSchema = (pool) => withClient(pool, (client) => effect_1.Effect.forEach([
    `CREATE SCHEMA IF NOT EXISTS core`,
    `CREATE TABLE IF NOT EXISTS core.namespaces (
          namespace TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        )`,
    `CREATE TABLE IF NOT EXISTS core.nodes (
          node_id TEXT PRIMARY KEY,
          namespace TEXT NOT NULL REFERENCES core.namespaces(namespace) ON DELETE CASCADE,
          display_name TEXT,
          description TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT core_nodes_namespace_node UNIQUE(namespace, node_id)
        )`,
    `CREATE TABLE IF NOT EXISTS core.scheduled_tasks (
          task_id UUID PRIMARY KEY,
          namespace TEXT NOT NULL REFERENCES core.namespaces(namespace) ON DELETE CASCADE,
          job_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          cron_expression TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          timezone TEXT,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
    `CREATE TABLE IF NOT EXISTS core.event_log (
          event_id BIGSERIAL,
          namespace TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload JSONB NOT NULL,
          emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          producer_node_id TEXT,
          scheduled_task_id UUID,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(event_id, emitted_at)
        ) PARTITION BY RANGE (emitted_at)`,
    `CREATE INDEX IF NOT EXISTS idx_core_event_log_namespace ON core.event_log(namespace)`,
    `CREATE INDEX IF NOT EXISTS idx_core_event_log_event_type ON core.event_log(event_type)`,
    `CREATE OR REPLACE FUNCTION core.touch_node_heartbeat(p_node_id TEXT)
         RETURNS VOID
         LANGUAGE plpgsql
         AS $$
         BEGIN
           UPDATE core.nodes
           SET last_heartbeat = now()
           WHERE node_id = p_node_id;
         END;
         $$`,
    `CREATE OR REPLACE FUNCTION core.append_event_log(
          p_namespace TEXT,
          p_event_type TEXT,
          p_payload JSONB,
          p_producer_node_id TEXT,
          p_scheduled_task_id UUID DEFAULT NULL,
          p_metadata JSONB DEFAULT '{}'::jsonb
        ) RETURNS BIGINT
        LANGUAGE plpgsql
        AS $$
        DECLARE
          v_event_id BIGINT;
        BEGIN
          INSERT INTO core.event_log(namespace, event_type, payload, producer_node_id, scheduled_task_id, metadata)
          VALUES (p_namespace, p_event_type, p_payload, p_producer_node_id, p_scheduled_task_id, p_metadata)
          RETURNING event_id INTO v_event_id;
          RETURN v_event_id;
        END;
        $$`,
    `CREATE OR REPLACE FUNCTION core.queue_name_for_namespace(p_namespace TEXT)
         RETURNS TEXT
         LANGUAGE SQL
         AS $$
         SELECT 'core_events_' || replace(p_namespace, '-', '_');
         $$`,
    `CREATE OR REPLACE FUNCTION core.dead_letter_queue_name_for_namespace(p_namespace TEXT)
         RETURNS TEXT
         LANGUAGE SQL
         AS $$
         SELECT core.queue_name_for_namespace(p_namespace) || '_dlq';
         $$`,
    `CREATE OR REPLACE FUNCTION core.run_scheduled_task(p_task_id UUID)
         RETURNS VOID
         LANGUAGE plpgsql
         AS $$
         DECLARE
           v_task core.scheduled_tasks%ROWTYPE;
           v_queue TEXT;
         BEGIN
           SELECT * INTO v_task FROM core.scheduled_tasks WHERE task_id = p_task_id AND active;
           IF NOT FOUND THEN
             RAISE NOTICE 'Scheduled task % not found or inactive', p_task_id;
             RETURN;
           END IF;

           v_queue := core.queue_name_for_namespace(v_task.namespace);
           PERFORM pgmq.send(
             v_queue,
             jsonb_build_object(
               'namespace', v_task.namespace,
               'eventType', v_task.event_type,
               'payload', v_task.payload,
               'emittedAt', now(),
               'producerNodeId', 'scheduler',
               'scheduledTaskId', v_task.task_id
             )
           );

           PERFORM core.append_event_log(
             v_task.namespace,
             v_task.event_type,
             v_task.payload,
             'scheduler',
             v_task.task_id,
             jsonb_build_object('jobId', v_task.job_id)
           );

           UPDATE core.scheduled_tasks
           SET updated_at = now()
           WHERE task_id = p_task_id;
         END;
         $$`
], (query) => effect_1.Effect.tryPromise({
    try: () => client.query(query),
    catch: toError
}).pipe(effect_1.Effect.asVoid), { discard: true }));
const ensureNamespace = (pool, namespace) => withClient(pool, (client) => effect_1.Effect.tryPromise({
    try: () => client.query(`INSERT INTO core.namespaces(namespace) VALUES($1) ON CONFLICT (namespace) DO NOTHING`, [namespace]),
    catch: toError
}).pipe(effect_1.Effect.asVoid));
const ensureQueues = (pool, namespace) => {
    const queueName = `core_events_${(0, utils_1.sanitizeIdentifier)(namespace)}`;
    const deadLetterQueueName = `${queueName}_dlq`;
    const makeQueue = (name) => withClient(pool, (client) => effect_1.Effect.tryPromise({
        try: () => client.query(`DO $$
             BEGIN
               PERFORM pgmq.create_queue($1);
             EXCEPTION WHEN others THEN
               PERFORM 1;
             END;
             $$;`, [name]),
        catch: toError
    }).pipe(effect_1.Effect.asVoid));
    return effect_1.Effect.all([makeQueue(queueName), makeQueue(deadLetterQueueName)], { concurrency: "unbounded", discard: true });
};
const ensurePartitioning = (pool) => withClient(pool, (client) => effect_1.Effect.tryPromise({
    try: () => client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM partman.part_config WHERE parent_table = 'core.event_log'
            ) THEN
              PERFORM partman.create_parent(
                p_parent_table => 'core.event_log',
                p_control => 'emitted_at',
                p_type => 'native',
                p_interval => 'monthly',
                p_premake => 6,
                p_retention => '6 months',
                p_retention_keep_table => false
              );
            END IF;
          EXCEPTION WHEN undefined_table THEN
            RAISE NOTICE 'pg_partman not available, skipping partition setup';
          END;
          $$;
        `),
    catch: toError
}).pipe(effect_1.Effect.asVoid));
const initialize = (pool, namespace) => effect_1.Effect.all([ensureExtensions(pool), ensureSchema(pool), ensureNamespace(pool, namespace), ensureQueues(pool, namespace), ensurePartitioning(pool)], { concurrency: "unbounded", discard: true });
const decorateEnvelope = (row, namespace) => {
    const envelope = row.message ?? {};
    envelope.namespace = envelope.namespace ?? namespace;
    envelope.eventType = envelope.eventType ?? "unknown";
    envelope.payload = envelope.payload ?? {};
    envelope.emittedAt = envelope.emittedAt ?? row.enqueued_at ?? (0, utils_1.nowIso)();
    envelope.producerNodeId = envelope.producerNodeId ?? "unknown";
    envelope.messageId = row.msg_id;
    envelope.redeliveryCount = row.read_ct;
    return envelope;
};
const appendEventLog = (config, envelope) => withClient(config.pool, (client) => effect_1.Effect.tryPromise({
    try: () => client.query(`SELECT core.append_event_log($1, $2, $3::jsonb, $4, $5, $6::jsonb)`, [
        envelope.namespace,
        envelope.eventType,
        envelope.payload ?? {},
        envelope.producerNodeId,
        envelope.scheduledTaskId ?? null,
        {
            messageId: envelope.messageId,
            redeliveryCount: envelope.redeliveryCount ?? 0
        }
    ]),
    catch: toError
}).pipe(effect_1.Effect.asVoid));
const acknowledge = (config, messageId) => withClient(config.pool, (client) => effect_1.Effect.tryPromise({
    try: () => client.query(`SELECT pgmq.delete($1, $2)`, [config.queueName, messageId]),
    catch: toError
}).pipe(effect_1.Effect.asVoid));
const moveToDeadLetter = (config, row, reason, error) => {
    const payload = {
        originalEvent: decorateEnvelope(row, config.namespace),
        reason,
        failedAt: (0, utils_1.nowIso)(),
        error: error ? error.stack ?? error.message : undefined
    };
    return effect_1.Effect.zipRight(withClient(config.pool, (client) => effect_1.Effect.tryPromise({
        try: () => client.query(`SELECT pgmq.send($1, $2::jsonb)`, [config.deadLetterQueueName, payload]),
        catch: toError
    }).pipe(effect_1.Effect.asVoid)), acknowledge(config, row.msg_id));
};
const createScheduledTaskEffect = (config, definition) => effect_1.Effect.gen(function* (_) {
    const taskId = (0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 16);
    const jobName = `${config.namespace}_${(0, utils_1.sanitizeIdentifier)(definition.name)}_${taskId}`;
    const cronCommand = `SELECT core.run_scheduled_task('${taskId}')`;
    const jobResult = yield* _(withClient(config.pool, (client) => effect_1.Effect.tryPromise({
        try: () => client.query(`SELECT cron.schedule($1, $2, $3) AS job_id`, [jobName, definition.cronExpression, cronCommand]),
        catch: toError
    })));
    const jobId = jobResult.rows[0]?.job_id;
    if (!jobId) {
        return yield* _(effect_1.Effect.fail(new Error(`Failed to schedule cron job for task ${definition.name}`)));
    }
    const insertResult = yield* _(withClient(config.pool, (client) => effect_1.Effect.tryPromise({
        try: () => client.query(`INSERT INTO core.scheduled_tasks(
               task_id, namespace, job_id, name, cron_expression, event_type, payload, timezone)
             VALUES($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
             RETURNING task_id, job_id, name, cron_expression, event_type, payload, timezone, active, created_at, updated_at`, [
            taskId,
            config.namespace,
            jobId,
            definition.name,
            definition.cronExpression,
            definition.eventType,
            definition.payload ?? {},
            definition.timezone ?? null
        ]),
        catch: toError
    })));
    const task = insertResult.rows[0];
    return {
        name: task.name,
        cronExpression: task.cron_expression,
        eventType: task.event_type,
        payload: task.payload ?? {},
        taskId,
        jobId,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        active: task.active,
        timezone: task.timezone ?? undefined
    };
});
const emitEvent = (config, nodeId, eventType, payload) => effect_1.Effect.gen(function* (_) {
    const envelope = {
        namespace: config.namespace,
        eventType,
        payload,
        emittedAt: (0, utils_1.nowIso)(),
        producerNodeId: nodeId
    };
    const result = yield* _(withClient(config.pool, (client) => effect_1.Effect.tryPromise({
        try: () => client.query(`SELECT pgmq.send($1, $2::jsonb)`, [config.queueName, envelope]),
        catch: toError
    })));
    const messageId = result.rows[0]?.send ?? 0;
    envelope.messageId = messageId;
    yield* _(appendEventLog(config, envelope));
    yield* _(effect_1.Effect.logDebug("core.effect: event emitted", { eventType, messageId }));
    return messageId;
});
const heartbeatLoop = (config, nodeId) => effect_1.Effect.repeat(withClient(config.pool, (client) => effect_1.Effect.tryPromise({
    try: () => client.query(`SELECT core.touch_node_heartbeat($1)`, [nodeId]),
    catch: toError
}).pipe(effect_1.Effect.asVoid)).pipe(effect_1.Effect.catchAll((error) => effect_1.Effect.logWarning("core.effect: heartbeat failure", error)), effect_1.Effect.zipRight(sleep(30000))), effect_1.Schedule.forever);
const readQueue = (config) => withClient(config.pool, (client) => effect_1.Effect.tryPromise({
    try: () => client.query(`SELECT * FROM pgmq.read($1, $2, $3)`, [config.queueName, config.visibilityTimeoutSeconds, config.batchSize]),
    catch: toError
}));
const consumerLoop = (config, handlersRef, stopSignal) => effect_1.Effect.gen(function* (_) {
    while (true) {
        const readResult = yield* _(readQueue(config).pipe(effect_1.Effect.catchAll((error) => effect_1.Effect.logError("core.effect: pgmq.read failed", error).pipe(effect_1.Effect.zipRight(effect_1.Effect.succeed({ rows: [] }))))));
        if (readResult.rows.length === 0) {
            yield* _(sleep(config.idlePollIntervalMs));
            if (yield* _(effect_1.Deferred.isDone(stopSignal))) {
                return;
            }
            continue;
        }
        for (const row of readResult.rows) {
            const envelope = decorateEnvelope(row, config.namespace);
            const handlersMap = yield* _(effect_1.Ref.get(handlersRef));
            const handlersOption = effect_1.HashMap.get(handlersMap, envelope.eventType);
            if (effect_1.Option.isNone(handlersOption) || effect_1.Chunk.isEmpty(handlersOption.value)) {
                yield* _(moveToDeadLetter(config, row, `No handler for event ${envelope.eventType}`));
                continue;
            }
            const handlersChunk = handlersOption.value;
            yield* _(withTransaction(config.pool, (client) => effect_1.Effect.forEach(handlersChunk, (handler) => handler(envelope, { client }), {
                discard: true
            })).pipe(effect_1.Effect.catchAll((error) => moveToDeadLetter(config, row, "Handler error", error))));
            yield* _(acknowledge(config, row.msg_id));
        }
    }
}).pipe(effect_1.Effect.onInterrupt(() => effect_1.Deferred.succeed(stopSignal, undefined)));
const defaultHandlersMap = effect_1.HashMap.empty();
const addHandler = (handlersRef, eventType, handler) => effect_1.Ref.update(handlersRef, (current) => {
    const existing = effect_1.HashMap.get(current, eventType);
    if (effect_1.Option.isSome(existing)) {
        return effect_1.HashMap.set(current, eventType, effect_1.Chunk.append(existing.value, handler));
    }
    return effect_1.HashMap.set(current, eventType, effect_1.Chunk.of(handler));
});
const removeHandler = (handlersRef, eventType, handler) => effect_1.Ref.update(handlersRef, (current) => {
    const existing = effect_1.HashMap.get(current, eventType);
    if (effect_1.Option.isNone(existing)) {
        return current;
    }
    const filtered = effect_1.Chunk.filter(existing.value, (candidate) => candidate !== handler);
    if (effect_1.Chunk.isEmpty(filtered)) {
        return effect_1.HashMap.remove(current, eventType);
    }
    return effect_1.HashMap.set(current, eventType, filtered);
});
const registerNode = (config, registration = {}) => effect_1.Effect.scoped(effect_1.Effect.gen(function* (_) {
    const nodeId = (0, utils_1.sanitizeIdentifier)(registration.nodeId ?? (0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 12));
    yield* _(withClient(config.pool, (client) => effect_1.Effect.tryPromise({
        try: () => client.query(`INSERT INTO core.nodes(node_id, namespace, display_name, description, metadata)
               VALUES($1, $2, $3, $4, $5::jsonb)
               ON CONFLICT (node_id) DO UPDATE
                 SET display_name = EXCLUDED.display_name,
                     description = EXCLUDED.description,
                     metadata = EXCLUDED.metadata,
                     last_heartbeat = now()`, [
            nodeId,
            config.namespace,
            registration.displayName ?? null,
            registration.description ?? null,
            registration.metadata ?? {}
        ]),
        catch: toError
    }).pipe(effect_1.Effect.asVoid)));
    const handlersRef = yield* _(effect_1.Ref.make(defaultHandlersMap));
    const stopSignal = yield* _(effect_1.Deferred.make());
    const heartbeatFiber = yield* _(heartbeatLoop(config, nodeId).pipe(effect_1.Effect.forkDaemon));
    const consumerFiber = yield* _(consumerLoop(config, handlersRef, stopSignal).pipe(effect_1.Effect.forkDaemon));
    yield* _(effect_1.Effect.addFinalizer(() => effect_1.Effect.all([
        effect_1.Fiber.interrupt(heartbeatFiber),
        effect_1.Fiber.interrupt(consumerFiber),
        effect_1.Deferred.succeed(stopSignal, undefined)
    ], { discard: true })));
    const scheduleTask = (definition) => createScheduledTaskEffect(config, definition);
    const node = {
        nodeId,
        emit: (eventType, payload) => emitEvent(config, nodeId, eventType, payload),
        onEvent: (eventType, handler) => effect_1.Effect.scoped(effect_1.Effect.gen(function* (__) {
            yield* _(addHandler(handlersRef, eventType, handler));
            yield* _(effect_1.Effect.addFinalizer(() => removeHandler(handlersRef, eventType, handler)));
        })),
        offEvent: (eventType, handler) => removeHandler(handlersRef, eventType, handler),
        scheduleTask
    };
    yield* _(effect_1.Effect.logInfo("core.effect: node registered", { nodeId }));
    return node;
}));
const makeCoreRuntime = (options) => effect_1.Effect.scoped(effect_1.Effect.gen(function* (_) {
    const namespace = (0, utils_1.sanitizeIdentifier)(options.namespace);
    const pool = yield* _(effect_1.Effect.acquireUseRelease(acquirePool(options.connectionString), (pool) => effect_1.Effect.succeed(pool), (pool, exit) => releasePool(pool)));
    const config = {
        pool,
        namespace,
        queueName: `core_events_${namespace}`,
        deadLetterQueueName: `core_events_${namespace}_dlq`,
        idlePollIntervalMs: options.idlePollIntervalMs ?? 1000,
        visibilityTimeoutSeconds: options.visibilityTimeoutSeconds ?? 30,
        batchSize: options.batchSize ?? 10
    };
    yield* _(initialize(pool, namespace));
    const runtime = {
        namespace,
        registerNode: (registration) => registerNode(config, registration),
        createScheduledTask: (definition) => createScheduledTaskEffect(config, definition),
        metrics: () => effect_1.Effect.gen(function* (__) {
            const [queueMeta, dlqMeta] = yield* _(effect_1.Effect.all([
                withClient(pool, (client) => effect_1.Effect.tryPromise({
                    try: () => client.query(`SELECT COALESCE(SUM(queue_length), 0) AS queue_length FROM pgmq.meta WHERE queue_name = $1`, [config.queueName]),
                    catch: toError
                })),
                withClient(pool, (client) => effect_1.Effect.tryPromise({
                    try: () => client.query(`SELECT COALESCE(SUM(queue_length), 0) AS queue_length FROM pgmq.meta WHERE queue_name = $1`, [config.deadLetterQueueName]),
                    catch: toError
                }))
            ]));
            return {
                queueDepth: queueMeta.rows[0]?.queue_length ?? 0,
                deadLetterQueueDepth: dlqMeta.rows[0]?.queue_length ?? 0
            };
        })
    };
    return runtime;
}));
exports.makeCoreRuntime = makeCoreRuntime;
//# sourceMappingURL=effect.js.map