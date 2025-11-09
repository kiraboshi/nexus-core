export class ConsoleLogger {
    constructor(scope) {
        this.scope = scope;
    }
    format(message) {
        return this.scope ? `[${this.scope}] ${message}` : message;
    }
    debug(message, meta) {
        if (process.env.CORE_LOG_LEVEL === "debug") {
            // eslint-disable-next-line no-console
            console.debug(this.format(message), meta ?? "");
        }
    }
    info(message, meta) {
        // eslint-disable-next-line no-console
        console.info(this.format(message), meta ?? "");
    }
    warn(message, meta) {
        // eslint-disable-next-line no-console
        console.warn(this.format(message), meta ?? "");
    }
    error(message, meta) {
        const msg = message instanceof Error ? message.stack ?? message.message : message;
        // eslint-disable-next-line no-console
        console.error(this.format(msg), meta ?? "");
    }
}
export const defaultLogger = new ConsoleLogger("core");
//# sourceMappingURL=logger.js.map