import { describe, expect, test } from "bun:test";
import type { Checkpoint, JobState } from "@labforge/jobs";
import { initialCheckpoint, withState } from "@labforge/jobs";
import { type AgentOutcome, decide } from "./decide";

function at(state: JobState, cycles: Partial<Record<JobState, number>> = {}): Checkpoint {
  return { ...withState(initialCheckpoint("job_1"), state), cycles };
}

const done: AgentOutcome = { status: "completed", sessionId: "s1" };

function findings(...severities: ("critical" | "major" | "minor")[]): AgentOutcome {
  return {
    status: "completed",
    sessionId: "s1",
    findings: severities.map((severity, index) => ({
      id: `f${index}`,
      severity,
      what: `issue ${index}`,
    })),
  };
}

describe("the happy path", () => {
  test("walks from ingest to a solved lab", () => {
    expect(decide(at("INGEST"), done)).toMatchObject({ kind: "advance", state: "CONTEXT" });
    expect(decide(at("CONTEXT"), done)).toMatchObject({ kind: "advance", state: "SOLVE" });
    expect(decide(at("SOLVE"), done)).toMatchObject({ kind: "advance", state: "CODE_REVIEW" });
  });

  test("walks from a clean report to done", () => {
    expect(decide(at("IR_WRITE"), done)).toMatchObject({ kind: "advance", state: "RESOLVE" });
    expect(decide(at("RESOLVE"), done)).toMatchObject({ kind: "advance", state: "REPORT_REVIEW" });
    expect(decide(at("HUMAN_REVIEW"), done)).toMatchObject({ kind: "advance", state: "BUILD" });
    expect(decide(at("BUILD"), done)).toMatchObject({ kind: "advance", state: "DEFENSE_PREP" });
    expect(decide(at("DEFENSE_PREP"), done)).toMatchObject({ kind: "advance", state: "DONE" });
  });

  test("stops at done", () => {
    expect(decide(at("DONE"), done)).toMatchObject({ kind: "finished" });
  });
});

describe("the review loop", () => {
  test("sends a review with a major finding to the fixer", () => {
    expect(decide(at("CODE_REVIEW"), findings("major"))).toMatchObject({
      kind: "advance",
      state: "FIX",
    });
  });

  test("moves on when only minor findings remain", () => {
    expect(decide(at("CODE_REVIEW"), findings("minor", "minor"))).toMatchObject({
      kind: "advance",
      state: "IR_WRITE",
    });
  });

  test("moves on when the review is clean", () => {
    expect(decide(at("CODE_REVIEW"), done)).toMatchObject({ kind: "advance", state: "IR_WRITE" });
  });

  test("returns to review after a fix", () => {
    expect(decide(at("FIX"), done)).toMatchObject({ kind: "advance", state: "CODE_REVIEW" });
  });

  test("gives up on the loop after three rounds and asks the human", () => {
    const checkpoint = at("CODE_REVIEW", { FIX: 3 });

    expect(decide(checkpoint, findings("critical"))).toMatchObject({
      kind: "pause",
      state: "PAUSED_WAITING_USER",
    });
  });

  test("escalates when the same findings come back twice", () => {
    const checkpoint = { ...at("CODE_REVIEW", { FIX: 1 }), lastFindings: { CODE_REVIEW: ["f0"] } };

    expect(decide(checkpoint, findings("major"))).toMatchObject({
      kind: "pause",
      state: "PAUSED_WAITING_USER",
    });
  });

  test("keeps going when the findings changed between rounds", () => {
    const checkpoint = {
      ...at("CODE_REVIEW", { FIX: 1 }),
      lastFindings: { CODE_REVIEW: ["other"] },
    };

    expect(decide(checkpoint, findings("major"))).toMatchObject({
      kind: "advance",
      state: "FIX",
    });
  });

  test("runs the report review loop the same way", () => {
    expect(decide(at("REPORT_REVIEW"), findings("major"))).toMatchObject({
      kind: "advance",
      state: "IR_FIX",
    });
    expect(decide(at("REPORT_REVIEW"), done)).toMatchObject({
      kind: "advance",
      state: "HUMAN_REVIEW",
    });
    expect(decide(at("IR_FIX"), done)).toMatchObject({
      kind: "advance",
      state: "RESOLVE",
    });
  });

  test("counts the report loop separately from the code loop", () => {
    const checkpoint = at("REPORT_REVIEW", { FIX: 3, IR_FIX: 1 });

    expect(decide(checkpoint, findings("major"))).toMatchObject({
      kind: "advance",
      state: "IR_FIX",
    });
  });
});

describe("interruptions", () => {
  test("pauses on a rate limit and remembers when to come back", () => {
    const outcome: AgentOutcome = {
      status: "rate_limited",
      sessionId: "s1",
      resumeAt: "2026-08-15T18:00:00.000Z",
    };

    expect(decide(at("SOLVE"), outcome)).toMatchObject({
      kind: "pause",
      state: "PAUSED_RATE_LIMIT",
      resumeAt: "2026-08-15T18:00:00.000Z",
    });
  });

  test("pauses when the agent needs the student", () => {
    const outcome: AgentOutcome = {
      status: "needs_user",
      sessionId: "s1",
      question: "Which variant?",
    };

    expect(decide(at("CONTEXT"), outcome)).toMatchObject({
      kind: "pause",
      state: "PAUSED_WAITING_USER",
      question: "Which variant?",
    });
  });

  test("returns to the interrupted state when a pause ends", () => {
    const paused = { ...at("PAUSED_RATE_LIMIT"), previousState: "SOLVE" as JobState };

    expect(decide(paused, done)).toMatchObject({ kind: "advance", state: "SOLVE" });
  });

  test("fails a job whose pause has nowhere to return to", () => {
    const paused = { ...at("PAUSED_WAITING_USER"), previousState: undefined };

    expect(decide(paused, done)).toMatchObject({ kind: "fail" });
  });

  test("fails when the agent reports an error", () => {
    const outcome: AgentOutcome = { status: "failed", sessionId: "s1", error: "sandbox died" };

    expect(decide(at("SOLVE"), outcome)).toMatchObject({ kind: "fail", reason: "sandbox died" });
  });

  test("does not resume a cancelled job", () => {
    expect(decide(at("CANCELLED"), done)).toMatchObject({ kind: "finished" });
  });
});

describe("human review", () => {
  test("waits for the student rather than pressing on", () => {
    expect(decide(at("RESOLVE"), done)).toMatchObject({ kind: "advance", state: "REPORT_REVIEW" });
    expect(decide(at("REPORT_REVIEW"), done)).toMatchObject({
      kind: "advance",
      state: "HUMAN_REVIEW",
    });
  });

  test("sends a revision back through resolve", () => {
    expect(decide(at("REVISION"), done)).toMatchObject({ kind: "advance", state: "RESOLVE" });
  });
});
