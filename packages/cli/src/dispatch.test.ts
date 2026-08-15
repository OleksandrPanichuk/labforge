import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobStore, type Job } from "@labforge/jobs";
import type { AgentOutcome, AgentRequest, AgentRunner } from "@labforge/orchestrator";
import { RUNTIMES } from "@labforge/sandbox";
import { createDispatcher } from "./dispatch";

let root: string;
let job: Job;
let configsDir: string;

const completed: AgentOutcome = { status: "completed", sessionId: "s1" };

function agent(): AgentRunner & { visited: string[] } {
  const visited: string[] = [];

  return {
    visited,
    run(request: AgentRequest) {
      visited.push(request.state);

      return Promise.resolve(completed);
    },
  };
}

function dispatcher(agents: AgentRunner) {
  return createDispatcher({
    agent: agents,
    configsDir,
    taskPath: join(root, "task.md"),
    subject: "numeric-methods",
    teacher: "ivanenko",
    runtime: RUNTIMES.python,
    cells: {
      run: () =>
        Promise.resolve({ exitCode: 0, stdout: '{"err_max": 1}', stderr: "", durationMs: 1 }),
    },
  });
}

function ask(state: Parameters<AgentRunner["run"]>[0]["state"]) {
  const checkpoint = job.readCheckpoint();

  if (checkpoint === undefined) {
    throw new Error("no checkpoint");
  }

  return { state, job, checkpoint };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-cli-")));
  job = createJobStore(join(root, "jobs")).createJob("job_1");
  configsDir = join(root, "configs");

  mkdirSync(join(configsDir, "teachers", "ivanenko"), { recursive: true });
  writeFileSync(join(configsDir, "REQUIREMENTS.md"), "base requirements");
  writeFileSync(join(configsDir, "STYLE_GUIDE.md"), "base styles");
  writeFileSync(join(configsDir, "teachers", "ivanenko", "REQUIREMENTS.md"), "teacher rules");
  writeFileSync(join(root, "task.md"), "# Лабораторна 1\n\nЗавдання.");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ingest", () => {
  test("puts the task where the agents look for it", async () => {
    await dispatcher(agent()).run(ask("INGEST"));

    expect(readFileSync(join(job.dir, "task.md"), "utf8")).toContain("Завдання");
  });

  test("resolves the configuration into the job's own context", async () => {
    await dispatcher(agent()).run(ask("INGEST"));

    const requirements = readFileSync(join(job.dir, "context", "requirements.md"), "utf8");

    expect(requirements).toContain("base requirements");
    expect(requirements).toContain("teacher rules");
    expect(existsSync(join(job.dir, "context", "style_guide.md"))).toBe(true);
  });

  test("records which configuration layers were used", async () => {
    await dispatcher(agent()).run(ask("INGEST"));

    const sources = JSON.parse(readFileSync(join(job.dir, "context", "sources.json"), "utf8"));

    expect(sources.requirements).toContain("teachers/ivanenko/REQUIREMENTS.md");
  });

  test("converts a task that is not already markdown", async () => {
    writeFileSync(join(root, "task.md"), "plain text task");

    const outcome = await dispatcher(agent()).run(ask("INGEST"));

    expect(outcome.status).toBe("completed");
  });

  test("fails when the task file is missing", async () => {
    rmSync(join(root, "task.md"));

    const outcome = await dispatcher(agent()).run(ask("INGEST"));

    expect(outcome.status).toBe("failed");
  });

  test("does not call an agent", async () => {
    const agents = agent();

    await dispatcher(agents).run(ask("INGEST"));

    expect(agents.visited).toEqual([]);
  });
});

describe("deterministic states", () => {
  const document = {
    version: 1,
    meta: {
      labId: "lab_1",
      subject: "nm",
      title: "Lab",
      student: { name: "S", group: "G" },
      language: "uk",
    },
    page: {
      size: "A4",
      marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
      pageNumbers: true,
    },
    styles: { default: { size: 14 } },
    blocks: [{ id: "blk_1", type: "paragraph", text: "error {{v:err_max}}" }],
    values: { err_max: { cellRef: "cells/errors.py" } },
    explanations: {},
  };

  test("resolves the report without asking an agent", async () => {
    const agents = agent();
    writeFileSync(job.reportPath, JSON.stringify(document));

    const outcome = await dispatcher(agents).run(ask("RESOLVE"));

    expect(outcome.status).toBe("completed");
    expect(agents.visited).toEqual([]);
    expect(existsSync(join(job.dir, "report.docx"))).toBe(true);
  });

  test("reports a failed cell as a finding the fixer can act on", async () => {
    writeFileSync(job.reportPath, JSON.stringify(document));
    const failing = createDispatcher({
      agent: agent(),
      configsDir,
      taskPath: join(root, "task.md"),
      subject: "nm",
      runtime: RUNTIMES.python,
      cells: {
        run: () =>
          Promise.resolve({ exitCode: 1, stdout: "", stderr: "Traceback: boom", durationMs: 1 }),
      },
    });

    const outcome = await failing.run(ask("RESOLVE"));

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("boom");
  });

  test("builds the document again after a human review", async () => {
    writeFileSync(job.reportPath, JSON.stringify(document));

    const outcome = await dispatcher(agent()).run(ask("BUILD"));

    expect(outcome.status).toBe("completed");
  });
});

describe("agent states", () => {
  test("hands everything else to the agent", async () => {
    const agents = agent();

    await dispatcher(agents).run(ask("SOLVE"));
    await dispatcher(agents).run(ask("CODE_REVIEW"));

    expect(agents.visited).toEqual(["SOLVE", "CODE_REVIEW"]);
  });
});
