import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobStore, type Job } from "@labforge/jobs";
import type { AgentOutcome } from "./decide";
import { type AgentRunner, runJob } from "./run";

let root: string;
let job: Job;

const completed: AgentOutcome = { status: "completed", sessionId: "s1" };

function agents(script: Partial<Record<string, AgentOutcome[]>> = {}): AgentRunner & {
  visited: string[];
} {
  const visited: string[] = [];
  const queues = new Map(Object.entries(script).map(([state, list]) => [state, [...(list ?? [])]]));

  return {
    visited,
    run(request) {
      visited.push(request.state);

      return Promise.resolve(queues.get(request.state)?.shift() ?? completed);
    },
  };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-run-")));
  job = createJobStore(root).createJob("job_1");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runJob", () => {
  test("drives a clean job all the way to done", async () => {
    const runner = agents();

    const result = await runJob({ job, agents: runner });

    expect(result.state).toBe("DONE");
    expect(job.readCheckpoint()?.state).toBe("DONE");
  });

  test("visits every state of the flow in order", async () => {
    const runner = agents();

    await runJob({ job, agents: runner });

    expect(runner.visited).toEqual([
      "INGEST",
      "CONTEXT",
      "SOLVE",
      "CODE_REVIEW",
      "IR_WRITE",
      "RESOLVE",
      "REPORT_REVIEW",
      "HUMAN_REVIEW",
      "BUILD",
      "DEFENSE_PREP",
    ]);
  });

  test("commits a checkpoint for every state it enters", async () => {
    await runJob({ job, agents: agents() });

    const history = job.git.log();

    expect(history).toContain("checkpoint: DONE");
    expect(history).toContain("checkpoint: SOLVE");
  });

  test("loops through the fixer and comes back", async () => {
    const runner = agents({
      CODE_REVIEW: [
        {
          status: "completed",
          sessionId: "s1",
          findings: [{ id: "f1", severity: "major", what: "bug" }],
        },
      ],
    });

    await runJob({ job, agents: runner });

    expect(runner.visited).toContain("FIX");
    expect(runner.visited.filter((state) => state === "CODE_REVIEW")).toHaveLength(2);
  });

  test("stops and waits when the agent needs the student", async () => {
    const runner = agents({
      CONTEXT: [{ status: "needs_user", sessionId: "s1", question: "Which variant?" }],
    });

    const result = await runJob({ job, agents: runner });

    expect(result.state).toBe("PAUSED_WAITING_USER");
    expect(result.question).toBe("Which variant?");
    expect(job.readCheckpoint()?.state).toBe("PAUSED_WAITING_USER");
  });

  test("stops and records when to come back after a rate limit", async () => {
    const runner = agents({
      SOLVE: [{ status: "rate_limited", sessionId: "s1", resumeAt: "2026-08-15T18:00:00.000Z" }],
    });

    const result = await runJob({ job, agents: runner });

    expect(result.state).toBe("PAUSED_RATE_LIMIT");
    expect(job.readCheckpoint()?.resumeAt).toBe("2026-08-15T18:00:00.000Z");
  });

  test("continues a paused job from where it stopped", async () => {
    const first = agents({
      SOLVE: [{ status: "rate_limited", sessionId: "s1", resumeAt: "2026-08-15T18:00:00.000Z" }],
    });
    await runJob({ job, agents: first });

    const second = agents();
    const result = await runJob({ job, agents: second });

    expect(second.visited[0]).toBe("SOLVE");
    expect(result.state).toBe("DONE");
  });

  test("remembers the session so a resumed state does not start from scratch", async () => {
    const runner = agents({
      SOLVE: [
        { status: "rate_limited", sessionId: "session-abc", resumeAt: "2026-08-15T18:00:00.000Z" },
      ],
    });

    await runJob({ job, agents: runner });

    expect(job.readCheckpoint()?.sessionIds.SOLVE).toBe("session-abc");
  });

  test("hands a resumed state its previous session", async () => {
    const first = agents({
      SOLVE: [
        { status: "rate_limited", sessionId: "session-abc", resumeAt: "2026-08-15T18:00:00.000Z" },
      ],
    });
    await runJob({ job, agents: first });

    let handed: string | undefined;
    await runJob({
      job,
      agents: {
        run(request) {
          if (request.state === "SOLVE") {
            handed = request.resumeSessionId;
          }

          return Promise.resolve(completed);
        },
      },
    });

    expect(handed).toBe("session-abc");
  });

  test("fails the job when an agent reports an error", async () => {
    const runner = agents({
      SOLVE: [{ status: "failed", sessionId: "s1", error: "sandbox died" }],
    });

    const result = await runJob({ job, agents: runner });

    expect(result.state).toBe("FAILED");
    expect(job.readCheckpoint()?.lastError).toContain("sandbox died");
  });

  test("escalates a review loop that will not converge", async () => {
    const repeated: AgentOutcome = {
      status: "completed",
      sessionId: "s1",
      findings: [{ id: "f1", severity: "critical", what: "same bug" }],
    };
    const runner = agents({ CODE_REVIEW: [repeated, repeated, repeated, repeated, repeated] });

    const result = await runJob({ job, agents: runner });

    expect(result.state).toBe("PAUSED_WAITING_USER");
    expect(runner.visited.filter((state) => state === "FIX").length).toBeLessThanOrEqual(3);
  });

  test("refuses to run a job that has already finished", async () => {
    await runJob({ job, agents: agents() });

    const result = await runJob({ job, agents: agents() });

    expect(result.state).toBe("DONE");
  });

  test("stops at a state the caller asked it to stop before", async () => {
    const runner = agents();

    const result = await runJob({ job, agents: runner, stopBefore: "HUMAN_REVIEW" });

    expect(result.state).toBe("HUMAN_REVIEW");
    expect(runner.visited).not.toContain("HUMAN_REVIEW");
  });
});
