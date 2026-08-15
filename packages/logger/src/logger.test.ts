import { describe, expect, test } from "bun:test";
import { loadLoggerEnv } from "./config";
import { createLogger, withContext } from "./logger";

function captureLogger(context?: Record<string, unknown>) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    service: "core",
    level: "trace",
    pretty: false,
    context,
    stream: {
      write(line: string) {
        lines.push(JSON.parse(line));
      },
    },
  });

  return { logger, lines };
}

describe("createLogger", () => {
  test("emits structured entries with service and level labels", () => {
    const { logger, lines } = captureLogger();

    logger.info({ jobId: "job_1" }, "state entered");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      service: "core",
      level: "info",
      jobId: "job_1",
      msg: "state entered",
    });
    expect(typeof lines[0]?.time).toBe("string");
  });

  test("redacts secrets at top level and one level deep", () => {
    const { logger, lines } = captureLogger();

    logger.info({ token: "abc", config: { apiKey: "xyz" }, jobId: "job_1" }, "config loaded");

    const entry = lines[0];
    const nested = entry?.config as Record<string, unknown> | undefined;

    expect(entry?.token).toBe("[redacted]");
    expect(nested?.apiKey).toBe("[redacted]");
    expect(entry?.jobId).toBe("job_1");
  });

  test("keeps base context on every entry", () => {
    const { logger, lines } = captureLogger({ jobId: "job_7" });

    logger.warn("watchdog tick");

    expect(lines[0]).toMatchObject({ jobId: "job_7", service: "core" });
  });

  test("withContext adds bindings without touching the parent", () => {
    const { logger, lines } = captureLogger();
    const scoped = withContext(logger, { jobId: "job_2", state: "SOLVE" });

    scoped.info("solving");
    logger.info("root");

    expect(lines[0]).toMatchObject({ jobId: "job_2", state: "SOLVE" });
    expect(lines[1]?.jobId).toBeUndefined();
  });

  test("respects the level threshold", () => {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger({
      service: "cli",
      level: "warn",
      pretty: false,
      stream: {
        write(line: string) {
          lines.push(JSON.parse(line));
        },
      },
    });

    logger.info("ignored");
    logger.error("kept");

    expect(lines).toHaveLength(1);
    expect(lines[0]?.msg).toBe("kept");
  });
});

describe("loadLoggerEnv", () => {
  test("defaults to debug and pretty outside production", () => {
    expect(loadLoggerEnv({})).toEqual({ level: "debug", pretty: true });
  });

  test("defaults to info and json in production", () => {
    expect(loadLoggerEnv({ NODE_ENV: "production" })).toEqual({ level: "info", pretty: false });
  });

  test("explicit env wins over defaults", () => {
    expect(
      loadLoggerEnv({ NODE_ENV: "production", LOG_LEVEL: "trace", LOG_PRETTY: "true" }),
    ).toEqual({ level: "trace", pretty: true });
  });

  test("rejects an unknown level", () => {
    expect(() => loadLoggerEnv({ LOG_LEVEL: "chatty" })).toThrow();
  });
});
