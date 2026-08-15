import { describe, expect, test } from "bun:test";
import { StyleError } from "./errors";
import {
  cmToTwips,
  mmToTwips,
  paragraphOptionsOf,
  ptToHalfPoints,
  ptToTwips,
  runOptionsOf,
} from "./styles";

describe("unit conversion", () => {
  test("converts points to the half-points docx wants for font size", () => {
    expect(ptToHalfPoints(14)).toBe(28);
  });

  test("converts points to twips for spacing", () => {
    expect(ptToTwips(6)).toBe(120);
  });

  test("converts centimetres to twips for indentation", () => {
    expect(cmToTwips(1.25)).toBe(709);
  });

  test("rounds millimetres to the page dimensions Word itself uses for A4", () => {
    expect(mmToTwips(210)).toBe(11906);
    expect(mmToTwips(297)).toBe(16838);
    expect(mmToTwips(20)).toBe(1134);
  });
});

describe("runOptionsOf", () => {
  test("maps font and size", () => {
    expect(runOptionsOf({ font: "Times New Roman", size: 14 })).toMatchObject({
      font: "Times New Roman",
      size: 28,
    });
  });

  test("maps emphasis and caps", () => {
    expect(runOptionsOf({ bold: true, italic: true, caps: true })).toMatchObject({
      bold: true,
      italics: true,
      allCaps: true,
    });
  });

  test("omits what the style does not set", () => {
    expect(runOptionsOf({})).toEqual({});
  });
});

describe("paragraphOptionsOf", () => {
  test("maps alignment", () => {
    expect(paragraphOptionsOf({ align: "justify" })).toMatchObject({ alignment: "both" });
    expect(paragraphOptionsOf({ align: "center" })).toMatchObject({ alignment: "center" });
  });

  test("converts line height to twentieths of a point", () => {
    expect(paragraphOptionsOf({ lineHeight: 1.5 })).toMatchObject({
      spacing: { line: 360, lineRule: "auto" },
    });
  });

  test("converts the first line indent from centimetres", () => {
    expect(paragraphOptionsOf({ firstLineIndent: "1.25cm" })).toMatchObject({
      indent: { firstLine: 709 },
    });
  });

  test("keeps spacing before and after in twips", () => {
    expect(paragraphOptionsOf({ spaceBefore: 6, spaceAfter: 12 })).toMatchObject({
      spacing: { before: 120, after: 240 },
    });
  });

  test("rejects an indent unit it cannot convert", () => {
    expect(() => paragraphOptionsOf({ firstLineIndent: "3 parsecs" })).toThrow(StyleError);
  });
});
