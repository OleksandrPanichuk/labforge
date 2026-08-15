import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerodeEngine } from "./docker-engine";
import { runInSandbox } from "./run";
import { RUNTIMES, type Runtime } from "./runtime";
import { resolveDockerSocket } from "./socket";

const dockerAvailable = resolveDockerSocket() !== undefined;

const IMAGES: Partial<Record<string, string>> = {
  python: process.env.LABFORGE_PYTHON_IMAGE ?? "python:3.12-slim",
  node: process.env.LABFORGE_NODE_IMAGE ?? "node:22-slim",
};

let jobDir: string;

function cell(name: string, source: string): string {
  const path = join(jobDir, "cells", name);

  writeFileSync(path, source, "utf8");

  return `cells/${name}`;
}

async function run(runtime: Runtime, cellRef: string) {
  return await runInSandbox(
    {
      image: IMAGES[runtime.id] ?? runtime.image,
      runtime: runtime.id,
      cmd: runtime.cellCommand(cellRef),
      jobDir,
    },
    new DockerodeEngine(),
  );
}

beforeAll(() => {
  jobDir = realpathSync(mkdtempSync(join(tmpdir(), "labforge-runtime-")));

  for (const directory of ["src", "cells", "artifacts", "build"]) {
    mkdirSync(join(jobDir, directory));
  }
});

afterAll(() => {
  rmSync(jobDir, { recursive: true, force: true });
});

describe.skipIf(!dockerAvailable)("a cell reaches the lab code in src/", () => {
  test("python imports a module from src", async () => {
    writeFileSync(join(jobDir, "src", "solver.py"), "def answer():\n    return 42\n", "utf8");
    const ref = cell(
      "metrics.py",
      'import json\nfrom src.solver import answer\nprint(json.dumps({"a": answer()}))',
    );

    const result = await run(RUNTIMES.python, ref);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ a: 42 });
  });

  test("node imports a module from src", async () => {
    writeFileSync(
      join(jobDir, "src", "solver.mjs"),
      "export function answer() {\n  return 42;\n}\n",
      "utf8",
    );
    const ref = cell(
      "metrics.mjs",
      'import { answer } from "../src/solver.mjs";\nconsole.log(JSON.stringify({ a: answer() }));',
    );

    const result = await run(RUNTIMES.node, ref);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ a: 42 });
  });

  test("a compiled runtime can write its output while the job stays read-only", async () => {
    const ref = cell(
      "writes.mjs",
      'import { writeFileSync } from "node:fs";\nwriteFileSync("/build/marker.txt", "built");\nconsole.log(JSON.stringify({ ok: 1 }));',
    );

    const result = await run(RUNTIMES.node, ref);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: 1 });
  });

  test("the job tree is still refused for writing", async () => {
    const ref = cell(
      "tamper.mjs",
      'import { writeFileSync } from "node:fs";\nwriteFileSync("/job/tamper.txt", "x");',
    );

    const result = await run(RUNTIMES.node, ref);

    expect(result.exitCode).not.toBe(0);
  });
});
