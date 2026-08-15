import { z } from "zod";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LoggerEnv {
  level: LogLevel;
  pretty: boolean;
}

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  LOG_PRETTY: z.enum(["true", "false"]).optional(),
});

export function loadLoggerEnv(source: Record<string, string | undefined> = process.env): LoggerEnv {
  const env = envSchema.parse(source);
  const isProduction = env.NODE_ENV === "production";

  return {
    level: env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
    pretty: env.LOG_PRETTY === undefined ? !isProduction : env.LOG_PRETTY === "true",
  };
}
