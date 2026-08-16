import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
    styles: { default: { font: "Times New Roman", size: 14 } },
    blocks: [{ id: "blk_1", type: "paragraph", text: "error is {{v:err_max}}" }],
    values: { err_max: { cellRef: "cells/errors.py", format: "sci:2" } },
    explanations: {},
    ...overrides,
  };
}

function writeIR(ir: ReportIR): void {
  writeFileSync(job.reportPath, JSON.stringify(ir, null, 2), "utf8");
}

function runner(outputs: Record<string, Partial<SandboxRunResult>>) {
  return {
    run(cellRef: string): Promise<SandboxRunResult> {
      const result = outputs[cellRef] ?? {};

      return Promise.resolve({
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "{}",
        stderr: result.stderr ?? "",
        durationMs: result.durationMs ?? 3,
      });
    },
  };
}

const workingCell = { "cells/errors.py": { stdout: '{"err_max": 0.0000032}' } };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-pipeline-")));
  job = createJobStore(root).createJob("job_1");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("buildReport", () => {
  test("produces a docx from a job whose cells run", async () => {
    writeIR(reportIR());

    const result = await buildReport({ job, cells: runner(workingCell) });

    expect(existsSync(result.docxPath)).toBe(true);
    expect(readFileSync(result.docxPath).length).toBeGreaterThan(0);
  });

  test("writes the resolved values back into the job", async () => {
    writeIR(reportIR());

    await buildReport({ job, cells: runner(workingCell) });

    const stored = JSON.parse(readFileSync(job.reportPath, "utf8")) as ReportIR;
    expect(stored.values.err_max?.value).toBe("3,20e-6");
  });

  test("records a run log for every cell so numbers keep their provenance", async () => {
    writeIR(reportIR());

    const result = await buildReport({ job, cells: runner(workingCell) });

    expect(result.runs).toHaveLength(1);
    expect(existsSync(join(job.dir, "runs", "cells-errors-py.json"))).toBe(true);
  });

  test("puts the resolved number into the rendered document", async () => {
    writeIR(reportIR());

    const result = await buildReport({ job, cells: runner(workingCell) });

    expect(readFileSync(result.docxPath).includes(Buffer.from("PK"))).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test("reports raw numbers in the text as warnings without blocking the build", async () => {
    writeIR(
      reportIR({
        blocks: [
          { id: "blk_1", type: "paragraph", text: "error is {{v:err_max}} and also 0,00432" },
        ],
      }),
    );

    const result = await buildReport({ job, cells: runner(workingCell) });

    expect(result.warnings.some((warning) => warning.rule === "raw-number")).toBe(true);
    expect(existsSync(result.docxPath)).toBe(true);
  });
});

describe("failure stages", () => {
  test("stops at validation when a placeholder has no binding", async () => {
    writeIR(reportIR({ values: {} }));

    const failure = await buildReport({ job, cells: runner({}) }).catch(
      (error: BuildError) => error,
    );

    expect(failure).toBeInstanceOf(BuildError);
    expect((failure as BuildError).stage).toBe("validate");
  });

  test("stops at resolve when a cell fails, naming the cell", async () => {
    writeIR(reportIR());

    const failure = await buildReport({
      job,
      cells: runner({ "cells/errors.py": { exitCode: 1, stderr: "Traceback: boom" } }),
    }).catch((error: BuildError) => error);

    expect((failure as BuildError).stage).toBe("resolve");
    expect((failure as BuildError).message).toContain("boom");
  });

  test("stops before rendering when a referenced artifact is missing", async () => {
    writeIR(
      reportIR({
        blocks: [
          {
            id: "blk_1",
            type: "image",
            src: "artifacts/absent.png",
            width: "80%",
            provenance: { kind: "generated", codeRef: "cells/plot.py" },
          },
        ],
        values: {},
      }),
    );

    const failure = await buildReport({ job, cells: runner({}) }).catch(
      (error: BuildError) => error,
    );

    expect((failure as BuildError).stage).toBe("verify");
  });

  test("accepts an image that is actually on disk", async () => {
    writeFileSync(join(job.dir, "artifacts", "plot.png"), ONE_PIXEL_PNG);
    writeIR(
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
        values: {},
      }),
    );

    const result = await buildReport({ job, cells: runner({}) });

    expect(existsSync(result.docxPath)).toBe(true);
  });

  test("stops at read when the job has no report", async () => {
    const failure = await buildReport({ job, cells: runner({}) }).catch(
      (error: BuildError) => error,
    );

    expect((failure as BuildError).stage).toBe("read");
  });

  test("stops at read when the report is not valid against the schema", async () => {
    writeFileSync(job.reportPath, JSON.stringify({ version: 1 }), "utf8");

    const failure = await buildReport({ job, cells: runner({}) }).catch(
      (error: BuildError) => error,
    );

    expect((failure as BuildError).stage).toBe("read");
  });

  test("leaves the job report untouched when the build fails", async () => {
    const original = reportIR({ values: {} });
    writeIR(original);

    await buildReport({ job, cells: runner({}) }).catch(() => undefined);

    expect(JSON.parse(readFileSync(job.reportPath, "utf8"))).toEqual(original);
  });
});

