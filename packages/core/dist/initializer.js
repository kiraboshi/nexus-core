import { defaultLogger } from "./logger.js";
import { sanitizeIdentifier } from "./utils.js";
export class CoreInitializer {
    constructor(db, logger = defaultLogger) {
        this.db = db;
        this.logger = logger;
    }
    async initialize(namespace) {
        await this.ensureExtensions();
        await this.ensureSchema();
        await this.ensureNamespace(namespace);
        await this.ensureQueues(namespace);
        await this.ensurePartitioning();
    }
    async ensureExtensions() {
        this.logger.info("Ensuring required Postgres extensions");
        await this.db.usingClient(async (client) => {
            await client.query("CREATE EXTENSION IF NOT EXISTS pg_cron");
            await client.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
            await client.query("CREATE EXTENSION IF NOT EXISTS pg_partman");
            await client.query("CREATE EXTENSION IF NOT EXISTS pgmq");
        });
    }
    async ensureSchema() {
        this.logger.info("Ensuring core schema objects");
        await this.db.usingClient(async (client) => {
            await client.query(`
        CREATE SCHEMA IF NOT EXISTS core;
      `);
            await client.query(`
        CREATE TABLE IF NOT EXISTS core.namespaces (
          namespace TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        );
      `);
            await client.query(`
        CREATE TABLE IF NOT EXISTS core.nodes (
          node_id TEXT PRIMARY KEY,
          namespace TEXT NOT NULL REFERENCES core.namespaces(namespace) ON DELETE CASCADE,
          display_name TEXT,
          description TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT core_nodes_namespace_node UNIQUE(namespace, node_id)
        );
      `);
            await client.query(`
        CREATE TABLE IF NOT EXISTS core.scheduled_tasks (
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
        );
      `);
            await client.query(`
        CREATE TABLE IF NOT EXISTS core.event_log (
          event_id BIGSERIAL,
          namespace TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload JSONB NOT NULL,
          emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          producer_node_id TEXT,
          scheduled_task_id UUID,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY(event_id, emitted_at)
        ) PARTITION BY RANGE (emitted_at);
      `);
            await client.query(`
        CREATE INDEX IF NOT EXISTS idx_core_event_log_namespace ON core.event_log(namespace);
      `);
            await client.query(`
        CREATE INDEX IF NOT EXISTS idx_core_event_log_event_type ON core.event_log(event_type);
      `);
            await client.query(`
        CREATE OR REPLACE FUNCTION core.touch_node_heartbeat(p_node_id TEXT)
        RETURNS VOID
        LANGUAGE plpgsql
        AS $$
        BEGIN
          UPDATE core.nodes
          SET last_heartbeat = now()
          WHERE node_id = p_node_id;
        END;
        $$;
      `);
            await client.query(`
        CREATE OR REPLACE FUNCTION core.append_event_log(
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
        $$;
      `);
            await client.query(`
        CREATE OR REPLACE FUNCTION core.queue_name_for_namespace(p_namespace TEXT)
        RETURNS TEXT
        LANGUAGE SQL
        AS $$
        SELECT 'core_events_' || replace(p_namespace, '-', '_');
        $$;
      `);
            await client.query(`
        CREATE OR REPLACE FUNCTION core.dead_letter_queue_name_for_namespace(p_namespace TEXT)
        RETURNS TEXT
        LANGUAGE SQL
        AS $$
        SELECT core.queue_name_for_namespace(p_namespace) || '_dlq';
        $$;
      `);
            await client.query(`
        CREATE OR REPLACE FUNCTION core.run_scheduled_task(p_task_id UUID)
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
        $$;
      `);
        });
    }
    async ensureNamespace(namespace) {
        const safeNamespace = sanitizeIdentifier(namespace);
        this.logger.info(`Ensuring namespace ${safeNamespace}`);
        await this.db.query(`INSERT INTO core.namespaces(namespace) VALUES($1) ON CONFLICT (namespace) DO NOTHING`, [safeNamespace]);
    }
    async ensureQueues(namespace) {
        const queueName = `core_events_${sanitizeIdentifier(namespace)}`;
        const deadLetterQueueName = `${queueName}_dlq`;
        this.logger.info("Ensuring pgmq queues", { queueName, deadLetterQueueName });
        await this.db.usingClient(async (client) => {
            await client.query(`DO $$
         BEGIN
           PERFORM pgmq.create_queue($1);
         EXCEPTION WHEN others THEN
           -- queue already exists
           PERFORM 1;
         END;
         $$;`, [queueName]);
            await client.query(`DO $$
         BEGIN
           PERFORM pgmq.create_queue($1);
         EXCEPTION WHEN others THEN
           PERFORM 1;
         END;
         $$;`, [deadLetterQueueName]);
        });
    }
    async ensurePartitioning() {
        this.logger.info("Ensuring pg_partman configuration for event_log");
        await this.db.usingClient(async (client) => {
            await client.query(`
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
      `);
        });
    }
}
//# sourceMappingURL=initializer.js.map