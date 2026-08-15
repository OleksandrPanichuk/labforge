import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReportIR } from "@labforge/ir";
import { strFromU8, unzipSync } from "fflate";
import { renderReport } from "./render";
import { makeIR } from "./testing";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const SOURCE = "def solve(x):\n    return x * 2\n\n\nprint(solve(2))\n";

let jobDir: string;

beforeAll(() => {
  jobDir = realpathSync(mkdtempSync(join(tmpdir(), "labforge-report-")));
  mkdirSync(join(jobDir, "artifacts"));
  mkdirSync(join(jobDir, "src"));
  writeFileSync(join(jobDir, "artifacts", "plot.png"), ONE_PIXEL_PNG);
  writeFileSync(join(jobDir, "src", "solver.py"), SOURCE, "utf8");
});

afterAll(() => {
  rmSync(jobDir, { recursive: true, force: true });
});

function fullReport(): ReportIR {
  return makeIR({
    styles: {
      default: { font: "Times New Roman", size: 14, lineHeight: 1.5 },
      heading1: { size: 14, bold: true, align: "center", caps: true },
      caption: { size: 12, align: "center" },
    },
    blocks: [
      { id: "blk_1", type: "heading", level: 1, style: "heading1", text: "МЕТА" },
      { id: "blk_2", type: "paragraph", text: "Крок дорівнює {{v:step}}." },
      { id: "blk_3", type: "formula", latex: "y_{n+1} = y_n + \\frac{h}{6}k_1", numbered: true },
      { id: "blk_4", type: "list", ordered: true, items: ["Крок 1", "Похибка {{v:err}}"] },
      {
        id: "blk_5",
        type: "table",
        caption: "Таблиця 1 — Результати",
        header: ["x", "похибка"],
        rows: [["0,1", "{{v:err}}"]],
        columnWidths: [0.3, 0.7],
      },
      {
        id: "blk_6",
        type: "image",
        src: "artifacts/plot.png",
        caption: "Рисунок 1 — Збіжність",
        width: "80%",
        provenance: { kind: "generated", codeRef: "cells/plot.py" },
      },
      { id: "blk_7", type: "pagebreak" },
      {
        id: "blk_8",
        type: "code-listing",
        language: "python",
        file: "src/solver.py",
        lines: [1, 2],
        caption: "Лістинг 1",
      },
    ],
    values: {
      step: { cellRef: "cells/m.py", value: "0,1" },
      err: { cellRef: "cells/m.py", value: "3,20e-6" },
    },
  });
}

test("every block type renders into one coherent document", async () => {
  const buffer = await renderReport(fullReport(), { jobDir });
  const parts = unzipSync(new Uint8Array(buffer));
  const xml = strFromU8(parts["word/document.xml"] ?? new Uint8Array());

  expect(xml).toContain("<w:tbl>");
  expect(xml).toContain("<m:oMath");
  expect(xml).toContain("<w:drawing>");
  expect(xml).toContain('w:type="page"');
  expect(xml).toContain("<w:numPr>");
  expect(xml).toContain("def solve(x):");

  expect(xml).toContain("0,1");
  expect(xml).toContain("3,20e-6");
  expect(xml).not.toContain("{{v:");
  expect(xml).not.toContain("<undefined>");

  expect(Object.keys(parts).some((name) => name.startsWith("word/media/"))).toBe(true);
});

test("the report renders the same way twice", async () => {
  const first = await renderReport(fullReport(), { jobDir });
  const second = await renderReport(fullReport(), { jobDir });
  const documentOf = (buffer: Buffer) =>
    strFromU8(unzipSync(new Uint8Array(buffer))["word/document.xml"] ?? new Uint8Array());

  expect(documentOf(first)).toBe(documentOf(second));
});
