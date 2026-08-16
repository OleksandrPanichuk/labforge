import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type StudentProfile, studentProfileSchema } from "@labforge/configs";
import { type ReportIR, reportIR, type ValidationIssue, validateReport } from "@labforge/ir";
import type { Job } from "@labforge/jobs";
import { renderReport } from "@labforge/renderer-docx";
import {
  type CellRunner,
  type CellRunRecord,
  type ResolveIssue,
  resolveValues,
} from "@labforge/resolver";
import { generatedArtifacts, jobProbe } from "./probe";

export type BuildStage = "read" | "validate" | "resolve" | "verify" | "render";

export const DOCX_FILE = "report.docx";

const STUDENT_CONTEXT = join("context", "student.json");

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

export type BuildMode = "full" | "resolve" | "render";

export interface BuildRequest {
  job: Job;
  cells: CellRunner;
  decimalSeparator?: string;
  mode?: BuildMode;
}

export interface BuildResult {
  docxPath: string;
  ir: ReportIR;
  runs: CellRunRecord[];
  warnings: ValidationIssue[];
}

export async function buildReport(request: BuildRequest): Promise<BuildResult> {
  const { job } = request;
  const mode = request.mode ?? "full";
  const docxPath = join(job.dir, DOCX_FILE);
  const read = readReport(job.reportPath);
  const warnings: ValidationIssue[] = [];

  if (mode === "render") {
    check(read, "verify", { phase: "post-resolve", files: jobProbe(job.dir) });
    writeAtomically(docxPath, await render(read, job.dir));

    return { docxPath, ir: read, runs: [], warnings };
  }

  const stamped = stampStudent(read, job.dir);
  const document = stamped.ir;
  const pending = generatedArtifacts(document);

  warnings.push(...stamped.warnings);

  try {
    warnings.push(
      ...check(document, "validate", {
        phase: "pre-resolve",
        files: jobProbe(job.dir, pending),
      }),
    );

    const resolved = await resolveValues(document, request.cells, {
      decimalSeparator: request.decimalSeparator,
    });

    writeRunLogs(job, resolved.runs);

    if (resolved.errors.length > 0) {
      throw new BuildError(
        "resolve",
        resolved.errors.map((issue) => issue.message).join("; "),
        resolved.errors.map(asValidationIssue),
      );
    }

    check(resolved.ir, "verify", { phase: "post-resolve", files: jobProbe(job.dir) });

    const docx = mode === "full" ? await render(resolved.ir, job.dir) : undefined;

    writeAtomically(job.reportPath, `${JSON.stringify(resolved.ir, null, 2)}\n`);

    if (docx !== undefined) {
      writeAtomically(docxPath, docx);
    }

    return { docxPath, ir: resolved.ir, runs: resolved.runs, warnings: dedupe(warnings) };
  } catch (error) {
    rmSync(docxPath, { force: true });
    throw error;
  }
}

async function render(document: ReportIR, jobDir: string): Promise<Buffer> {
  try {
    return await renderReport(document, { jobDir });
  } catch (error) {
    throw new BuildError("render", error instanceof Error ? error.message : String(error));
  }
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

function stampStudent(
  document: ReportIR,
  jobDir: string,
): { ir: ReportIR; warnings: ValidationIssue[] } {
  const path = join(jobDir, STUDENT_CONTEXT);

  if (!existsSync(path)) {
    return { ir: document, warnings: [] };
  }

  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new BuildError("read", `${STUDENT_CONTEXT} is not valid JSON`);
  }

  const parsed = studentProfileSchema.safeParse(raw);

  if (!parsed.success) {
    throw new BuildError("read", `${STUDENT_CONTEXT} is not a usable student profile`);
  }

  const student = parsed.data;

  if (sameStudent(document.meta.student, student)) {
    return { ir: document, warnings: [] };
  }

  return {
    ir: { ...document, meta: { ...document.meta, student } },
    warnings: [
      {
        rule: "student-identity",
        severity: "warning",
        message: `The report named "${document.meta.student.name}"; ${STUDENT_CONTEXT} says "${student.name}" and that is what the report now carries`,
      },
    ],
  };
}

function sameStudent(inReport: StudentProfile, profile: StudentProfile): boolean {
  return (
    inReport.name === profile.name &&
    inReport.group === profile.group &&
    inReport.variant === profile.variant
  );
}

function check(
  document: ReportIR,
  stage: BuildStage,
  options: Parameters<typeof validateReport>[1],
): ValidationIssue[] {
  let result: ReturnType<typeof validateReport>;

  try {
    result = validateReport(document, options);
  } catch (error) {
    throw new BuildError(stage, error instanceof Error ? error.message : String(error));
  }

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
    const target = join(job.dir, run.runRef);

    mkdirSync(dirname(target), { recursive: true });
    writeAtomically(target, `${JSON.stringify(run, null, 2)}\n`);
  }
}

function writeAtomically(path: string, content: string | Buffer): void {
  const temporary = `${path}.tmp`;
  const file = openSync(temporary, "w");

  try {
    writeSync(file, content as never);
    fsyncSync(file);
  } finally {
    closeSync(file);
  }

  renameSync(temporary, path);
}

function asValidationIssue(issue: ResolveIssue): ValidationIssue {
  return {
    rule: issue.rule,
    severity: "error",
    message: issue.message,
    ...(issue.key !== undefined && { key: issue.key }),
  };
}

function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = `${issue.rule}|${issue.blockId ?? ""}|${issue.key ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}
