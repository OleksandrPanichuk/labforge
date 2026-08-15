import { describe, expect, test } from "bun:test";
import { formatValue } from "./format";

describe("formatValue", () => {
  test("renders scientific notation with the requested precision", () => {
    expect(formatValue(0.0000032, "sci:2", ",")).toBe("3,20e-6");
  });

  test("renders fixed precision", () => {
    expect(formatValue(1.23456, "fixed:3", ",")).toBe("1,235");
  });

  test("rounds to an integer", () => {
    expect(formatValue(3.7, "int", ",")).toBe("4");
  });

  test("uses the decimal separator for unformatted numbers", () => {
    expect(formatValue(0.25, undefined, ",")).toBe("0,25");
  });

  test("keeps a dot separator when asked", () => {
    expect(formatValue(0.25, undefined, ".")).toBe("0.25");
  });

  test("passes strings through untouched", () => {
    expect(formatValue("converged", "sci:2", ",")).toBe("converged");
  });

  test("rejects an unknown format", () => {
    expect(() => formatValue(1, "banana", ",")).toThrow(/unknown format/i);
  });
});
