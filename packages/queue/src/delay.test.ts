import { describe, expect, test } from "bun:test";
import { delayUntil, MAX_DELAY_MS } from "./delay";

const now = new Date("2026-08-16T10:00:00.000Z");

describe("delayUntil", () => {
  test("waits until the limit resets", () => {
    expect(delayUntil("2026-08-16T10:30:00.000Z", now)).toBe(30 * 60 * 1000);
  });

  test("comes back at once when the reset has already passed", () => {
    expect(delayUntil("2026-08-16T09:00:00.000Z", now)).toBe(0);
  });

  test("comes back at once when nobody said when", () => {
    expect(delayUntil(undefined, now)).toBe(0);
  });

  test("does not park a lab for a week because of a bad timestamp", () => {
    expect(delayUntil("2027-01-01T00:00:00.000Z", now)).toBe(MAX_DELAY_MS);
  });

  test("treats an unparsable reset as no reset", () => {
    expect(delayUntil("tomorrow, probably", now)).toBe(0);
  });
});
