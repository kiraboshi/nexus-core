import { randomUUID } from "node:crypto";
import { CoreDatabase } from "./database.js";
import { CoreInitializer } from "./initializer.js";
import { ConsoleLogger } from "./logger.js";
import { sanitizeIdentifier } from "./utils.js";
export class CoreSystem {
    constructor(options, db, logger) {
        this.options = options;
        this.db = db;
        this.namespace = sanitizeIdentifier(options.namespace);
        this.logger = logger;
        this.queueName = `core_events_${this.namespace}`;
        this.deadLetterQueueName = `${this.queueName}_dlq`;
    }
    static async connect(options) {
        const logger = options.logger ?? new ConsoleLogger(`core:${options.namespace}`);
        const database = await CoreDatabase.connect(options.connectionString, logger);
        const system = new CoreSystem(options, database, logger);
        const initializer = new CoreInitializer(database, logger);
        await initializer.initialize(system.namespace);
        return system;
    }
    getQueueName() {
        return this.queueName;
    }
    getDeadLetterQueueName() {
        return this.deadLetterQueueName;
    }
    getLogger() {
        return this.logger;
    }
    getDatabase() {
        return this.db;
    }
    getOptions() {
        return {
            ...this.options,
            namespace: this.namespace
        };
    }
    async registerNode(registration = {}) {
        const nodeId = registration.nodeId ?? randomUUID().replace(/-/g, "").slice(0, 12);
        const cleanNodeId = sanitizeIdentifier(nodeId);
        await this.db.query(`INSERT INTO core.nodes(node_id, namespace, display_name, description, metadata)
       VALUES($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (node_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             description = EXCLUDED.description,
             metadata = EXCLUDED.metadata,
             last_heartbeat = now()`, [
            cleanNodeId,
            this.namespace,
            registration.displayName ?? null,
            registration.description ?? null,
            registration.metadata ?? {}
        ]);
        this.logger.info("Node registered", { nodeId: cleanNodeId, namespace: this.namespace });
        const { CoreNode } = await import("./coreNode.js");
        return new CoreNode({
            nodeId: cleanNodeId,
            system: this
        });
    }
    async appendEventToLog(envelope) {
        await this.db.query(`SELECT core.append_event_log($1, $2, $3::jsonb, $4, $5, $6::jsonb)`, [
            envelope.namespace,
            envelope.eventType,
            envelope.payload ?? {},
            envelope.producerNodeId,
            envelope.scheduledTaskId ?? null,
            {
                messageId: envelope.messageId,
                redeliveryCount: envelope.redeliveryCount ?? 0
            }
        ]);
    }
    async createScheduledTask(definition) {
        const taskId = randomUUID().replace(/-/g, "").slice(0, 16);
        const jobName = `${this.namespace}_${sanitizeIdentifier(definition.name)}_${taskId}`;
        const cronCommand = `SELECT core.run_scheduled_task('${taskId}')`;
        const { rows: jobRows } = await this.db.query(`SELECT cron.schedule($1, $2, $3) AS job_id`, [jobName, definition.cronExpression, cronCommand]);
        const jobId = jobRows[0]?.job_id;
        if (!jobId) {
            throw new Error(`Failed to schedule cron job for task ${definition.name}`);
        }
        const { rows } = await this.db.query(`INSERT INTO core.scheduled_tasks(task_id, namespace, job_id, name, cron_expression, event_type, payload, timezone)
       VALUES($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING task_id, namespace, job_id, name, cron_expression, event_type, payload, timezone, active, created_at, updated_at`, [
            taskId,
            this.namespace,
            jobId,
            definition.name,
            definition.cronExpression,
            definition.eventType,
            definition.payload ?? {},
            definition.timezone ?? null
        ]);
        const task = rows[0];
        if (!task) {
            throw new Error(`Failed to persist scheduled task ${definition.name}`);
        }
        this.logger.info("Scheduled task created", { taskId, jobId });
        const result = {
            name: task.name,
            cronExpression: task.cron_expression,
            eventType: task.event_type,
            payload: task.payload ?? {},
            taskId,
            jobId,
            createdAt: task.created_at,
            updatedAt: task.updated_at,
            active: task.active
        };
        if (task.timezone) {
            result.timezone = task.timezone;
        }
        return result;
    }
    async metrics() {
        try {
            const [{ rows: queueRows }, { rows: dlqRows }] = await Promise.all([
                this.db.query(`SELECT COALESCE(SUM(queue_length), 0) AS queue_length FROM pgmq.meta WHERE queue_name = $1`, [this.queueName]),
                this.db.query(`SELECT COALESCE(SUM(queue_length), 0) AS queue_length FROM pgmq.meta WHERE queue_name = $1`, [this.deadLetterQueueName])
            ]);
            return {
                queueDepth: queueRows[0]?.queue_length ?? 0,
                deadLetterQueueDepth: dlqRows[0]?.queue_length ?? 0
            };
        }
        catch (error) {
            this.logger.warn("Unable to fetch queue metrics", {
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                queueDepth: 0,
                deadLetterQueueDepth: 0
            };
        }
    }
    async close() {
        this.logger.info("Closing core system");
        await this.db.close();
    }
}
//# sourceMappingURL=system.js.map