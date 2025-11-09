import { CoreDatabase } from "./database.js";
import type { CoreLogger, CoreMetricsSnapshot, CoreOptions, EventEnvelope, NodeRegistration, ScheduledTaskDefinition, ScheduledTaskRecord } from "./types.js";
import type { CoreNode } from "./coreNode.js";
export declare class CoreSystem {
    readonly options: CoreOptions;
    readonly db: CoreDatabase;
    readonly namespace: string;
    private readonly logger;
    private readonly queueName;
    private readonly deadLetterQueueName;
    private constructor();
    static connect(options: CoreOptions): Promise<CoreSystem>;
    getQueueName(): string;
    getDeadLetterQueueName(): string;
    getLogger(): CoreLogger;
    getDatabase(): CoreDatabase;
    getOptions(): CoreOptions;
    registerNode(registration?: NodeRegistration): Promise<CoreNode>;
    appendEventToLog(envelope: EventEnvelope): Promise<void>;
    createScheduledTask(definition: ScheduledTaskDefinition): Promise<ScheduledTaskRecord>;
    metrics(): Promise<CoreMetricsSnapshot>;
    close(): Promise<void>;
}
//# sourceMappingURL=system.d.ts.map