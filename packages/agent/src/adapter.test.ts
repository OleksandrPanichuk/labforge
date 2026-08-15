import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createJobStore, type Job } from "@labforge/jobs";
import { createAgentRunner } from "./adapter";
import type { Session, SessionRequest, SessionResult } from "./session";

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

let root: string;
let job: Job;

function session(result: Partial<SessionResult> = {}): Session & { seen: SessionRequest[] } {
  const seen: SessionRequest[] = [];

  return {
    seen,
    run(request) {
      seen.push(request);

      return Promise.resolve({
        sessionId: result.sessionId ?? "s1",
        status: result.status ?? "completed",
        text: result.text ?? "done",
        resetsAt: result.resetsAt,
        error: result.error,
        question: result.question,
      });
    },
  };
}

function runner(sdk: Session) {
  return createAgentRunner({ agentsDir: AGENTS_DIR, session: sdk, language: "python" });
}

function request(state: Parameters<ReturnType<typeof runner>["run"]>[0]["state"]) {
  const checkpoint = job.readCheckpoint();

  if (checkpoint === undefined) {
    throw new Error("no checkpoint");
  }

  return { state, job, checkpoint };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-agent-")));
  job = createJobStore(root).createJob("job_1");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("running a state", () => {
  test("sends the prompt that belongs to the state", async () => {
    const sdk = session();

    await runner(sdk).run(request("SOLVE"));

    expect(sdk.seen[0]?.systemPrompt).toContain("лабораторну роботу");
  });

  test("fills the job directory into the prompt", async () => {
    const sdk = session();

    await runner(sdk).run(request("SOLVE"));

    expect(sdk.seen[0]?.systemPrompt).toContain(job.dir);
    expect(sdk.seen[0]?.systemPrompt).not.toContain("{{jobDir}}");
  });

  test("passes only the tools the prompt declares", async () => {
    const sdk = session();

    await runner(sdk).run(request("REPORT_REVIEW"));

    expect(sdk.seen[0]?.allowedTools).not.toContain("Write");
    expect(sdk.seen[0]?.allowedTools).toContain("Read");
  });

  test("runs the agent in the job directory", async () => {
    const sdk = session();

    await runner(sdk).run(request("SOLVE"));

    expect(sdk.seen[0]?.cwd).toBe(job.dir);
  });

  test("reports the session id so the state can be resumed", async () => {
    const outcome = await runner(session({ sessionId: "abc" })).run(request("SOLVE"));

    expect(outcome.sessionId).toBe("abc");
  });

  test("resumes the session the checkpoint remembers", async () => {
    const sdk = session();

    await runner(sdk).run({ ...request("SOLVE"), resumeSessionId: "earlier" });

    expect(sdk.seen[0]?.resume).toBe("earlier");
  });

  test("refuses a state that has no agent", () => {
    expect(runner(session()).run(request("RESOLVE"))).rejects.toThrow(/RESOLVE/);
  });
});

describe("what comes back", () => {
  test("passes a rate limit through with the time to come back", async () => {
    const outcome = await runner(
      session({ status: "rate_limited", resetsAt: "2026-08-15T18:00:00.000Z" }),
    ).run(request("SOLVE"));

    expect(outcome.status).toBe("rate_limited");
    expect(outcome.resumeAt).toBe("2026-08-15T18:00:00.000Z");
  });

  test("passes a failure through with its reason", async () => {
    const outcome = await runner(session({ status: "failed", error: "model refused" })).run(
      request("SOLVE"),
    );

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("model refused");
  });

  test("reports a question the agent asked", async () => {
    const outcome = await runner(session({ question: "Which variant?" })).run(request("CONTEXT"));

    expect(outcome.status).toBe("needs_user");
    expect(outcome.question).toBe("Which variant?");
  });

  test("reads the findings a review wrote", async () => {
    writeFileSync(
      join(job.dir, "review", "findings.json"),
      JSON.stringify([
        { id: "f1", severity: "major", what: "wrong formula" },
        { id: "f2", severity: "minor", what: "naming" },
      ]),
    );

    const outcome = await runner(session()).run(request("CODE_REVIEW"));

    expect(outcome.findings).toHaveLength(2);
    expect(outcome.findings?.[0]?.severity).toBe("major");
  });

  test("treats a finding the fixer closed as gone", async () => {
    writeFileSync(
      join(job.dir, "review", "findings.json"),
      JSON.stringify([{ id: "f1", severity: "critical", what: "bug", status: "fixed" }]),
    );

    const outcome = await runner(session()).run(request("CODE_REVIEW"));

    expect(outcome.findings).toEqual([]);
  });

  test("reads the report review's own findings file", async () => {
    writeFileSync(
      join(job.dir, "review", "report-findings.json"),
      JSON.stringify([{ id: "r1", severity: "major", what: "no sources" }]),
    );

    const outcome = await runner(session()).run(request("REPORT_REVIEW"));

    expect(outcome.findings?.[0]?.id).toBe("r1");
  });

  test("fails loudly when a review leaves findings that are not readable", async () => {
    writeFileSync(join(job.dir, "review", "findings.json"), "not json");

    const outcome = await runner(session()).run(request("CODE_REVIEW"));

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("findings");
  });

  test("treats a review with no findings file as a clean review", async () => {
    const outcome = await runner(session()).run(request("CODE_REVIEW"));

    expect(outcome.status).toBe("completed");
    expect(outcome.findings).toEqual([]);
  });

  test("does not look for findings after a state that is not a review", async () => {
    writeFileSync(join(job.dir, "review", "findings.json"), "not json");

    const outcome = await runner(session()).run(request("SOLVE"));

    expect(outcome.status).toBe("completed");
    expect(outcome.findings).toBeUndefined();
  });
});
