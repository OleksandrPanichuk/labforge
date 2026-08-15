import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { agentForState, fill, loadPrompt } from "./prompts";

function agentsDir(): string {
  let dir = process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, "agents", "scout-solver.md"))) {
      return join(dir, "agents");
    }

    dir = dirname(dir);
  }

  throw new Error("agents directory not found");
}

const AGENTS_DIR = agentsDir();

describe("agentForState", () => {
  test("routes each working state to the subagent that owns it", () => {
    expect(agentForState("CONTEXT")).toBe("scout-solver");
    expect(agentForState("SOLVE")).toBe("scout-solver");
    expect(agentForState("CODE_REVIEW")).toBe("reviewer-fixer");
    expect(agentForState("FIX")).toBe("reviewer-fixer");
    expect(agentForState("IR_WRITE")).toBe("report-writer");
    expect(agentForState("IR_FIX")).toBe("report-writer");
    expect(agentForState("REPORT_REVIEW")).toBe("report-reviewer");
    expect(agentForState("DEFENSE_PREP")).toBe("defense-prep");
    expect(agentForState("REVISION")).toBe("revision");
  });

  test("has no agent for the states that are not agent work", () => {
    expect(agentForState("RESOLVE")).toBeUndefined();
    expect(agentForState("BUILD")).toBeUndefined();
    expect(agentForState("INGEST")).toBeUndefined();
    expect(agentForState("HUMAN_REVIEW")).toBeUndefined();
    expect(agentForState("DONE")).toBeUndefined();
  });
});

describe("loadPrompt", () => {
  test("reads a real prompt from the agents directory", () => {
    const prompt = loadPrompt(AGENTS_DIR, "scout-solver");

    expect(prompt.name).toBe("scout-solver");
    expect(prompt.body).toContain("{{jobDir}}");
  });

  test("keeps the frontmatter out of the prompt body", () => {
    const prompt = loadPrompt(AGENTS_DIR, "scout-solver");

    expect(prompt.body).not.toContain("allowedTools:");
  });

  test("reads the tool allowance as a list", () => {
    const prompt = loadPrompt(AGENTS_DIR, "scout-solver");

    expect(prompt.allowedTools).toContain("Read");
    expect(prompt.allowedTools).toContain("mcp__labforge__run_in_sandbox");
    expect(prompt.allowedTools).not.toContain("Read, Write");
  });

  test("gives the reviewer no way to write to the lab", () => {
    const prompt = loadPrompt(AGENTS_DIR, "report-reviewer");

    expect(prompt.allowedTools).not.toContain("Write");
  });

  test("refuses a prompt that does not exist", () => {
    expect(() => loadPrompt(AGENTS_DIR, "nobody")).toThrow(/nobody/);
  });

  test("refuses a prompt with no tool allowance rather than granting everything", () => {
    expect(() => loadPrompt(AGENTS_DIR, "..")).toThrow();
  });
});

describe("fill", () => {
  test("substitutes the values the orchestrator knows", () => {
    expect(fill("dir is {{jobDir}}", { jobDir: "/jobs/job_1" })).toBe("dir is /jobs/job_1");
  });

  test("refuses to send a prompt with a placeholder nobody filled", () => {
    expect(() => fill("{{unknown}}", {})).toThrow(/unknown/);
  });

  test("substitutes every occurrence", () => {
    expect(fill("{{a}} and {{a}}", { a: "x" })).toBe("x and x");
  });
});
