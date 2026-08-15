import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReportIR } from "@labforge/ir";
import { createJobStore, type Job } from "@labforge/jobs";
import type { SandboxRunResult } from "@labforge/sandbox";
import { BuildError, buildReport } from "./build";

let root: string;
let job: Job;

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function reportIR(overrides: Partial<ReportIR> = {}): ReportIR {
  return {
    version: 1,
    meta: {
      labId: "lab_1",
      subject: "nm",
      title: "Lab 1",
      student: { name: "Student", group: "IP-21" },
      language: "uk",
    },
    page: {
      size: "A4",
      marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
      pageNumbers: true,
    },
    styles: { default: { size: 14 } },
    blocks: [{ id: "blk_1", type: "paragraph", text: "plain" }],
    values: {},
    explanations: {},
    ...overrides,
  };
}

function writeIR(target: Job, ir: ReportIR): void {
  writeFileSync(target.reportPath, JSON.stringify(ir, null, 2), "utf8");
}

function runner(outputs: Record<string, Partial<SandboxRunResult>> = {}) {
  const calls: string[] = [];

  return {
    calls,
    run(cellRef: string): Promise<SandboxRunResult> {
      calls.push(cellRef);
      const result = outputs[cellRef] ?? {};

      return Promise.resolve({
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "{}",
        stderr: result.stderr ?? "",
        durationMs: 1,
      });
    },
  };
}

function listing(file: string, lines?: [number, number]): ReportIR {
  return reportIR({
    blocks: [
      { id: "blk_1", type: "code-listing", language: "python", file, ...(lines && { lines }) },
    ],
  });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-harden-")));
  job = createJobStore(root).createJob("job_1");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("paths in the document", () => {
  test("refuses to read another job through a relative path", () => {
    const other = createJobStore(root).createJob("job_2");
    writeFileSync(join(other.dir, "src", "secret.py"), "a\nb\nc\n");
    writeIR(job, listing("../job_2/src/secret.py", [1, 99]));

    const failure = buildReport({ job, cells: runner() }).catch((error: BuildError) => error);

    expect(failure).resolves.toBeInstanceOf(BuildError);
  });

  test("does not leak another job's file size in the message", async () => {
    const other = createJobStore(root).createJob("job_2");
    writeFileSync(join(other.dir, "src", "secret.py"), "a\nb\nc\n");
    writeIR(job, listing("../job_2/src/secret.py", [1, 99]));

    const failure = (await buildReport({ job, cells: runner() }).catch(
      (error: BuildError) => error,
    )) as BuildError;

    expect(failure.message).not.toContain("3 lines");
  });

  test("refuses a device file instead of reading it forever", async () => {
    writeIR(job, listing("../../../../dev/zero", [1, 1]));

    const failure = (await buildReport({ job, cells: runner() }).catch(
      (error: BuildError) => error,
    )) as BuildError;

    expect(failure).toBeInstanceOf(BuildError);
  });

  test("reports a directory used as a listing as a build failure", async () => {
    writeIR(job, listing("src", [1, 2]));

    const failure = (await buildReport({ job, cells: runner() }).catch(
      (error: BuildError) => error,
    )) as BuildError;

    expect(failure).toBeInstanceOf(BuildError);
    expect(failure.stage).toBe("validate");
  });

  test("blames the document, not the renderer, for a path outside the job", async () => {
    writeIR(job, listing("../../../../etc/passwd", [1, 1]));

    const failure = (await buildReport({ job, cells: runner() }).catch(
      (error: BuildError) => error,
    )) as BuildError;

    expect(failure.stage).toBe("validate");
  });
});

describe("evidence and routing", () => {
  test("writes run logs even when a cell fails, so the fix has something to read", async () => {
    writeIR(
      job,
      reportIR({
        blocks: [{ id: "blk_1", type: "paragraph", text: "{{v:a}}" }],
        values: { a: { cellRef: "cells/one.py" } },
      }),
    );

    await buildReport({
      job,
      cells: runner({ "cells/one.py": { exitCode: 1, stderr: "Traceback: boom" } }),
    }).catch(() => undefined);

    const log = join(job.dir, "runs", "cells-one-py.json");
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, "utf8")).toContain("boom");
  });

  test("keeps the resolver's issues so the state machine can route them", async () => {
    writeIR(
      job,
      reportIR({
        blocks: [{ id: "blk_1", type: "paragraph", text: "{{v:a}}" }],
        values: { a: { cellRef: "cells/one.py" } },
      }),
    );

    const failure = (await buildReport({
      job,
      cells: runner({ "cells/one.py": { exitCode: 1, stderr: "boom" } }),
    }).catch((error: BuildError) => error)) as BuildError;

    expect(failure.issues.map((issue) => issue.rule)).toContain("cell-failed");
  });

  test("writes run logs when the job directory has no runs folder", async () => {
    rmSync(join(job.dir, "runs"), { recursive: true, force: true });
    writeIR(
      job,
      reportIR({
        blocks: [{ id: "blk_1", type: "paragraph", text: "{{v:a}}" }],
        values: { a: { cellRef: "cells/one.py" } },
      }),
    );

    const result = await buildReport({
      job,
      cells: runner({ "cells/one.py": { stdout: '{"a": 1}' } }),
    });

    expect(result.runs).toHaveLength(1);
    expect(existsSync(join(job.dir, "runs", "cells-one-py.json"))).toBe(true);
  });

  test("catches a missing source listing before running any cell", async () => {
    const cells = runner({ "cells/one.py": { stdout: '{"a": 1}' } });
    writeIR(
      job,
      reportIR({
        blocks: [
          { id: "blk_1", type: "paragraph", text: "{{v:a}}" },
          { id: "blk_2", type: "code-listing", language: "python", file: "src/absent.py" },
        ],
        values: { a: { cellRef: "cells/one.py" } },
      }),
    );

    const failure = (await buildReport({ job, cells }).catch(
      (error: BuildError) => error,
    )) as BuildError;

    expect(failure.stage).toBe("validate");
    expect(cells.calls).toEqual([]);
  });

  test("still allows an image a cell has not produced yet", async () => {
    const cells = runner({ "cells/plot.py": { stdout: "{}" } });
    writeIR(
      job,
      reportIR({
        blocks: [
          {
            id: "blk_1",
            type: "image",
            src: "artifacts/plot.png",
            width: "80%",
            provenance: { kind: "generated", codeRef: "cells/plot.py" },
          },
        ],
      }),
    );
    writeFileSync(join(job.dir, "artifacts", "plot.png"), ONE_PIXEL_PNG);

    const result = await buildReport({ job, cells });

    expect(existsSync(result.docxPath)).toBe(true);
  });
});

