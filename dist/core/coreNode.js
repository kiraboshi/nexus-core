"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoreNode = void 0;
const utils_1 = require("./utils");
class CoreNode {
    constructor(config) {
        this.eventHandlers = new Map();
        this.isRunning = false;
        this.consumerActive = false;
        this.heartbeatTimer = null;
        this.consumerPromise = null;
        this.nodeId = config.nodeId;
        this.system = config.system;
        this.logger = this.system.getLogger();
    }
    async start() {
        if (this.isRunning) {
            return;
        }
        this.isRunning = true;
        this.startHeartbeatLoop();
        this.ensureConsumerLoop();
        this.logger.info("Core node started", { nodeId: this.nodeId });
    }
    async stop() {
        if (!this.isRunning) {
            return;
        }
        this.isRunning = false;
        this.consumerActive = false;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.consumerPromise) {
            await this.consumerPromise;
            this.consumerPromise = null;
        }
        this.logger.info("Core node stopped", { nodeId: this.nodeId });
    }
    onEvent(eventType, handler) {
        const handlers = this.eventHandlers.get(eventType) ?? new Set();
        handlers.add(handler);
        this.eventHandlers.set(eventType, handlers);
        if (!this.isRunning) {
            void this.start();
        }
        else {
            this.ensureConsumerLoop();
        }
    }
    offEvent(eventType, handler) {
        const handlers = this.eventHandlers.get(eventType);
        if (!handlers)
            return;
        handlers.delete(handler);
        if (handlers.size === 0) {
            this.eventHandlers.delete(eventType);
            if (this.eventHandlers.size === 0) {
                this.consumerActive = false;
            }
        }
    }
    async emit(eventType, payload) {
        const envelope = {
            namespace: this.system.namespace,
            eventType,
            payload,
            emittedAt: (0, utils_1.nowIso)(),
            producerNodeId: this.nodeId
        };
        const { rows } = await this.system.getDatabase().query(`SELECT pgmq.send($1, $2::jsonb)`, [this.system.getQueueName(), envelope]);
        const messageId = rows[0]?.send ?? 0;
        envelope.messageId = messageId;
        await this.system.appendEventToLog(envelope);
        this.logger.debug("Event emitted", { eventType, messageId });
        return messageId;
    }
    async scheduleTask(definition) {
        return this.system.createScheduledTask(definition);
    }
    startHeartbeatLoop() {
        const intervalMs = 30000;
        const beat = async () => {
            try {
                await this.system
                    .getDatabase()
                    .query(`SELECT core.touch_node_heartbeat($1)`, [this.nodeId]);
            }
            catch (error) {
                this.logger.error(error instanceof Error ? error : new Error(String(error)), { phase: "heartbeat" });
            }
        };
        void beat();
        this.heartbeatTimer = setInterval(() => {
            void beat();
        }, intervalMs).unref();
    }
    ensureConsumerLoop() {
        if (!this.isRunning || this.consumerActive || this.eventHandlers.size === 0) {
            return;
        }
        this.consumerActive = true;
        this.consumerPromise = this.consumeLoop().finally(() => {
            this.consumerActive = false;
            this.consumerPromise = null;
        });
    }
    async consumeLoop() {
        const { idlePollIntervalMs = 1000, visibilityTimeoutSeconds = 30, batchSize = 10 } = this.system.getOptions();
        while (this.isRunning && this.consumerActive) {
            let rows = [];
            try {
                const result = await this.system.getDatabase().query(`SELECT * FROM pgmq.read($1, $2, $3)`, [this.system.getQueueName(), visibilityTimeoutSeconds, batchSize]);
                rows = result.rows;
            }
            catch (error) {
                this.logger.error(error instanceof Error ? error : new Error(String(error)), { phase: "pgmq.read" });
                await (0, utils_1.sleep)(2000);
                continue;
            }
            if (!rows.length) {
                await (0, utils_1.sleep)(idlePollIntervalMs);
                continue;
            }
            for (const row of rows) {
                if (!this.isRunning || !this.consumerActive) {
                    break;
                }
                const envelope = this.decorateEnvelope(row);
                const handlers = this.eventHandlers.get(envelope.eventType);
                if (!handlers || handlers.size === 0) {
                    await this.moveToDeadLetter(row, `No handler for event ${envelope.eventType}`);
                    continue;
                }
                try {
                    await this.invokeHandlers(envelope);
                    await this.acknowledge(row.msg_id);
                }
                catch (error) {
                    this.logger.error(error instanceof Error ? error : new Error(String(error)), {
                        eventType: envelope.eventType,
                        messageId: row.msg_id
                    });
                    await this.moveToDeadLetter(row, "Handler error", error);
                }
            }
        }
    }
    decorateEnvelope(row) {
        const envelope = row.message ?? {};
        envelope.namespace = envelope.namespace ?? this.system.namespace;
        envelope.producerNodeId = envelope.producerNodeId ?? "unknown";
        envelope.emittedAt = envelope.emittedAt ?? row.enqueued_at ?? (0, utils_1.nowIso)();
        envelope.messageId = row.msg_id;
        envelope.redeliveryCount = row.read_ct;
        return envelope;
    }
    async invokeHandlers(envelope) {
        const handlers = Array.from(this.eventHandlers.get(envelope.eventType) ?? []);
        await this.system.getDatabase().withTransaction(async (client) => {
            for (const handler of handlers) {
                await Promise.resolve(handler(envelope, { client }));
            }
        });
    }
    async acknowledge(messageId) {
        await this.system.getDatabase().query(`SELECT pgmq.delete($1, $2)`, [this.system.getQueueName(), messageId]);
    }
    async moveToDeadLetter(row, reason, error) {
        const payload = {
            originalEvent: this.decorateEnvelope(row),
            reason,
            failedAt: (0, utils_1.nowIso)()
        };
        if (error) {
            payload.error = error instanceof Error ? error.stack ?? error.message : String(error);
        }
        await this.system
            .getDatabase()
            .query(`SELECT pgmq.send($1, $2::jsonb)`, [this.system.getDeadLetterQueueName(), payload]);
        await this.system
            .getDatabase()
            .query(`SELECT pgmq.delete($1, $2)`, [this.system.getQueueName(), row.msg_id]);
    }
}
exports.CoreNode = CoreNode;
//# sourceMappingURL=coreNode.js.map