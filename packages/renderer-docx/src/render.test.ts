import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { UnresolvedValueError } from "./errors";
import { type DocumentPart, renderReport } from "./render";
import { makeIR } from "./testing";

async function partOf(ir: Parameters<typeof renderReport>[0], part: DocumentPart = "document") {
  const buffer = await renderReport(ir);
  const files = unzipSync(new Uint8Array(buffer));
  const entry = files[`word/${part}.xml`];

  return entry === undefined ? "" : strFromU8(entry);
}

describe("page setup", () => {
  test("uses A4 in twips", async () => {
    const xml = await partOf(makeIR());

    expect(xml).toContain('w:w="11906"');
    expect(xml).toContain('w:h="16838"');
  });

  test("takes the margins from the document", async () => {
    const xml = await partOf(makeIR());

    expect(xml).toContain('w:top="1134"');
    expect(xml).toContain('w:right="567"');
    expect(xml).toContain('w:left="1134"');
  });

  test("numbers the pages when the document asks for it", async () => {
    const xml = await partOf(makeIR(), "footer1");

    expect(xml).toContain("PAGE");
  });

  test("omits the footer when page numbers are off", async () => {
    const ir = makeIR();
    ir.page.pageNumbers = false;

    expect(await partOf(ir, "footer1")).toBe("");
  });
});

describe("paragraphs and headings", () => {
  test("writes paragraph text", async () => {
    const xml = await partOf(
      makeIR({ blocks: [{ id: "blk_1", type: "paragraph", text: "Hello" }] }),
    );

    expect(xml).toContain(">Hello</w:t>");
  });

  test("splits formatting into separate runs", async () => {
    const ir = makeIR({
      blocks: [{ id: "blk_1", type: "paragraph", text: "plain <b>bold</b>" }],
    });

    const xml = await partOf(ir);

    expect(xml).toContain(">plain </w:t>");
    expect(xml).toMatch(/<w:b\b/);
    expect(xml).toContain(">bold</w:t>");
  });

  test("substitutes resolved values", async () => {
    const ir = makeIR({
      blocks: [{ id: "blk_1", type: "paragraph", text: "error {{v:err_max}}" }],
      values: { err_max: { cellRef: "cells/errors.py", value: "3,20e-6" } },
    });

    const xml = await partOf(ir);

    expect(xml).toContain("3,20e-6");
  });

  test("refuses to render an unresolved value", () => {
    const ir = makeIR({
      blocks: [{ id: "blk_1", type: "paragraph", text: "error {{v:err_max}}" }],
      values: { err_max: { cellRef: "cells/errors.py" } },
    });

    expect(renderReport(ir)).rejects.toBeInstanceOf(UnresolvedValueError);
  });

  test("applies a named style to the paragraph", async () => {
    const ir = makeIR({
      styles: { default: { size: 14 }, caption: { size: 12, align: "center" } },
      blocks: [{ id: "blk_1", type: "paragraph", style: "caption", text: "Table 1" }],
    });

    const xml = await partOf(ir);

    expect(xml).toContain('w:val="lf-caption"');
  });

  test("gives headings an outline level so Word can navigate them", async () => {
    const ir = makeIR({
      blocks: [{ id: "blk_1", type: "heading", level: 1, text: "GOAL" }],
    });

    const xml = await partOf(ir);

    expect(xml).toContain(">GOAL</w:t>");
    expect(xml).toContain('w:outlineLvl w:val="0"');
  });
});

describe("styles part", () => {
  test("registers every named style from the document", async () => {
    const ir = makeIR({
      styles: { default: { size: 14 }, heading1: { size: 14, bold: true, caps: true } },
    });

    const xml = await partOf(ir, "styles");

    expect(xml).toContain('w:styleId="lf-heading1"');
  });

  test("puts the default style in the document defaults", async () => {
    const xml = await partOf(makeIR(), "styles");

    expect(xml).toContain("<w:docDefaults>");
    expect(xml).toContain('w:ascii="Times New Roman"');
    expect(xml).toContain('w:val="28"');
  });
});

test("the rendered document.xml stays stable", async () => {
  const ir = makeIR({
    styles: { default: { font: "Times New Roman", size: 14, lineHeight: 1.5 } },
    blocks: [
      { id: "blk_1", type: "heading", level: 1, text: "GOAL" },
      { id: "blk_2", type: "paragraph", text: "error is <b>{{v:err_max}}</b>" },
    ],
    values: { err_max: { cellRef: "cells/errors.py", value: "3,20e-6" } },
  });

  expect(await partOf(ir)).toMatchSnapshot();
});

describe("output the document cannot silently corrupt", () => {
  test("refuses a placeholder whose key the substitution cannot match", () => {
    const ir = makeIR({
      blocks: [{ id: "blk_1", type: "paragraph", text: "sigma is {{v:sigma.max}}" }],
    });

    expect(renderReport(ir)).rejects.toThrow(/\{\{v:|placeholder/i);
  });

  test("refuses a half-written placeholder rather than printing it", () => {
    const ir = makeIR({ blocks: [{ id: "blk_1", type: "paragraph", text: "x = {{v:a} y" }] });

    expect(renderReport(ir)).rejects.toThrow(/placeholder/i);
  });

  test("does not emit two styles with the same id when a style is named like a built-in", async () => {
    const ir = makeIR({
      styles: { default: { size: 14 }, Heading1: { bold: true } },
      blocks: [{ id: "blk_1", type: "heading", level: 1, style: "Heading1", text: "GOAL" }],
    });

    const xml = await partOf(ir, "styles");
    const ids = [...xml.matchAll(/w:styleId="([^"]+)"/g)].map((match) => match[1]);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("still applies a style named like a built-in to its block", async () => {
    const ir = makeIR({
      styles: { default: { size: 14 }, Heading1: { bold: true } },
      blocks: [{ id: "blk_1", type: "heading", level: 1, style: "Heading1", text: "GOAL" }],
    });

    const xml = await partOf(ir);

    expect(xml).toMatch(/<w:pStyle w:val="[^"]+"/);
  });
});
