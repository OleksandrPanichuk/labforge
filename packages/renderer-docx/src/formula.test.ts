import { describe, expect, test } from "bun:test";
import { FormulaError } from "./errors";
import { latexToOmml } from "./formula";

describe("latexToOmml", () => {
  test("produces an office math element", () => {
    expect(latexToOmml("x + y")).toContain("<m:oMath");
  });

  test("converts a fraction into the office math fraction element", () => {
    expect(latexToOmml("\\frac{h}{6}")).toContain("<m:f>");
  });

  test("converts a subscript", () => {
    expect(latexToOmml("y_{n+1}")).toContain("<m:sSub>");
  });

  test("names the offending formula when the latex does not parse", () => {
    expect(() => latexToOmml("\\frac{")).toThrow(FormulaError);
    expect(() => latexToOmml("\\frac{")).toThrow(/\\frac\{/);
  });

  test("rejects an unknown command instead of emitting a broken formula", () => {
    expect(() => latexToOmml("\\notacommand{x}")).toThrow(FormulaError);
  });
});
