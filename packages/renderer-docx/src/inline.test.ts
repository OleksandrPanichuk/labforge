import { describe, expect, test } from "bun:test";
import type { ValueEntry } from "@labforge/ir";
import { UnresolvedValueError } from "./errors";
import { parseInline } from "./inline";

const values: Record<string, ValueEntry> = {
  err_max: { cellRef: "cells/errors.py", value: "3,20e-6" },
  pending: { cellRef: "cells/errors.py" },
};

describe("parseInline", () => {
  test("returns plain text as a single run", () => {
    expect(parseInline("simple text", values)).toEqual([{ text: "simple text" }]);
  });

  test("marks a bold segment", () => {
    expect(parseInline("a <b>bold</b> c", values)).toEqual([
      { text: "a " },
      { text: "bold", bold: true },
      { text: " c" },
    ]);
  });

  test("keeps nested formatting on the inner run", () => {
    expect(parseInline("<b>x <i>y</i></b>", values)).toEqual([
      { text: "x ", bold: true },
      { text: "y", bold: true, italic: true },
    ]);
  });

  test("supports underline, subscript and superscript", () => {
    expect(parseInline("<u>u</u><sub>s</sub><sup>p</sup>", values)).toEqual([
      { text: "u", underline: true },
      { text: "s", subscript: true },
      { text: "p", superscript: true },
    ]);
  });

  test("records the explanation id of a data-x span", () => {
    expect(parseInline('see <span data-x="e1">this</span>', values)).toEqual([
      { text: "see " },
      { text: "this", explanationId: "e1" },
    ]);
  });

  test("substitutes a resolved value", () => {
    expect(parseInline("error is {{v:err_max}}", values)).toEqual([{ text: "error is 3,20e-6" }]);
  });

  test("keeps surrounding formatting on a substituted value", () => {
    expect(parseInline("<b>{{v:err_max}}</b>", values)).toEqual([{ text: "3,20e-6", bold: true }]);
  });

  test("refuses to render a value the resolver never filled", () => {
    expect(() => parseInline("{{v:pending}}", values)).toThrow(UnresolvedValueError);
  });

  test("refuses to render a value with no binding at all", () => {
    expect(() => parseInline("{{v:ghost}}", values)).toThrow(UnresolvedValueError);
  });

  test("decodes the entities the writer may emit", () => {
    expect(parseInline("a &lt; b &amp; c &gt; d", values)).toEqual([{ text: "a < b & c > d" }]);
  });

  test("rejects a tag outside the allowlist", () => {
    expect(() => parseInline("<script>x</script>", values)).toThrow(/not allowed/i);
  });

  test("rejects a closing tag that does not match the open one", () => {
    expect(() => parseInline("<b>x</i>", values)).toThrow(/mismatched/i);
  });

  test("drops empty runs between adjacent tags", () => {
    expect(parseInline("<b>a</b><i>b</i>", values)).toEqual([
      { text: "a", bold: true },
      { text: "b", italic: true },
    ]);
  });
});
