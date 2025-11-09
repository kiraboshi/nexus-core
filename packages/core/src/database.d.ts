import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { CoreLogger } from "./types.js";
export declare class CoreDatabase {
    private readonly pool;
    private readonly logger;
    private constructor();
    static connect(connectionString: string, logger?: CoreLogger): Promise<CoreDatabase>;
    query<T extends QueryResultRow = QueryResultRow>(text: string, params?: ReadonlyArray<unknown>): Promise<import("pg").QueryResult<T>>;
    usingClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    close(): Promise<void>;
    getPool(): Pool;
}
//# sourceMappingURL=database.d.ts.map