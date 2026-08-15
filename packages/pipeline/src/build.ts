import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type FileProbe,
  type ReportIR,
  reportIR,
  type ValidationIssue,
  validateReport,
} from "@labforge/ir";
import type { Job } from "@labforge/jobs";
import { renderReport } from "@labforge/renderer-docx";
import { type CellRunner, type CellRunRecord, resolveValues } from "@labforge/resolver";

export type BuildStage = "read" | "validate" | "resolve" | "verify" | "render";

export const DOCX_FILE = "report.docx";

export class BuildError extends Error {
  constructor(
    readonly stage: BuildStage,
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export interface BuildRequest {
  job: Job;
  cells: CellRunner;
  decimalSeparator?: string;
}

export interface BuildResult {
  docxPath: string;
  ir: ReportIR;
  runs: CellRunRecord[];
  warnings: ValidationIssue[];
}

export async function buildReport(request: BuildRequest): Promise<BuildResult> {
  const { job } = request;
  const document = readReport(job.reportPath);
  const warnings: ValidationIssue[] = [];

  warnings.push(...check(document, "validate", { phase: "pre-resolve" }));

  const resolved = await resolveValues(document, request.cells, {
    decimalSeparator: request.decimalSeparator,
  });

  if (resolved.errors.length > 0) {
    throw new BuildError("resolve", resolved.errors.map((issue) => issue.message).join("; "));
  }

  writeRunLogs(job, resolved.runs);
  warnings.push(
    ...check(resolved.ir, "verify", { phase: "post-resolve", files: jobProbe(job.dir) }),
  );

  writeFileSync(job.reportPath, `${JSON.stringify(resolved.ir, null, 2)}\n`, "utf8");

  const docxPath = join(job.dir, DOCX_FILE);

  try {
    writeFileSync(docxPath, await renderReport(resolved.ir, { jobDir: job.dir }));
  } catch (error) {
    throw new BuildError("render", error instanceof Error ? error.message : String(error));
  }

  return { docxPath, ir: resolved.ir, runs: resolved.runs, warnings };
}

function readReport(path: string): ReportIR {
  if (!existsSync(path)) {
    throw new BuildError("read", `The job has no ${path} to build`);
  }

  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new BuildError("read", `${path} is not valid JSON`);
  }

  const parsed = reportIR.safeParse(raw);

  if (!parsed.success) {
    throw new BuildError(
      "read",
      `${path} does not match the report schema: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

function check(
  document: ReportIR,
  stage: BuildStage,
  options: { phase: "pre-resolve" | "post-resolve"; files?: FileProbe },
): ValidationIssue[] {
  const result = validateReport(document, options);

  if (!result.ok) {
    throw new BuildError(
      stage,
      result.errors.map((issue) => issue.message).join("; "),
      result.errors,
    );
  }

  return result.warnings;
}

function writeRunLogs(job: Job, runs: CellRunRecord[]): void {
  for (const run of runs) {
    writeFileSync(join(job.dir, run.runRef), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  }
}

function jobProbe(jobDir: string): FileProbe {
  return {
    exists: (relativePath) => existsSync(join(jobDir, relativePath)),
    countLines: (relativePath) =>
      readFileSync(join(jobDir, relativePath), "utf8")
        .replace(/\r?\n$/, "")
        .split(/\r?\n/).length,
  };
}
