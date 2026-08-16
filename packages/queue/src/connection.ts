import type { ConnectionOptions } from "bullmq";

export const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

export function redisUrl(env: Record<string, string | undefined> = process.env): string {
  return env.REDIS_URL ?? DEFAULT_REDIS_URL;
}

export const PROBE_TIMEOUT_SECONDS = 2;

export function redisReachable(url: string = redisUrl()): boolean {
  const { hostname, port } = new URL(url);
  const probe = Bun.spawnSync([
    "bash",
    "-c",
    `exec 3<>/dev/tcp/${hostname}/${port === "" ? "6379" : port} && printf 'PING\\r\\n' >&3 && read -t ${PROBE_TIMEOUT_SECONDS} -u 3 reply && [[ $reply == +PONG* ]]`,
  ]);

  return probe.exitCode === 0;
}

export function connectionFor(url: string = redisUrl()): ConnectionOptions {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`REDIS_URL is not a URL: ${url}`);
  }

  const database = parsed.pathname.replace("/", "");

  return {
    host: parsed.hostname,
    port: parsed.port === "" ? 6379 : Number(parsed.port),
    maxRetriesPerRequest: null,
    ...(parsed.username !== "" && { username: decodeURIComponent(parsed.username) }),
    ...(parsed.password !== "" && { password: decodeURIComponent(parsed.password) }),
    ...(database !== "" && { db: Number(database) }),
  };
}
