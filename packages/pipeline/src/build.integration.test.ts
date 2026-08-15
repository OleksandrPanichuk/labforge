import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  existsSync,
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
import { DockerodeEngine, resolveDockerSocket, runInSandbox } from "@labforge/sandbox";
import { buildReport } from "./build";

const IMAGE = process.env.LABFORGE_TEST_IMAGE ?? "python:3.12-slim";
const dockerAvailable = resolveDockerSocket() !== undefined;

let root: string;
let job: Job;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-e2e-")));
  job = createJobStore(root).createJob("job_1");

  writeFileSync(
    join(job.dir, "src", "solver.py"),
    "def max_error(values):\n    return max(abs(v) for v in values)\n",
    "utf8",
  );
  writeFileSync(
    join(job.dir, "cells", "metrics.py"),
    [
      "import json",
      "from src.solver import max_error",
      "",
      'print(json.dumps({"err_max": max_error([1e-6, -3.2e-6])}))',
    ].join("\n"),
    "utf8",
  );

  const document: ReportIR = {
    version: 1,
    meta: {
      labId: "lab_1",
      subject: "numeric-methods",
      title: "Лабораторна робота №1",
      student: { name: "Панічук О.", group: "ІП-21" },
      language: "uk",
    },
    page: {
      size: "A4",
      marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
      pageNumbers: true,
    },
    styles: { default: { font: "Times New Roman", size: 14, lineHeight: 1.5 } },
    blocks: [
      { id: "blk_1", type: "heading", level: 1, text: "РЕЗУЛЬТАТИ" },
      { id: "blk_2", type: "paragraph", text: "Максимальна похибка склала {{v:err_max}}." },
      { id: "blk_3", type: "formula", latex: "e = \\max |y_i - \\hat{y}_i|", numbered: true },
      {
        id: "blk_4",
        type: "code-listing",
        language: "python",
        file: "src/solver.py",
        caption: "Лістинг 1",
      },
    ],
    values: { err_max: { cellRef: "cells/metrics.py", format: "sci:2" } },
    explanations: {},
  };

  writeFileSync(job.reportPath, JSON.stringify(document, null, 2), "utf8");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test.skipIf(!dockerAvailable)("builds a report end to end through the real sandbox", async () => {
  const cells = {
    run: (cellRef: string) =>
      runInSandbox(
        { image: IMAGE, cmd: ["python", cellRef], jobDir: job.dir },
        new DockerodeEngine(),
      ),
  };

  const result = await buildReport({ job, cells });

  expect(result.warnings).toEqual([]);
  expect(result.ir.values.err_max?.value).toBe("3,20e-6");
  expect(existsSync(result.docxPath)).toBe(true);

  const stored = JSON.parse(readFileSync(job.reportPath, "utf8")) as ReportIR;
  expect(stored.values.err_max?.runRef).toBe("runs/cells-metrics-py.json");
  expect(existsSync(join(job.dir, "runs", "cells-metrics-py.json"))).toBe(true);

  job.advanceTo("BUILD");
  expect(job.git.log()[0]).toContain("BUILD");
});
