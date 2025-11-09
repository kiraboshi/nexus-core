import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { defaultLogger } from "./logger.js";
import type { CoreLogger } from "./types.js";

export class CoreDatabase {
  private constructor(
    private readonly pool: Pool,
    private readonly logger: CoreLogger
  ) {}

  static async connect(connectionString: string, logger: CoreLogger = defaultLogger): Promise<CoreDatabase> {
    const pool = new Pool({ connectionString });
    const db = new CoreDatabase(pool, logger);
    // Validate connection early to fail fast.
    await db.usingClient(async (client) => {
      await client.query("select 1");
    });
    logger.info("Connected to core database");
    return db;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: ReadonlyArray<unknown>
  ) {
    return this.pool.query<T>(text, params ? [...params] : undefined);
  }

  async usingClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.usingClient(async (client) => {
      await client.query("begin");
      try {
        const result = await fn(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    this.logger.info("Closing core database pool");
    await this.pool.end();
  }

  getPool(): Pool {
    return this.pool;
  }
}