describe("what survives a failure", () => {
  test("does not leave a stale docx beside a document that failed to render", async () => {
    writeFileSync(join(job.dir, "artifacts", "plot.png"), ONE_PIXEL_PNG);
    writeIR(job, reportIR());
    const first = await buildReport({ job, cells: runner() });
    expect(existsSync(first.docxPath)).toBe(true);

    writeFileSync(join(job.dir, "artifacts", "broken.png"), Buffer.from("not a png"));
    writeIR(
      job,
      reportIR({
        blocks: [
          {
            id: "blk_1",
            type: "image",
            src: "artifacts/broken.png",
            width: "80%",
            provenance: { kind: "generated", codeRef: "cells/plot.py" },
          },
        ],
      }),
    );

    await buildReport({ job, cells: runner() }).catch(() => undefined);

    expect(existsSync(first.docxPath)).toBe(false);
  });

  test("leaves the document untouched when rendering fails", async () => {
    writeFileSync(join(job.dir, "artifacts", "broken.png"), Buffer.from("not a png"));
    const document = reportIR({
      blocks: [
        { id: "blk_1", type: "paragraph", text: "{{v:a}}" },
        {
          id: "blk_2",
          type: "image",
          src: "artifacts/broken.png",
          width: "80%",
          provenance: { kind: "generated", codeRef: "cells/plot.py" },
        },
      ],
      values: { a: { cellRef: "cells/one.py" } },
    });
    writeIR(job, document);

    await buildReport({
      job,
      cells: runner({ "cells/one.py": { stdout: '{"a": 1}' } }),
    }).catch(() => undefined);

    expect(JSON.parse(readFileSync(job.reportPath, "utf8"))).toEqual(document);
  });

  test("reports each warning once", async () => {
    writeIR(
      job,
      reportIR({
        blocks: [{ id: "blk_1", type: "paragraph", text: "the value 0,00432 is inline" }],
        values: { spare: { cellRef: "cells/one.py", value: "1" } },
      }),
    );

    const result = await buildReport({ job, cells: runner() });
    const rules = result.warnings.map(
      (warning) => `${warning.rule}:${warning.blockId ?? warning.key}`,
    );

    expect(new Set(rules).size).toBe(rules.length);
  });
});

describe("crash safety", () => {
  test("leaves no temporary files behind", async () => {
    mkdirSync(join(job.dir, "artifacts"), { recursive: true });
    writeIR(job, reportIR());

    await buildReport({ job, cells: runner() });

    expect(existsSync(`${job.reportPath}.tmp`)).toBe(false);
  });
});
