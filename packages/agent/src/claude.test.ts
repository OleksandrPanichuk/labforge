import { describe, expect, test } from "bun:test";
import { RUNTIMES } from "@labforge/sandbox";
import { rateLimitFrom, textFrom } from "./messages";

describe("reading the stream the sdk produces", () => {
  test("collects the assistant's text", () => {
    const message = {
      type: "assistant",
      message: { content: [{ type: "text", text: "hello" }, { type: "tool_use" }] },
    };

    expect(textFrom(message)).toBe("hello");
  });

  test("ignores everything that is not the assistant speaking", () => {
    expect(textFrom({ type: "system", subtype: "init" })).toBe("");
    expect(textFrom({ type: "result" })).toBe("");
  });

  test("treats a rejected rate limit as a pause and converts the reset time", () => {
    const limit = rateLimitFrom({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: 1786824000 },
    });

    expect(limit?.resetsAt).toBe(new Date(1786824000 * 1000).toISOString());
  });

  test("does not pause on a rate limit that still allows work", () => {
    expect(
      rateLimitFrom({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed", resetsAt: 1786824000 },
      }),
    ).toBeUndefined();
  });

  test("survives a rejection with no reset time", () => {
    const limit = rateLimitFrom({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected" },
    });

    expect(limit).toBeDefined();
    expect(limit?.resetsAt).toBeUndefined();
  });
});

describe("what the sandbox tool will run", () => {
  test("uses the runtime's command for the lab's language", () => {
    expect(RUNTIMES.python.cellCommand("cells/x.py")).toEqual(["python", "cells/x.py"]);
  });

  test("refuses a path that is not a cell", () => {
    expect(() => RUNTIMES.python.cellCommand("../../etc/passwd")).toThrow();
    expect(() => RUNTIMES.python.cellCommand("cells/x.py; rm -rf /")).toThrow();
  });
});
