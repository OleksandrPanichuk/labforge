import { describe, expect, test } from "bun:test";
import { SandboxTimeoutError } from "./errors";
import type { SandboxContainer, SandboxEngine } from "./run";
import { runInSandbox } from "./run";

function frame(stream: 1 | 2, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

interface FakeOptions {
  exitCode?: number;
  output?: Buffer;
  waitForever?: boolean;
}

function fakeEngine(options: FakeOptions = {}) {
  const calls: string[] = [];

  const container: SandboxContainer = {
    start() {
      calls.push("start");
      return Promise.resolve();
    },
    wait() {
      calls.push("wait");
      return options.waitForever
        ? new Promise<number>(() => {})
        : Promise.resolve(options.exitCode ?? 0);
    },
    kill() {
      calls.push("kill");
      return Promise.resolve();
    },
    output() {
      calls.push("output");
      return Promise.resolve(options.output ?? Buffer.alloc(0));
    },
    remove() {
      calls.push("remove");
      return Promise.resolve();
    },
  };

  const engine: SandboxEngine = {
    create() {
      calls.push("create");
      return Promise.resolve(container);
    },
  };

  return { engine, calls };
}

const request = {
  image: "lab-python",
  cmd: ["python", "cells/errors.py"],
  jobDir: "/jobs/job_1",
};

describe("runInSandbox", () => {
  test("returns the exit code and separated output", async () => {
    const { engine } = fakeEngine({
      exitCode: 0,
      output: Buffer.concat([frame(1, '{"err_max": 1}'), frame(2, "warning")]),
    });

    const result = await runInSandbox(request, engine);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"err_max": 1}');
    expect(result.stderr).toBe("warning");
  });

  test("reports a non-zero exit instead of throwing", async () => {
    const { engine } = fakeEngine({ exitCode: 1, output: frame(2, "Traceback") });

    const result = await runInSandbox(request, engine);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("Traceback");
  });

  test("measures how long the run took", async () => {
    const { engine } = fakeEngine();

    const result = await runInSandbox(request, engine);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("kills the container and throws when the timeout elapses", async () => {
    const { engine, calls } = fakeEngine({ waitForever: true });

    const run = runInSandbox({ ...request, timeoutMs: 20 }, engine);

    expect(run).rejects.toBeInstanceOf(SandboxTimeoutError);
    await run.catch(() => undefined);
    expect(calls).toContain("kill");
  });

  test("removes the container after a successful run", async () => {
    const { engine, calls } = fakeEngine();

    await runInSandbox(request, engine);

    expect(calls).toContain("remove");
  });

  test("removes the container after a timeout", async () => {
    const { engine, calls } = fakeEngine({ waitForever: true });

    await runInSandbox({ ...request, timeoutMs: 20 }, engine).catch(() => undefined);

    expect(calls).toContain("remove");
  });
});
