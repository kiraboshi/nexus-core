import { type PoolClient } from "pg";
import { Effect, Scope } from "effect";
import type { CoreMetricsSnapshot, CoreOptions, EventEnvelope, NodeRegistration, ScheduledTaskDefinition, ScheduledTaskRecord } from "./types";
type Handler = (event: EventEnvelope, context: {
    client: PoolClient;
}) => Effect.Effect<void, Error>;
interface EffectCoreNode {
    readonly nodeId: string;
    readonly emit: (eventType: string, payload: unknown) => Effect.Effect<number, Error>;
    readonly onEvent: (eventType: string, handler: Handler) => Effect.Effect<void, Error, Scope.Scope>;
    readonly offEvent: (eventType: string, handler: Handler) => Effect.Effect<void, Error>;
    readonly scheduleTask: (definition: ScheduledTaskDefinition) => Effect.Effect<ScheduledTaskRecord, Error>;
}
export interface EffectCoreRuntime {
    readonly namespace: string;
    readonly registerNode: (registration?: NodeRegistration) => Effect.Effect<EffectCoreNode, Error, Scope.Scope>;
    readonly createScheduledTask: (definition: ScheduledTaskDefinition) => Effect.Effect<ScheduledTaskRecord, Error>;
    readonly metrics: () => Effect.Effect<CoreMetricsSnapshot, Error>;
}
export declare const makeCoreRuntime: (options: CoreOptions) => Effect.Effect<EffectCoreRuntime, Error, Scope.Scope>;
export type { EffectCoreNode };
//# sourceMappingURL=effect.d.ts.map