import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JobState } from "@labforge/jobs";
import type { Finding } from "@labforge/orchestrator";
import { z } from "zod";

const findingSchema = z.object({
  id: z.string(),
  severity: z.enum(["critical", "major", "minor"]),
  what: z.string(),
  status: z.string().optional(),
});

const findingsSchema = z.array(findingSchema);

const FILES: Partial<Record<JobState, string>> = {
  CODE_REVIEW: "findings.json",
  FIX: "findings.json",
  REPORT_REVIEW: "report-findings.json",
  IR_FIX: "report-findings.json",
};

export function findingsFileFor(state: JobState): string | undefined {
  return FILES[state];
}

export function readFindings(jobDir: string, state: JobState): Finding[] | undefined {
  const file = findingsFileFor(state);

  if (file === undefined) {
    return undefined;
  }

  const path = join(jobDir, "review", file);

  if (!existsSync(path)) {
    return [];
  }

  const parsed = findingsSchema.safeParse(parse(path));

  if (!parsed.success) {
    throw new Error(`${file} is not a readable findings list: ${parsed.error.message}`);
  }

  return parsed.data
    .filter((finding) => finding.status !== "fixed" && finding.status !== "wontfix")
    .map(({ id, severity, what }) => ({ id, severity, what }));
}

function parse(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}
