import { describe, expect, test } from "bun:test";
import type { Block } from "@labforge/ir";
import { strFromU8, unzipSync } from "fflate";
import { renderReport } from "./render";
import { makeIR } from "./testing";

async function partXml(
  blocks: Block[],
  overrides: Parameters<typeof makeIR>[0] = {},
  part = "document",
) {
  const buffer = await renderReport(makeIR({ blocks, ...overrides }));
  const entry = unzipSync(new Uint8Array(buffer))[`word/${part}.xml`];

  return entry === undefined ? "" : strFromU8(entry);
}

function documentXml(blocks: Block[], overrides: Parameters<typeof makeIR>[0] = {}) {
  return partXml(blocks, overrides);
}

function numIdOf(xml: string): string | undefined {
  return /<w:numId w:val="(\d+)"/.exec(xml)?.[1];
}

function numberingFormatOf(numbering: string, numId: string | undefined): string | undefined {
  const abstractId = new RegExp(
    `<w:num w:numId="${numId}"[^>]*>\\s*<w:abstractNumId w:val="(\\d+)"`,
  ).exec(numbering)?.[1];

  return new RegExp(
    `<w:abstractNum w:abstractNumId="${abstractId}"[\\s\\S]*?<w:numFmt w:val="([a-zA-Z]+)"`,
  ).exec(numbering)?.[1];
}

describe("lists", () => {
  test("renders an unordered list as bulleted paragraphs", async () => {
    const xml = await documentXml([
      { id: "blk_1", type: "list", ordered: false, items: ["first", "second"] },
    ]);

    expect(xml).toContain(">first</w:t>");
    expect(xml).toContain(">second</w:t>");
    expect(xml).toContain("<w:numPr>");
  });

  test("points an ordered list at a decimal numbering definition", async () => {
    const blocks: Block[] = [{ id: "blk_1", type: "list", ordered: true, items: ["first"] }];
    const numbering = await partXml(blocks, {}, "numbering");

    expect(numberingFormatOf(numbering, numIdOf(await documentXml(blocks)))).toBe("decimal");
  });

  test("points an unordered list at a bullet numbering definition", async () => {
    const blocks: Block[] = [{ id: "blk_1", type: "list", ordered: false, items: ["first"] }];
    const numbering = await partXml(blocks, {}, "numbering");

    expect(numberingFormatOf(numbering, numIdOf(await documentXml(blocks)))).toBe("bullet");
  });

  test("keeps inline formatting inside an item", async () => {
    const xml = await documentXml([
      { id: "blk_1", type: "list", ordered: false, items: ["plain <b>bold</b>"] },
    ]);

    expect(xml).toContain(">bold</w:t>");
    expect(xml).toMatch(/<w:b\b/);
  });

  test("substitutes values inside an item", async () => {
    const xml = await documentXml(
      [{ id: "blk_1", type: "list", ordered: false, items: ["error {{v:err_max}}"] }],
      { values: { err_max: { cellRef: "cells/errors.py", value: "3,20e-6" } } },
    );

    expect(xml).toContain("3,20e-6");
  });
});

describe("tables", () => {
  const table: Block = {
    id: "blk_1",
    type: "table",
    caption: "Таблиця 1 — Результати",
    header: ["x", "y"],
    rows: [
      ["0,1", "0,2"],
      ["0,3", "0,4"],
    ],
  };

  test("renders a table with header and body cells", async () => {
    const xml = await documentXml([table]);

    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain(">x</w:t>");
    expect(xml).toContain(">0,4</w:t>");
  });

  test("repeats the header row across pages", async () => {
    const xml = await documentXml([table]);

    expect(xml).toContain("<w:tblHeader");
  });

  test("puts the caption above the table, as the standard requires", async () => {
    const xml = await documentXml([table]);

    const captionAt = xml.indexOf("Результати");
    const tableAt = xml.indexOf("<w:tbl>");

    expect(captionAt).toBeGreaterThan(-1);
    expect(captionAt).toBeLessThan(tableAt);
  });

  test("uses the caption style when the document defines one", async () => {
    const xml = await documentXml([table], {
      styles: { default: { size: 14 }, caption: { size: 12, align: "center" } },
    });

    expect(xml).toContain('w:val="caption"');
  });

  test("leaves cells unshaded", async () => {
    const xml = await documentXml([table]);

    expect(xml).not.toContain("<w:shd");
  });

  test("draws borders so the table reads as a table", async () => {
    const xml = await documentXml([table]);

    expect(xml).toContain("<w:tblBorders>");
  });

  test("spreads the table across the full text width", async () => {
    const xml = await documentXml([table]);

    expect(xml).toMatch(/<w:tblW[^>]*w:w="100%"|<w:tblW[^>]*w:type="pct"/);
  });

  test("applies declared column widths as percentages", async () => {
    const xml = await documentXml([{ ...table, columnWidths: [0.25, 0.75] }]);

    expect(xml).toMatch(/w:type="pct"/);
  });

  test("substitutes values inside cells", async () => {
    const xml = await documentXml([{ ...table, rows: [["{{v:err_max}}", "b"]] }], {
      values: { err_max: { cellRef: "cells/errors.py", value: "3,20e-6" } },
    });

    expect(xml).toContain("3,20e-6");
  });
});

describe("documents with several blocks of the same kind", () => {
  test("restarts numbering for a second ordered list", async () => {
    const blocks: Block[] = [
      { id: "blk_1", type: "list", ordered: true, items: ["a", "b"] },
      { id: "blk_2", type: "paragraph", text: "between" },
      { id: "blk_3", type: "list", ordered: true, items: ["c", "d"] },
    ];

    const xml = await documentXml(blocks);
    const numIds = [...xml.matchAll(/<w:numId w:val="(\d+)"/g)].map((match) => match[1]);

    expect(new Set(numIds).size).toBe(2);
  });

  test("keeps two adjacent tables apart so Word does not merge them", async () => {
    const rows: Block = {
      id: "blk_1",
      type: "table",
      header: ["x"],
      rows: [["1"]],
    };

    const xml = await documentXml([rows, { ...rows, id: "blk_2" }]);

    expect(xml).not.toContain("</w:tbl><w:tbl>");
  });

  test("does not end the document body with a bare table", async () => {
    const xml = await documentXml([{ id: "blk_1", type: "table", header: ["x"], rows: [["1"]] }]);

    expect(xml).not.toMatch(/<\/w:tbl><w:sectPr/);
  });

  test("pads a row that has fewer cells than the header", async () => {
    const xml = await documentXml([
      { id: "blk_1", type: "table", header: ["x", "y"], rows: [["only"]] },
    ]);

    const cells = [...xml.matchAll(/<w:tc>/g)].length;

    expect(cells).toBe(4);
  });

  test("drops cells a row has beyond the header width", async () => {
    const xml = await documentXml([
      { id: "blk_1", type: "table", header: ["x"], rows: [["a", "b", "c"]] },
    ]);

    expect([...xml.matchAll(/<w:tc>/g)].length).toBe(2);
  });
});
