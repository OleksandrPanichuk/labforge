import { describe, expect, test } from "bun:test";
import { RenderError } from "./errors";
import { readPngSize } from "./png";
import { fakePng } from "./testing";

describe("readPngSize", () => {
  test("reads the dimensions from the IHDR chunk", () => {
    expect(readPngSize(fakePng(1200, 800))).toEqual({ width: 1200, height: 800 });
  });

  test("rejects data that is not a PNG", () => {
    expect(() => readPngSize(Buffer.from("GIF89a not a png"))).toThrow(RenderError);
  });

  test("rejects a truncated file", () => {
    expect(() => readPngSize(fakePng(10, 10).subarray(0, 12))).toThrow(RenderError);
  });

  test("rejects a zero dimension that would make the layout degenerate", () => {
    expect(() => readPngSize(fakePng(0, 100))).toThrow(RenderError);
    expect(() => readPngSize(fakePng(100, 0))).toThrow(RenderError);
  });

  test("rejects dimensions no real report image would have", () => {
    expect(() => readPngSize(fakePng(1_000_000, 10))).toThrow(RenderError);
  });

  test("rejects a header whose first chunk is not IHDR", () => {
    const data = fakePng(10, 10);
    data.write("IDAT", 12, "ascii");

    expect(() => readPngSize(data)).toThrow(RenderError);
  });
});
