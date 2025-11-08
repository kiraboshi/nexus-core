import type { CoreLogger } from "./types";
export declare class ConsoleLogger implements CoreLogger {
    private readonly scope?;
    constructor(scope?: string | undefined);
    private format;
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string | Error, meta?: Record<string, unknown>): void;
}
export declare const defaultLogger: ConsoleLogger;
//# sourceMappingURL=logger.d.ts.map