import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@labforge/configs";
import type { JobState } from "@labforge/jobs";

export interface AgentPrompt {
  name: string;
  allowedTools: string[];
  body: string;
}

const AGENTS: Partial<Record<JobState, string>> = {
  CONTEXT: "scout-solver",
  SOLVE: "scout-solver",
  CODE_REVIEW: "reviewer-fixer",
  FIX: "reviewer-fixer",
  IR_WRITE: "report-writer",
  IR_FIX: "report-writer",
  REPORT_REVIEW: "report-reviewer",
  DEFENSE_PREP: "defense-prep",
  REVISION: "revision",
};

const NAME_RE = /^[a-z][a-z0-9-]*$/;

export function agentForState(state: JobState): string | undefined {
  return AGENTS[state];
}

export function loadPrompt(agentsDir: string, name: string): AgentPrompt {
  if (!NAME_RE.test(name)) {
    throw new Error(`"${name}" is not a usable agent name`);
  }

  let source: string;

  try {
    source = readFileSync(join(agentsDir, `${name}.md`), "utf8");
  } catch {
    throw new Error(`No prompt for agent "${name}" in ${agentsDir}`);
  }

  const { data, body } = parseFrontmatter(source);
  const allowedTools = toolsOf(data.allowedTools);

  if (allowedTools.length === 0) {
    throw new Error(`Agent "${name}" declares no allowedTools; refusing to run it unrestricted`);
  }

  return { name, allowedTools, body: body.trim() };
}

export function fill(body: string, values: Record<string, string>): string {
  return body.replace(
    /\{\{([\w-]+)\}\}/g,
    (placeholder, key: string) => values[key] ?? placeholder,
  );
}

function toolsOf(declared: string | string[] | undefined): string[] {
  if (declared === undefined) {
    return [];
  }

  const list = Array.isArray(declared) ? declared : declared.split(",");

  return list.map((tool) => tool.trim()).filter((tool) => tool !== "");
}
