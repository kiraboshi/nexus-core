import { CoreSystem } from "./system.js";
import type { EventHandler, ScheduledTaskDefinition } from "./types.js";
interface CoreNodeConfig {
    nodeId: string;
    system: CoreSystem;
}
export declare class CoreNode {
    readonly nodeId: string;
    private readonly system;
    private readonly logger;
    private readonly eventHandlers;
    private isRunning;
    private consumerActive;
    private heartbeatTimer;
    private consumerPromise;
    constructor(config: CoreNodeConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    onEvent<TPayload = unknown>(eventType: string, handler: EventHandler<TPayload>): void;
    offEvent(eventType: string, handler: EventHandler): void;
    emit<TPayload = unknown>(eventType: string, payload: TPayload): Promise<number>;
    scheduleTask(definition: ScheduledTaskDefinition): Promise<import("./types.js").ScheduledTaskRecord>;
    private startHeartbeatLoop;
    private ensureConsumerLoop;
    private consumeLoop;
    private decorateEnvelope;
    private invokeHandlers;
    private acknowledge;
    private moveToDeadLetter;
}
export {};
//# sourceMappingURL=coreNode.d.ts.map