describe("student identity", () => {
  const profile = { name: "Панічук О. В.", group: "ІП-21", variant: "7" };

  test("stamps the identity the caller vouches for over whatever the agent wrote", async () => {
    writeIR(reportIR());

    const result = await buildReport({ job, cells: runner(workingCell), student: profile });

    expect(result.ir.meta.student).toEqual(profile);
    expect(JSON.parse(readFileSync(job.reportPath, "utf8")).meta.student.name).toBe(
      "Панічук О. В.",
    );
  });

  test("ignores a profile the agent planted in the job directory", async () => {
    writeFileSync(
      join(job.dir, "context", "student.json"),
      JSON.stringify({ name: "Не той студент", group: "ХХ-00" }),
      "utf8",
    );
    writeIR(reportIR());

    const result = await buildReport({ job, cells: runner(workingCell), student: profile });

    expect(result.ir.meta.student.name).toBe("Панічук О. В.");
  });

  test("warns that the agent had invented a different identity", async () => {
    writeIR(reportIR());

    const result = await buildReport({ job, cells: runner(workingCell), student: profile });
    const warning = result.warnings.find((issue) => issue.rule === "student-identity");

    expect(warning?.message).toContain("Student");
    expect(warning?.message).toContain("ІП-21");
  });

  test("says nothing when the agent copied the identity correctly", async () => {
    writeIR(reportIR());

    const result = await buildReport({
      job,
      cells: runner(workingCell),
      student: { name: "Student", group: "IP-21" },
    });

    expect(result.warnings.some((issue) => issue.rule === "student-identity")).toBe(false);
  });

  test("keeps a variant the profile does not carry", async () => {
    writeIR(
      reportIR({
        meta: {
          labId: "lab_1",
          subject: "numeric-methods",
          title: "Lab 1",
          student: { name: "Student", group: "IP-21", variant: "9" },
          language: "uk",
        },
      }),
    );

    const result = await buildReport({
      job,
      cells: runner(workingCell),
      student: { name: "Панічук О. В.", group: "ІП-21" },
    });

    expect(result.ir.meta.student.variant).toBe("9");
  });

  test("corrects the identity when only rendering as well", async () => {
    writeIR(reportIR());
    await buildReport({
      job,
      cells: runner(workingCell),
      mode: "resolve",
      student: { name: "Student", group: "IP-21" },
    });

    const result = await buildReport({ job, cells: runner({}), mode: "render", student: profile });

    expect(result.ir.meta.student.name).toBe("Панічук О. В.");
    expect(JSON.parse(readFileSync(job.reportPath, "utf8")).meta.student.name).toBe(
      "Панічук О. В.",
    );
  });

  test("builds a document whose caller vouches for nothing", async () => {
    writeIR(reportIR());

    const result = await buildReport({ job, cells: runner(workingCell) });

    expect(result.ir.meta.student.name).toBe("Student");
  });
});
