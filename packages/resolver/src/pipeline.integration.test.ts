import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReportIR } from "@labforge/ir";
import { validateReport } from "@labforge/ir";
import { DockerodeEngine, resolveDockerSocket, runInSandbox } from "@labforge/sandbox";
import { type CellRunner, resolveValues } from "./resolve";

const IMAGE = process.env.LABFORGE_TEST_IMAGE ?? "python:3.12-slim";
const dockerAvailable = resolveDockerSocket() !== undefined;

let jobDir: string;
let runner: CellRunner;

function makeIR(): ReportIR {
  return {
    version: 1,
    meta: {
      labId: "lab_1",
      subject: "numeric-methods",
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
    blocks: [
      { id: "blk_1", type: "paragraph", text: "maximum error is {{v:err_max}}" },
      { id: "blk_2", type: "paragraph", text: "sample count is {{v:samples}}" },
    ],
    values: {
      err_max: { cellRef: "cells/metrics.py", format: "sci:2" },
      samples: { cellRef: "cells/metrics.py", format: "int" },
    },
    explanations: {},
  };
}

describe.skipIf(!dockerAvailable)("resolver over a live sandbox", () => {
  beforeAll(() => {
    jobDir = realpathSync(mkdtempSync(join(tmpdir(), "labforge-pipeline-")));
    mkdirSync(join(jobDir, "src"));
    mkdirSync(join(jobDir, "cells"));
    mkdirSync(join(jobDir, "artifacts"));

    writeFileSync(
      join(jobDir, "src", "solver.py"),
      "def max_error(values):\n    return max(abs(v) for v in values)\n\n\ndef sample_count(values):\n    return len(values)\n",
      "utf8",
    );

    writeFileSync(
      join(jobDir, "cells", "metrics.py"),
      [
        "import json",
        "from src.solver import max_error, sample_count",
        "",
        "data = [1e-6, -3.2e-6, 2e-6]",
        'print(json.dumps({"err_max": max_error(data), "samples": sample_count(data)}))',
      ].join("\n"),
      "utf8",
    );

    runner = {
      run: (cellRef) =>
        runInSandbox({ image: IMAGE, cmd: ["python", cellRef], jobDir }, new DockerodeEngine()),
    };
  });

  afterAll(() => {
    rmSync(jobDir, { recursive: true, force: true });
  });

  test("fills every value by executing a cell that imports from src", async () => {
    const result = await resolveValues(makeIR(), runner);

    expect(result.errors).toEqual([]);
    expect(result.ir.values.err_max?.value).toBe("3,20e-6");
    expect(result.ir.values.samples?.value).toBe("3");
  });

  test("runs the shared cell once for both values", async () => {
    const result = await resolveValues(makeIR(), runner);

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]?.exitCode).toBe(0);
  });

  test("produces a document that passes post-resolve validation", async () => {
    const result = await resolveValues(makeIR(), runner);

    const report = validateReport(result.ir, { phase: "post-resolve" });

    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test("a broken cell leaves the value unresolved and fails validation", async () => {
    writeFileSync(join(jobDir, "cells", "broken.py"), 'raise RuntimeError("no data")', "utf8");
    const ir = makeIR();
    ir.values.err_max = { cellRef: "cells/broken.py", format: "sci:2" };
    ir.values.samples = { cellRef: "cells/broken.py", format: "int" };

    const result = await resolveValues(ir, runner);

    expect(result.errors[0]?.rule).toBe("cell-failed");
    expect(result.errors[0]?.message).toContain("no data");
    expect(validateReport(result.ir, { phase: "post-resolve" }).ok).toBe(false);
  });
});
