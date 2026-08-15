import type { Block, ReportIR } from "./schema";

export type ValidationSeverity = "error" | "warning";

export type ValidationPhase = "pre-resolve" | "post-resolve";

export interface ValidationIssue {
  rule: string;
  severity: ValidationSeverity;
  message: string;
  blockId?: string;
  key?: string;
}

export interface FileProbe {
  exists(relativePath: string): boolean;
  countLines(relativePath: string): number;
}

export interface ValidateOptions {
  phase: ValidationPhase;
  files?: FileProbe;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const PLACEHOLDER_RE = /\{\{v:([\w-]+)\}\}/g;
const EXPLANATION_REF_RE = /<span\s+data-x="([\w-]+)"/g;
const TAG_RE = /<[^>]*>/g;
const NUMBER_RE = /(=\s*)?(-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?)/g;

export function validateReport(ir: ReportIR, options: ValidateOptions): ValidationResult {
  const issues = [
    ...checkBlockIds(ir),
    ...checkStyles(ir),
    ...checkValues(ir, options.phase),
    ...checkExplanations(ir),
    ...checkFiles(ir, options.files),
    ...checkRawNumbers(ir),
  ];

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return { ok: errors.length === 0, errors, warnings };
}

export function inlineTextsOf(block: Block): string[] {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return [block.text];
    case "list":
      return block.items;
    case "table":
      return [block.caption ?? "", ...block.header, ...block.rows.flat()];
    case "image":
    case "code-listing":
      return [block.caption ?? ""];
    default:
      return [];
  }
}

function collectRefs(ir: ReportIR, pattern: RegExp): Map<string, string> {
  const refs = new Map<string, string>();

  for (const block of ir.blocks) {
    for (const text of inlineTextsOf(block)) {
      for (const match of text.matchAll(new RegExp(pattern.source, "g"))) {
        const id = match[1];
        if (id !== undefined && !refs.has(id)) {
          refs.set(id, block.id);
        }
      }
    }
  }

  return refs;
}

function checkBlockIds(ir: ReportIR): ValidationIssue[] {
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];

  for (const block of ir.blocks) {
    if (seen.has(block.id)) {
      issues.push({
        rule: "block-id-duplicate",
        severity: "error",
        blockId: block.id,
        message: `Block id ${block.id} is used more than once`,
      });
    }
    seen.add(block.id);
  }

  return issues;
}

function checkStyles(ir: ReportIR): ValidationIssue[] {
  return ir.blocks
    .filter((block) => block.style !== undefined && !(block.style in ir.styles))
    .map((block) => ({
      rule: "style-missing",
      severity: "error" as const,
      blockId: block.id,
      message: `Block ${block.id} uses style "${block.style}" which is not defined in styles`,
    }));
}

function checkValues(ir: ReportIR, phase: ValidationPhase): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const used = collectRefs(ir, PLACEHOLDER_RE);

  for (const [key, blockId] of used) {
    const entry = ir.values[key];

    if (entry === undefined) {
      issues.push({
        rule: "value-binding-missing",
        severity: "error",
        key,
        blockId,
        message: `Placeholder {{v:${key}}} has no entry in values`,
      });
      continue;
    }

    if (phase === "post-resolve" && entry.value === undefined) {
      issues.push({
        rule: "value-unresolved",
        severity: "error",
        key,
        blockId,
        message: `Value ${key} was not resolved by the resolver`,
      });
    }
  }

  for (const key of Object.keys(ir.values)) {
    if (!used.has(key)) {
      issues.push({
        rule: "value-unused",
        severity: "warning",
        key,
        message: `Value ${key} is declared but never referenced by a block`,
      });
    }
  }

  return issues;
}

function checkExplanations(ir: ReportIR): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const used = collectRefs(ir, EXPLANATION_REF_RE);

  for (const [id, blockId] of used) {
    if (!(id in ir.explanations)) {
      issues.push({
        rule: "explanation-missing",
        severity: "error",
        key: id,
        blockId,
        message: `Span data-x="${id}" has no entry in explanations`,
      });
    }
  }

  for (const id of Object.keys(ir.explanations)) {
    if (!used.has(id)) {
      issues.push({
        rule: "explanation-unused",
        severity: "error",
        key: id,
        message: `Explanation ${id} is never referenced by a data-x span`,
      });
    }
  }

  return issues;
}

function checkFiles(ir: ReportIR, files?: FileProbe): ValidationIssue[] {
  if (files === undefined) {
    return [];
  }

  const issues: ValidationIssue[] = [];

  for (const block of ir.blocks) {
    if (block.type === "image") {
      issues.push(...missingFileIssue(files, block.id, block.src));
    }

    if (block.type === "code-listing") {
      issues.push(...missingFileIssue(files, block.id, block.file));
      issues.push(...lineRangeIssue(files, block.id, block.file, block.lines));
    }
  }

  return issues;
}

function missingFileIssue(files: FileProbe, blockId: string, path: string): ValidationIssue[] {
  if (files.exists(path)) {
    return [];
  }

  return [
    {
      rule: "file-missing",
      severity: "error",
      blockId,
      message: `Block ${blockId} references ${path} which does not exist`,
    },
  ];
}

function lineRangeIssue(
  files: FileProbe,
  blockId: string,
  path: string,
  lines?: [number, number],
): ValidationIssue[] {
  if (lines === undefined || !files.exists(path)) {
    return [];
  }

  const [from, to] = lines;
  const total = files.countLines(path);

  if (from <= to && to <= total) {
    return [];
  }

  return [
    {
      rule: "lines-out-of-range",
      severity: "error",
      blockId,
      message: `Block ${blockId} lists lines ${from}-${to} of ${path}, which has ${total} lines`,
    },
  ];
}

function checkRawNumbers(ir: ReportIR): ValidationIssue[] {
  return ir.blocks.flatMap((block) =>
    inlineTextsOf(block).flatMap((text) => rawNumberIssues(block.id, text)),
  );
}

function rawNumberIssues(blockId: string, text: string): ValidationIssue[] {
  const stripped = text.replace(PLACEHOLDER_RE, " ").replace(TAG_RE, " ");
  const issues: ValidationIssue[] = [];

  for (const match of stripped.matchAll(new RegExp(NUMBER_RE.source, "g"))) {
    const afterEquals = match[1] !== undefined;
    const literal = match[2];

    if (literal === undefined || (isYearLike(literal) && !afterEquals)) {
      continue;
    }

    if (afterEquals || significantDigits(literal) >= 3) {
      issues.push({
        rule: "raw-number",
        severity: "warning",
        blockId,
        message: `Block ${blockId} contains the literal number ${literal}; computed results belong in {{v:key}}`,
      });
    }
  }

  return issues;
}

function isYearLike(literal: string): boolean {
  if (!/^\d{4}$/.test(literal)) {
    return false;
  }

  const year = Number(literal);
  return year >= 1900 && year <= 2099;
}

function significantDigits(literal: string): number {
  const mantissa = literal.split(/[eE]/)[0] ?? literal;
  const unsigned = mantissa.replace("-", "");
  const hasFraction = /[.,]/.test(unsigned);
  const digits = unsigned.replace(/[.,]/g, "").replace(/^0+/, "");

  if (digits === "") {
    return 0;
  }

  return hasFraction ? digits.length : digits.replace(/0+$/, "").length;
}
