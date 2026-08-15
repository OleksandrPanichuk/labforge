import { describe, expect, test } from "bun:test";
import { buildContainerSpec, LIMITS } from "./spec";

const request = {
  image: "lab-python",
  cmd: ["python", "cells/errors.py"],
  jobDir: "/jobs/job_1",
};

describe("buildContainerSpec", () => {
  test("applies the mandated resource limits", () => {
    const spec = buildContainerSpec(request);

    expect(spec.HostConfig.Memory).toBe(LIMITS.memoryBytes);
    expect(spec.HostConfig.NanoCpus).toBe(LIMITS.nanoCpus);
    expect(spec.HostConfig.PidsLimit).toBe(LIMITS.pidsLimit);
  });

  test("disables the network by default", () => {
    const spec = buildContainerSpec(request);

    expect(spec.HostConfig.NetworkMode).toBe("none");
  });

  test("enables the network only when the job asks for it", () => {
    const spec = buildContainerSpec({ ...request, network: true });

    expect(spec.HostConfig.NetworkMode).toBe("bridge");
  });

  test("mounts the job read-only and artifacts writable", () => {
    const spec = buildContainerSpec(request);

    expect(spec.HostConfig.Binds).toEqual([
      "/jobs/job_1:/job:ro",
      "/jobs/job_1/artifacts:/job/artifacts:rw",
    ]);
  });

  test("runs as a non-root user with dropped capabilities", () => {
    const spec = buildContainerSpec(request);

    expect(spec.User).toBe(LIMITS.user);
    expect(spec.HostConfig.CapDrop).toEqual(["ALL"]);
    expect(spec.HostConfig.SecurityOpt).toContain("no-new-privileges");
  });

  test("gives writable scratch space through tmpfs", () => {
    const spec = buildContainerSpec(request);

    expect(Object.keys(spec.HostConfig.Tmpfs)).toContain("/tmp");
  });

  test("keeps output unmultiplexed off so stdout and stderr stay separate", () => {
    const spec = buildContainerSpec(request);

    expect(spec.Tty).toBe(false);
    expect(spec.AttachStdout).toBe(true);
    expect(spec.AttachStderr).toBe(true);
  });

  test("points interpreter caches at writable paths", () => {
    const spec = buildContainerSpec(request);

    expect(spec.Env).toContain("HOME=/tmp");
    expect(spec.Env).toContain("PYTHONDONTWRITEBYTECODE=1");
  });

  test("passes caller environment through", () => {
    const spec = buildContainerSpec({ ...request, env: { VARIANT: "7" } });

    expect(spec.Env).toContain("VARIANT=7");
  });

  test("runs in the job directory by default", () => {
    const spec = buildContainerSpec(request);

    expect(spec.WorkingDir).toBe("/job");
  });

  test("rejects a relative job directory", () => {
    expect(() => buildContainerSpec({ ...request, jobDir: "jobs/job_1" })).toThrow(/absolute/i);
  });
});
