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
});
