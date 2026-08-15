import { describe, expect, test } from "bun:test";
import { RUNTIMES } from "@labforge/sandbox";
import { sessionOptions } from "./claude";
import { failureFrom, rateLimitFrom, textFrom } from "./messages";

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

describe("the options an agent session actually gets", () => {
  test("restricts the toolset instead of only auto-allowing it", () => {
    const options = sessionOptions({
      prompt: "p",
      systemPrompt: "s",
      allowedTools: ["Read", "Grep"],
      cwd: "/jobs/job_1",
    });

    expect(options.tools).toEqual(["Read", "Grep"]);
    expect(options.allowedTools).toEqual(["Read", "Grep"]);
  });

  test("loads no settings from the machine, so a user allow-rule cannot leak in", () => {
    const options = sessionOptions({
      prompt: "p",
      systemPrompt: "s",
      allowedTools: ["Read"],
      cwd: "/jobs/job_1",
    });

    expect(options.settingSources).toEqual([]);
  });

  test("never asks a human at the terminal", () => {
    const options = sessionOptions({
      prompt: "p",
      systemPrompt: "s",
      allowedTools: ["Read"],
      cwd: "/jobs/job_1",
    });

    expect(options.permissionMode).toBeDefined();
  });

  test("does not resume an empty session id", () => {
    const options = sessionOptions({
      prompt: "p",
      systemPrompt: "s",
      allowedTools: ["Read"],
      cwd: "/jobs/job_1",
      resume: "",
    });

    expect(options.resume).toBeUndefined();
  });

  test("resumes a real session id", () => {
    const options = sessionOptions({
      prompt: "p",
      systemPrompt: "s",
      allowedTools: ["Read"],
      cwd: "/jobs/job_1",
      resume: "abc",
    });

    expect(options.resume).toBe("abc");
  });
});

describe("how a session ended", () => {
  test("treats a successful result as success", () => {
    expect(failureFrom({ type: "result", subtype: "success", is_error: false })).toBeUndefined();
  });

  test("treats running out of turns as a failure, not a finished state", () => {
    expect(failureFrom({ type: "result", subtype: "error_max_turns" })).toContain("max_turns");
  });

  test("treats an errored result as a failure even when the subtype says success", () => {
    expect(failureFrom({ type: "result", subtype: "success", is_error: true })).toBeDefined();
  });

  test("reports the errors the sdk listed", () => {
    expect(
      failureFrom({ type: "result", subtype: "error_during_execution", errors: ["tool exploded"] }),
    ).toContain("tool exploded");
  });

  test("ignores messages that are not the result", () => {
    expect(failureFrom({ type: "assistant" })).toBeUndefined();
  });
});
