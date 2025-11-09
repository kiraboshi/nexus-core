import type { CoreDatabase } from "./database.ts";
import type { CoreLogger } from "./types.ts";
import { defaultLogger } from "./logger.ts";
import { sanitizeIdentifier } from "./utils.ts";

export class CoreInitializer {
  constructor(
    private readonly db: CoreDatabase,
    private readonly logger: CoreLogger = defaultLogger
  ) {}

  async initialize(namespace: string): Promise<void> {
    await this.ensureExtensions();
    await this.ensureSchema();
    await this.ensureNamespace(namespace);
    await this.ensureQueues(namespace);
    await this.ensurePartitioning();
  }

  private async ensureExtensions(): Promise<void> {
    this.logger.info("Ensuring required Postgres extensions");
    await this.db.usingClient(async (client) => {
      await client.query("CREATE EXTENSION IF NOT EXISTS pg_cron");
      await client.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
      await client.query("CREATE EXTENSION IF NOT EXISTS pg_partman");
      await client.query("CREATE EXTENSION IF NOT EXISTS pgmq");
    });
  }

  private async ensureSchema(): Promise<void> {
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

  private async ensureNamespace(namespace: string): Promise<void> {
    const safeNamespace = sanitizeIdentifier(namespace);
    this.logger.info(`Ensuring namespace ${safeNamespace}`);
    await this.db.query(
      `INSERT INTO core.namespaces(namespace) VALUES($1) ON CONFLICT (namespace) DO NOTHING`,
      [safeNamespace]
    );
  }

  private async ensureQueues(namespace: string): Promise<void> {
    const queueName = `core_events_${sanitizeIdentifier(namespace)}`;
    const deadLetterQueueName = `${queueName}_dlq`;
    this.logger.info("Ensuring pgmq queues", { queueName, deadLetterQueueName });
    await this.db.usingClient(async (client) => {
      // Create main queue - use parameterized query to avoid SQL injection
      try {
        await client.query(`SELECT pgmq.create($1::text)`, [queueName]);
        this.logger.info("Created pgmq queue", { queueName });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Queue already exists is fine, ignore that error
        if (errorMessage.includes("already exists") || errorMessage.includes("duplicate") || errorMessage.includes("already")) {
          this.logger.debug("Queue already exists", { queueName });
        } else {
          this.logger.error("Failed to create queue", { queueName, error: errorMessage });
          throw error;
        }
      }

      // Create dead letter queue
      try {
        await client.query(`SELECT pgmq.create($1::text)`, [deadLetterQueueName]);
        this.logger.info("Created pgmq dead letter queue", { deadLetterQueueName });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Queue already exists is fine, ignore that error
        if (errorMessage.includes("already exists") || errorMessage.includes("duplicate") || errorMessage.includes("already")) {
          this.logger.debug("Dead letter queue already exists", { deadLetterQueueName });
        } else {
          this.logger.error("Failed to create dead letter queue", { deadLetterQueueName, error: errorMessage });
          throw error;
        }
      }
    });
  }

  private async ensurePartitioning(): Promise<void> {
    this.logger.info("Ensuring partitions for event_log");
    await this.db.usingClient(async (client) => {
      // First, try to use pg_partman if available
      let pgPartmanAvailable = false;
      try {
        await client.query(`SELECT 1 FROM partman.part_config LIMIT 1`);
        pgPartmanAvailable = true;
      } catch {
        pgPartmanAvailable = false;
      }

      if (pgPartmanAvailable) {
        try {
          // Check if partition config exists
          const configResult = await client.query<{ exists: boolean }>(
            `SELECT EXISTS(
              SELECT 1 FROM partman.part_config WHERE parent_table = 'core.event_log'
            ) AS exists`
          );
          
          const configExists = configResult.rows[0]?.exists ?? false;
          
          if (!configExists) {
            this.logger.info("Creating pg_partman parent configuration");
            await client.query(`
              SELECT partman.create_parent(
                p_parent_table => 'core.event_log',
                p_control => 'emitted_at',
                p_type => 'native',
                p_interval => 'monthly',
                p_premake => 6,
                p_retention => '6 months',
                p_retention_keep_table => false
              );
            `);
          }
          
          // Run maintenance to ensure partitions are created
          this.logger.info("Running pg_partman maintenance to create partitions");
          await client.query(`SELECT partman.run_maintenance('core.event_log')`);
          
          // Verify at least one partition exists
          const partitionCheck = await client.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count 
             FROM pg_inherits 
             WHERE inhparent = 'core.event_log'::regclass`
          );
          
          if ((partitionCheck.rows[0]?.count ?? 0) > 0) {
            this.logger.info("Partitions created successfully via pg_partman");
            return;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.warn("pg_partman setup failed, will create partition manually", { error: errorMessage });
        }
      }

      // Fallback: Create partitions manually if pg_partman isn't available or failed
      this.logger.info("Creating partitions manually");
      
      // Get current date and create partitions for current month and next few months
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      
      // Create partitions for current month and next 6 months
      for (let i = 0; i < 7; i++) {
        const partitionDate = new Date(currentYear, currentMonth + i, 1);
        const nextMonth = new Date(currentYear, currentMonth + i + 1, 1);
        const partitionName = `core.event_log_${partitionDate.getFullYear()}_${String(partitionDate.getMonth() + 1).padStart(2, '0')}`;
        const startDate = partitionDate.toISOString().split('T')[0];
        const endDate = nextMonth.toISOString().split('T')[0];
        
        try {
          await client.query(`
            CREATE TABLE IF NOT EXISTS ${partitionName}
            PARTITION OF core.event_log
            FOR VALUES FROM ('${startDate}') TO ('${endDate}');
          `);
          this.logger.debug("Created partition", { partitionName, startDate, endDate });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // Ignore "already exists" errors
          if (!errorMessage.includes("already exists") && !errorMessage.includes("duplicate")) {
            this.logger.warn("Failed to create partition", { partitionName, error: errorMessage });
          }
        }
      }
      
      this.logger.info("Partitions created manually");
    });
  }
}

