import { Pool } from "pg";
import { defaultLogger } from "./logger.js";
export class CoreDatabase {
    constructor(pool, logger) {
        this.pool = pool;
        this.logger = logger;
    }
    static async connect(connectionString, logger = defaultLogger) {
        const pool = new Pool({ connectionString });
        const db = new CoreDatabase(pool, logger);
        // Validate connection early to fail fast.
        await db.usingClient(async (client) => {
            await client.query("select 1");
        });
        logger.info("Connected to core database");
        return db;
    }
    async query(text, params) {
        return this.pool.query(text, params ? [...params] : undefined);
    }
    async usingClient(fn) {
        const client = await this.pool.connect();
        try {
            return await fn(client);
        }
        finally {
            client.release();
        }
    }
    async withTransaction(fn) {
        return this.usingClient(async (client) => {
            await client.query("begin");
            try {
                const result = await fn(client);
                await client.query("commit");
                return result;
            }
            catch (error) {
                await client.query("rollback");
                throw error;
            }
        });
    }
    async close() {
        this.logger.info("Closing core database pool");
        await this.pool.end();
    }
    getPool() {
        return this.pool;
    }
}
//# sourceMappingURL=database.js.map