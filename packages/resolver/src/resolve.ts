import { inlineTextsOf, type ReportIR, type ValueEntry } from "@labforge/ir";
import type { SandboxRunResult } from "@labforge/sandbox";
import { type CellValue, formatValue } from "./format";

export interface CellRunner {
  run(cellRef: string): Promise<SandboxRunResult>;
}

export type ResolveIssueRule =
  | "binding-missing"
  | "cell-failed"
  | "output-unparsable"
  | "key-missing"
  | "format-invalid";

export interface ResolveIssue {
  rule: ResolveIssueRule;
  message: string;
  key?: string;
  cellRef?: string;
}

export interface CellRunRecord {
  cellRef: string;
  runRef: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  keys: string[];
}

export interface ResolveOptions {
  decimalSeparator?: string;
}

export interface ResolveResult {
  ir: ReportIR;
  runs: CellRunRecord[];
  errors: ResolveIssue[];
}

const PLACEHOLDER_RE = /\{\{v:([\w-]+)\}\}/g;

export async function resolveValues(
  ir: ReportIR,
  runner: CellRunner,
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  const decimalSeparator = options.decimalSeparator ?? ",";
  const values: Record<string, ValueEntry> = { ...ir.values };
  const errors: ResolveIssue[] = [];
  const runs: CellRunRecord[] = [];

  const { cells, missing } = groupKeysByCell(ir, values);
  errors.push(...missing);

  for (const [cellRef, keys] of cells) {
    const result = await runner.run(cellRef);
    const runRef = runRefFor(cellRef);
    runs.push({ cellRef, runRef, keys, ...pickOutput(result) });

    if (result.exitCode !== 0) {
      errors.push({
        rule: "cell-failed",
        cellRef,
        message: `Cell ${cellRef} exited with code ${result.exitCode}: ${result.stderr.trim()}`,
      });
      continue;
    }

    const parsed = parseCellOutput(result.stdout);

    if (parsed === undefined) {
      errors.push({
        rule: "output-unparsable",
        cellRef,
        message: `Cell ${cellRef} did not print a JSON object to stdout`,
      });
      continue;
    }

    errors.push(...assignKeys({ keys, parsed, cellRef, runRef, values, decimalSeparator }));
  }

  return { ir: { ...ir, values }, runs, errors };
}

function groupKeysByCell(
  ir: ReportIR,
  values: Record<string, ValueEntry>,
): { cells: Map<string, string[]>; missing: ResolveIssue[] } {
  const cells = new Map<string, string[]>();
  const missing: ResolveIssue[] = [];

  for (const key of collectPlaceholderKeys(ir)) {
    const binding = values[key];

    if (binding === undefined) {
      missing.push({
        rule: "binding-missing",
        key,
        message: `Placeholder {{v:${key}}} has no entry in values`,
      });
      continue;
    }

    const keys = cells.get(binding.cellRef) ?? [];
    keys.push(key);
    cells.set(binding.cellRef, keys);
  }

  return { cells, missing };
}

function collectPlaceholderKeys(ir: ReportIR): string[] {
  const keys = new Set<string>();

  for (const block of ir.blocks) {
    for (const text of inlineTextsOf(block)) {
      for (const match of text.matchAll(new RegExp(PLACEHOLDER_RE.source, "g"))) {
        if (match[1] !== undefined) {
          keys.add(match[1]);
        }
      }
    }
  }

  return [...keys];
}

interface AssignRequest {
  keys: string[];
  parsed: Record<string, CellValue>;
  cellRef: string;
  runRef: string;
  values: Record<string, ValueEntry>;
  decimalSeparator: string;
}

function assignKeys(request: AssignRequest): ResolveIssue[] {
  const issues: ResolveIssue[] = [];

  for (const key of request.keys) {
    const raw = request.parsed[key];
    const binding = request.values[key];

    if (raw === undefined || binding === undefined) {
      issues.push({
        rule: "key-missing",
        key,
        cellRef: request.cellRef,
        message: `Cell ${request.cellRef} did not print the key "${key}"`,
      });
      continue;
    }

    try {
      request.values[key] = {
        ...binding,
        raw,
        value: formatValue(raw, binding.format, request.decimalSeparator),
        runRef: request.runRef,
      };
    } catch (error) {
      issues.push({
        rule: "format-invalid",
        key,
        cellRef: request.cellRef,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return issues;
}

function parseCellOutput(stdout: string): Record<string, CellValue> | undefined {
  const candidates = [stdout.trim(), ...stdout.split("\n").reverse()];

  for (const candidate of candidates) {
    const parsed = parseObject(candidate.trim());
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function parseObject(candidate: string): Record<string, CellValue> | undefined {
  if (!candidate.startsWith("{")) {
    return undefined;
  }

  try {
    return JSON.parse(candidate) as Record<string, CellValue>;
  } catch {
    return undefined;
  }
}

function pickOutput(result: SandboxRunResult) {
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
  };
}

function runRefFor(cellRef: string): string {
  return `runs/${cellRef.replace(/[^\w]+/g, "-")}.json`;
}
