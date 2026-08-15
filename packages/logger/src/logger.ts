import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";
import { type LogLevel, loadLoggerEnv } from "./config";
import type { LogContext, ServiceName } from "./context";
import { REDACT_CENSOR, REDACT_PATHS } from "./redaction";

export type Logger = PinoLogger;

export interface CreateLoggerOptions {
  service: ServiceName;
  level?: LogLevel;
  pretty?: boolean;
  context?: LogContext;
  stream?: DestinationStream;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const env = loadLoggerEnv();
  const pretty = options.pretty ?? env.pretty;
  const stream = options.stream ?? (pretty ? createPrettyStream() : undefined);

  const settings = {
    level: options.level ?? env.level,
    base: { service: options.service, ...options.context },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  };

  return stream ? pino(settings, stream) : pino(settings);
}

export function withContext(logger: Logger, context: LogContext): Logger {
  return logger.child(context);
}

function createPrettyStream(): DestinationStream | undefined {
  if ("window" in globalThis) {
    return undefined;
  }

  const factory = require("pino-pretty") as (options: {
    colorize: boolean;
    translateTime: string;
    ignore: string;
  }) => DestinationStream;

  return factory({
    colorize: true,
    translateTime: "HH:MM:ss.l",
    ignore: "pid,hostname",
  });
}
