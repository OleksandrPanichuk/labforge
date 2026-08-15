import { describe, expect, test } from "bun:test";
import type { Block, ReportIR } from "./schema";
import { type FileProbe, validateReport } from "./validate";

function makeIR(overrides: Partial<ReportIR> = {}): ReportIR {
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
    blocks: [{ id: "blk_1", type: "paragraph", text: "Plain text" }],
    values: {},
    explanations: {},
    ...overrides,
  };
}

function paragraph(id: string, text: string): Block {
  return { id, type: "paragraph", text };
}

function rulesOf(issues: { rule: string }[]): string[] {
  return issues.map((issue) => issue.rule);
}

const probe: FileProbe = {
  exists: () => true,
  countLines: () => 100,
};

describe("value bindings", () => {
  test("reports a placeholder that has no entry in values", () => {
    const ir = makeIR({ blocks: [paragraph("blk_1", "error is {{v:err_max}}")] });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(rulesOf(result.errors)).toContain("value-binding-missing");
    expect(result.errors[0]?.key).toBe("err_max");
    expect(result.ok).toBe(false);
  });

  test("accepts a declared binding without a value before resolve", () => {
    const ir = makeIR({
      blocks: [paragraph("blk_1", "error is {{v:err_max}}")],
      values: { err_max: { cellRef: "cells/errors.py", format: "sci:2" } },
    });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("reports a value still unresolved after resolve", () => {
    const ir = makeIR({
      blocks: [paragraph("blk_1", "error is {{v:err_max}}")],
      values: { err_max: { cellRef: "cells/errors.py" } },
    });

    const result = validateReport(ir, { phase: "post-resolve" });

    expect(rulesOf(result.errors)).toContain("value-unresolved");
  });

  test("accepts a resolved value after resolve", () => {
    const ir = makeIR({
      blocks: [paragraph("blk_1", "error is {{v:err_max}}")],
      values: { err_max: { cellRef: "cells/errors.py", value: "3,20e-6" } },
    });

    const result = validateReport(ir, { phase: "post-resolve" });

    expect(result.errors).toEqual([]);
  });

  test("warns about a declared value that no block references", () => {
    const ir = makeIR({
      values: { orphan: { cellRef: "cells/errors.py", value: "1" } },
    });

    const result = validateReport(ir, { phase: "post-resolve" });

    expect(rulesOf(result.warnings)).toContain("value-unused");
    expect(result.ok).toBe(true);
  });

  test("finds placeholders inside table cells and list items", () => {
    const ir = makeIR({
      blocks: [
        {
          id: "blk_1",
          type: "table",
          header: ["x"],
          rows: [["{{v:x0}}"]],
        },
        { id: "blk_2", type: "list", ordered: false, items: ["{{v:x1}}"] },
      ],
    });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(result.errors.map((issue) => issue.key).sort()).toEqual(["x0", "x1"]);
  });
});

describe("explanations", () => {
  test("reports a data-x span with no explanation", () => {
    const ir = makeIR({
      blocks: [paragraph("blk_1", 'order is <span data-x="e1">O(h^5)</span>')],
    });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(rulesOf(result.errors)).toContain("explanation-missing");
  });

  test("reports an explanation that nothing references", () => {
    const ir = makeIR({
      explanations: {
        e1: { type: "text", html: "unused", sources: [{ title: "Book" }] },
      },
    });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(rulesOf(result.errors)).toContain("explanation-unused");
  });

  test("accepts a referenced explanation", () => {
    const ir = makeIR({
      blocks: [paragraph("blk_1", 'order is <span data-x="e1">O(h^5)</span>')],
      explanations: {
        e1: { type: "text", html: "from Taylor expansion", sources: [{ title: "Book" }] },
      },
    });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(result.errors).toEqual([]);
  });
});

describe("structure", () => {
  test("reports a block style missing from the styles map", () => {
    const ir = makeIR({
      blocks: [{ id: "blk_1", type: "paragraph", style: "caption", text: "text" }],
    });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(rulesOf(result.errors)).toContain("style-missing");
  });

  test("reports duplicate block ids", () => {
    const ir = makeIR({
      blocks: [paragraph("blk_1", "first"), paragraph("blk_1", "second")],
    });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(rulesOf(result.errors)).toContain("block-id-duplicate");
  });
});

describe("file references", () => {
  test("reports an image whose file is missing on disk", () => {
    const ir = makeIR({
      blocks: [
        {
          id: "blk_1",
          type: "image",
          src: "artifacts/plot.png",
          width: "80%",
          provenance: { kind: "generated", codeRef: "cells/plot.py" },
        },
      ],
    });

    const result = validateReport(ir, {
      phase: "pre-resolve",
      files: { exists: () => false, countLines: () => 0 },
    });

    expect(rulesOf(result.errors)).toContain("file-missing");
  });

  test("reports a code listing whose line range exceeds the file", () => {
    const ir = makeIR({
      blocks: [
        {
          id: "blk_1",
          type: "code-listing",
          language: "python",
          file: "src/solver.py",
          lines: [1, 500],
        },
      ],
    });

    const result = validateReport(ir, {
      phase: "pre-resolve",
      files: { exists: () => true, countLines: () => 40 },
    });

    expect(rulesOf(result.errors)).toContain("lines-out-of-range");
  });

  test("skips file checks when no probe is supplied", () => {
    const ir = makeIR({
      blocks: [
        {
          id: "blk_1",
          type: "image",
          src: "artifacts/plot.png",
          width: "80%",
          provenance: { kind: "generated", codeRef: "cells/plot.py" },
        },
      ],
    });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(result.errors).toEqual([]);
  });
});

describe("raw number heuristic", () => {
  test("warns about a computed-looking number written as text", () => {
    const ir = makeIR({ blocks: [paragraph("blk_1", "maximum error was 0.00432")] });

    const result = validateReport(ir, { phase: "pre-resolve", files: probe });

    expect(rulesOf(result.warnings)).toContain("raw-number");
    expect(result.ok).toBe(true);
  });

  test("warns about any number written right after an equals sign", () => {
    const ir = makeIR({ blocks: [paragraph("blk_1", "we took h = 42")] });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(rulesOf(result.warnings)).toContain("raw-number");
  });

  test("stays quiet for low-precision numbers", () => {
    const ir = makeIR({ blocks: [paragraph("blk_1", "the step was 0.1 and 100 points")] });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(result.warnings).toEqual([]);
  });

  test("stays quiet for years", () => {
    const ir = makeIR({ blocks: [paragraph("blk_1", "the method was published in 1990")] });

    const result = validateReport(ir, { phase: "pre-resolve" });

    expect(result.warnings).toEqual([]);
  });

  test("ignores numbers that come from placeholders", () => {
    const ir = makeIR({
      blocks: [paragraph("blk_1", "maximum error was {{v:err_max}}")],
      values: { err_max: { cellRef: "cells/errors.py", value: "0,00432" } },
    });

    const result = validateReport(ir, { phase: "post-resolve" });

    expect(result.warnings).toEqual([]);
  });
});

test("a clean document produces no issues", () => {
  const ir = makeIR({
    blocks: [
      { id: "blk_1", type: "heading", level: 1, text: "GOAL" },
      paragraph("blk_2", 'error <span data-x="e1">bound</span> is {{v:err_max}}'),
    ],
    values: { err_max: { cellRef: "cells/errors.py", value: "3,20e-6" } },
    explanations: {
      e1: { type: "text", html: "from Taylor expansion", sources: [{ title: "Book" }] },
    },
  });

  const result = validateReport(ir, { phase: "post-resolve", files: probe });

  expect(result.errors).toEqual([]);
  expect(result.warnings).toEqual([]);
  expect(result.ok).toBe(true);
});
