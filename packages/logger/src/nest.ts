import type { LoggerService } from "@nestjs/common";
import type { Logger } from "./logger";

type AdapterLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export class NestLoggerAdapter implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, scope?: string): void {
    this.write("info", message, scope);
  }

  error(message: unknown, stack?: string, scope?: string): void {
    this.write("error", message, scope, stack ? { stack } : undefined);
  }

  warn(message: unknown, scope?: string): void {
    this.write("warn", message, scope);
  }

  debug(message: unknown, scope?: string): void {
    this.write("debug", message, scope);
  }

  verbose(message: unknown, scope?: string): void {
    this.write("trace", message, scope);
  }

  fatal(message: unknown, scope?: string): void {
    this.write("fatal", message, scope);
  }

  private write(
    level: AdapterLevel,
    message: unknown,
    scope?: string,
    extra?: Record<string, unknown>,
  ): void {
    const target = scope ? this.logger.child({ scope }) : this.logger;

    if (typeof message === "string") {
      target[level](extra ?? {}, message);
      return;
    }

    target[level]({ ...extra, payload: message });
  }
}
