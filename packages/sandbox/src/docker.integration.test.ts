import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerodeEngine } from "./docker-engine";
import { SandboxTimeoutError } from "./errors";
import { runInSandbox } from "./run";
import { resolveDockerSocket } from "./socket";

const IMAGE = process.env.LABFORGE_TEST_IMAGE ?? "python:3.12-slim";
const dockerAvailable = resolveDockerSocket() !== undefined;

let jobDir: string;

function writeCell(name: string, source: string): void {
  writeFileSync(join(jobDir, "cells", name), source, "utf8");
}

function run(cmd: string[], overrides: { timeoutMs?: number; network?: boolean } = {}) {
  return runInSandbox({ image: IMAGE, cmd, jobDir, ...overrides }, new DockerodeEngine());
}

describe.skipIf(!dockerAvailable)("sandbox against a live docker daemon", () => {
  beforeAll(() => {
    jobDir = realpathSync(mkdtempSync(join(tmpdir(), "labforge-sandbox-")));
    mkdirSync(join(jobDir, "cells"));
    mkdirSync(join(jobDir, "artifacts"));
  });

  afterAll(() => {
    rmSync(jobDir, { recursive: true, force: true });
  });

  test("runs a cell and returns its stdout", async () => {
    writeCell("ok.py", 'import json; print(json.dumps({"err_max": 3.2e-6}))');

    const result = await run(["python", "cells/ok.py"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ err_max: 3.2e-6 });
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test("keeps stderr out of stdout", async () => {
    writeCell(
      "noisy.py",
      'import sys, json\nprint("loading", file=sys.stderr)\nprint(json.dumps({"a": 1}))',
    );

    const result = await run(["python", "cells/noisy.py"]);

    expect(JSON.parse(result.stdout)).toEqual({ a: 1 });
    expect(result.stderr).toContain("loading");
  });

  test("reports a failing cell instead of throwing", async () => {
    writeCell("boom.py", 'raise ValueError("boom")');

    const result = await run(["python", "cells/boom.py"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("boom");
  });

  test("runs as a non-root user", async () => {
    const result = await run(["python", "-c", "import os; print(os.getuid())"]);

    expect(result.stdout.trim()).toBe("1000");
  });

  test("blocks network access by default", async () => {
    writeCell(
      "net.py",
      "import socket\nsocket.create_connection(('1.1.1.1', 80), timeout=5)\nprint('reached')",
    );

    const result = await run(["python", "cells/net.py"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("reached");
  });

  test("mounts the job directory read-only", async () => {
    const result = await run(["python", "-c", "open('/job/tamper.txt', 'w').write('x')"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Read-only file system|Permission denied/);
    expect(existsSync(join(jobDir, "tamper.txt"))).toBe(false);
  });

  test("lets a cell write into artifacts", async () => {
    const result = await run(["python", "-c", "open('/job/artifacts/plot.png', 'w').write('png')"]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(jobDir, "artifacts", "plot.png"))).toBe(true);
  });

  test("lets a cell import lab code from src", async () => {
    mkdirSync(join(jobDir, "src"), { recursive: true });
    writeFileSync(join(jobDir, "src", "solver.py"), "def answer():\n    return 42\n", "utf8");
    writeCell(
      "importer.py",
      'import json\nfrom src.solver import answer\nprint(json.dumps({"a": answer()}))',
    );

    const result = await run(["python", "cells/importer.py"]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ a: 42 });
  });

  test("kills a cell that outruns its timeout", async () => {
    const run = runInSandbox(
      { image: IMAGE, cmd: ["sleep", "30"], jobDir, timeoutMs: 2000 },
      new DockerodeEngine(),
    );

    expect(run).rejects.toBeInstanceOf(SandboxTimeoutError);
    await run.catch(() => undefined);
  });

  test("leaves no container behind", async () => {
    const before = await settledContainerCount();

    await run(["python", "-c", "print(1)"]);

    expect(await settledContainerCount(before)).toBe(before);
  });
});

async function listContainerCount(): Promise<number> {
  const proc = Bun.spawn(["docker", "ps", "-aq"], { stdout: "pipe" });
  const output = await new Response(proc.stdout).text();

  return output.split("\n").filter((line) => line.trim() !== "").length;
}

async function settledContainerCount(target?: number): Promise<number> {
  let count = await listContainerCount();

  for (let attempt = 0; attempt < 20 && count !== target; attempt += 1) {
    await Bun.sleep(100);
    count = await listContainerCount();
  }

  return count;
}
