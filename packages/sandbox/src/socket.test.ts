import { describe, expect, test } from "bun:test";
import { DOCKER_SOCKET_CANDIDATES, resolveDockerSocket } from "./socket";

describe("resolveDockerSocket", () => {
  test("defers to dockerode when DOCKER_HOST is set", () => {
    const socket = resolveDockerSocket({ DOCKER_HOST: "tcp://10.0.0.1:2375" }, () => true);

    expect(socket).toBeUndefined();
  });

  test("honours an explicit socket override", () => {
    const socket = resolveDockerSocket(
      { LABFORGE_DOCKER_SOCKET: "/custom/docker.sock" },
      () => false,
    );

    expect(socket).toBe("/custom/docker.sock");
  });

  test("picks the standard socket when it exists", () => {
    const socket = resolveDockerSocket({}, (path) => path === "/var/run/docker.sock");

    expect(socket).toBe("/var/run/docker.sock");
  });

  test("falls back to a rootless runtime socket when the standard one is absent", () => {
    const orbstack = DOCKER_SOCKET_CANDIDATES.find((path) => path.includes("orbstack"));

    const socket = resolveDockerSocket({ HOME: "/Users/me" }, (path) => path.includes("orbstack"));

    expect(orbstack).toBeDefined();
    expect(socket).toContain("orbstack");
  });

  test("returns undefined when no candidate exists", () => {
    expect(resolveDockerSocket({}, () => false)).toBeUndefined();
  });
});
