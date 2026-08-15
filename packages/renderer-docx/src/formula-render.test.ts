import { describe, expect, test } from "bun:test";
import type { Block } from "@labforge/ir";
import { strFromU8, unzipSync } from "fflate";
import { FormulaError } from "./errors";
import { renderReport } from "./render";
import { makeIR } from "./testing";

async function documentXml(blocks: Block[]) {
  const buffer = await renderReport(makeIR({ blocks }));
  const entry = unzipSync(new Uint8Array(buffer))["word/document.xml"];

  return entry === undefined ? "" : strFromU8(entry);
}

function formula(id: string, latex: string, numbered = false): Block {
  return { id, type: "formula", latex, numbered };
}

describe("formulas", () => {
  test("embeds the formula as office math, not as an image", async () => {
    const xml = await documentXml([formula("blk_1", "\\frac{h}{6}")]);

    expect(xml).toContain("<m:oMath");
    expect(xml).toContain("<m:f>");
    expect(xml).not.toContain("<w:drawing>");
  });

  test("numbers the formulas that ask for it, in order", async () => {
    const xml = await documentXml([
      formula("blk_1", "a = b", true),
      formula("blk_2", "c = d", true),
    ]);

    expect(xml).toContain(">(1)</w:t>");
    expect(xml).toContain(">(2)</w:t>");
  });

  test("does not spend a number on an unnumbered formula", async () => {
    const xml = await documentXml([formula("blk_1", "a = b"), formula("blk_2", "c = d", true)]);

    expect(xml).toContain(">(1)</w:t>");
    expect(xml).not.toContain(">(2)</w:t>");
  });

  test("centres an unnumbered formula", async () => {
    const xml = await documentXml([formula("blk_1", "a = b")]);

    expect(xml).toContain('w:val="center"');
  });

  test("pins the number to the right margin", async () => {
    const xml = await documentXml([formula("blk_1", "a = b", true)]);

    expect(xml).toContain('w:val="right"');
    expect(xml).toContain('w:pos="10205"');
  });

  test("reports a typed error for text-mode markup the converter mangles", () => {
    expect(
      renderReport(makeIR({ blocks: [formula("blk_1", "\\text{a < b}")] })),
    ).rejects.toBeInstanceOf(FormulaError);
  });

  test("reports a typed error for latex trying to break out of the math element", () => {
    expect(
      renderReport(makeIR({ blocks: [formula("blk_1", "\\text{x</m:oMath>y}")] })),
    ).rejects.toBeInstanceOf(FormulaError);
  });

  test("never emits the keyless wrapper element around the math", async () => {
    const xml = await documentXml([formula("blk_1", "\\frac{h}{6}", true)]);

    expect(xml).not.toContain("<undefined>");
    expect(xml).toContain("<m:oMath");
  });

  test("refuses to place a number when the margins leave no text width", () => {
    const ir = makeIR({ blocks: [formula("blk_1", "a = b", true)] });
    ir.page.marginsMm = { top: 20, right: 150, bottom: 20, left: 150 };

    expect(renderReport(ir)).rejects.toThrow(/text width/i);
  });

  test("fails the build when a formula cannot be converted", () => {
    expect(renderReport(makeIR({ blocks: [formula("blk_1", "\\frac{")] }))).rejects.toBeInstanceOf(
      FormulaError,
    );
  });
});
