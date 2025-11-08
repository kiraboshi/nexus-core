import type { CoreLogger } from "./types";

export class ConsoleLogger implements CoreLogger {
  constructor(private readonly scope?: string) {}

  private format(message: string): string {
    return this.scope ? `[${this.scope}] ${message}` : message;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.CORE_LOG_LEVEL === "debug") {
      // eslint-disable-next-line no-console
      console.debug(this.format(message), meta ?? "");
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.info(this.format(message), meta ?? "");
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.warn(this.format(message), meta ?? "");
  }

  error(message: string | Error, meta?: Record<string, unknown>): void {
    const msg = message instanceof Error ? message.stack ?? message.message : message;
    // eslint-disable-next-line no-console
    console.error(this.format(msg), meta ?? "");
  }
}

export const defaultLogger = new ConsoleLogger("core");

