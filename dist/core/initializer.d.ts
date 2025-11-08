import type { CoreDatabase } from "./database";
import type { CoreLogger } from "./types";
export declare class CoreInitializer {
    private readonly db;
    private readonly logger;
    constructor(db: CoreDatabase, logger?: CoreLogger);
    initialize(namespace: string): Promise<void>;
    private ensureExtensions;
    private ensureSchema;
    private ensureNamespace;
    private ensureQueues;
    private ensurePartitioning;
}
//# sourceMappingURL=initializer.d.ts.map