import { existsSync } from "node:fs";
import { homedir } from "node:os";

export const DOCKER_SOCKET_CANDIDATES = [
  "/var/run/docker.sock",
  `${homedir()}/.orbstack/run/docker.sock`,
  `${homedir()}/.docker/run/docker.sock`,
  `${homedir()}/.colima/default/docker.sock`,
];

export type PathProbe = (path: string) => boolean;

export function resolveDockerSocket(
  env: Record<string, string | undefined> = process.env,
  exists: PathProbe = existsSync,
): string | undefined {
  if (env.DOCKER_HOST !== undefined) {
    return undefined;
  }

  if (env.LABFORGE_DOCKER_SOCKET !== undefined) {
    return env.LABFORGE_DOCKER_SOCKET;
  }

  return DOCKER_SOCKET_CANDIDATES.find(exists);
}
