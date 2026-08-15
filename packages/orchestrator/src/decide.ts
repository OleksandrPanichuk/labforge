import { type Checkpoint, isPaused, isTerminal, type JobState } from "@labforge/jobs";

export const MAX_REVIEW_CYCLES = 3;

export type FindingSeverity = "critical" | "major" | "minor";

export interface Finding {
  id: string;
  severity: FindingSeverity;
  what: string;
}

export type AgentStatus = "completed" | "needs_user" | "rate_limited" | "failed";

export interface AgentOutcome {
  status: AgentStatus;
  sessionId: string;
  findings?: Finding[];
  question?: string;
  resumeAt?: string;
  error?: string;
}

export type Decision =
  | { kind: "advance"; state: JobState }
  | {
      kind: "pause";
      state: "PAUSED_RATE_LIMIT" | "PAUSED_WAITING_USER";
      question?: string;
      resumeAt?: string;
      reason?: string;
    }
  | { kind: "fail"; reason: string }
  | { kind: "finished" };

const NEXT: Partial<Record<JobState, JobState>> = {
  INGEST: "CONTEXT",
  CONTEXT: "SOLVE",
  SOLVE: "CODE_REVIEW",
  FIX: "CODE_REVIEW",
  IR_WRITE: "RESOLVE",
  RESOLVE: "REPORT_REVIEW",
  IR_FIX: "RESOLVE",
  REVISION: "RESOLVE",
  HUMAN_REVIEW: "BUILD",
  BUILD: "DEFENSE_PREP",
  DEFENSE_PREP: "DONE",
};

const REVIEWS: Partial<Record<JobState, { fix: JobState; onward: JobState }>> = {
  CODE_REVIEW: { fix: "FIX", onward: "IR_WRITE" },
  REPORT_REVIEW: { fix: "IR_FIX", onward: "HUMAN_REVIEW" },
};

export function decide(checkpoint: Checkpoint, outcome: AgentOutcome): Decision {
  if (isTerminal(checkpoint.state)) {
    return { kind: "finished" };
  }

  if (outcome.status === "failed") {
    return { kind: "fail", reason: outcome.error ?? "the agent reported a failure" };
  }

  if (outcome.status === "rate_limited") {
    return { kind: "pause", state: "PAUSED_RATE_LIMIT", resumeAt: outcome.resumeAt };
  }

  if (outcome.status === "needs_user") {
    return { kind: "pause", state: "PAUSED_WAITING_USER", question: outcome.question };
  }

  if (isPaused(checkpoint.state)) {
    return resumeFrom(checkpoint);
  }

  const review = REVIEWS[checkpoint.state];

  return review === undefined ? straightOn(checkpoint) : afterReview(checkpoint, review, outcome);
}

export function blockingFindings(findings: Finding[] = []): Finding[] {
  return findings.filter((finding) => finding.severity !== "minor");
}

function resumeFrom(checkpoint: Checkpoint): Decision {
  const target = checkpoint.previousState;

  if (target === undefined || isPaused(target) || isTerminal(target) || target === "FAILED") {
    return { kind: "fail", reason: "the job was paused with no state to return to" };
  }

  return { kind: "advance", state: target };
}

function straightOn(checkpoint: Checkpoint): Decision {
  const next = NEXT[checkpoint.state];

  return next === undefined
    ? { kind: "fail", reason: `no transition defined out of ${checkpoint.state}` }
    : { kind: "advance", state: next };
}

function afterReview(
  checkpoint: Checkpoint,
  review: { fix: JobState; onward: JobState },
  outcome: AgentOutcome,
): Decision {
  const blocking = blockingFindings(outcome.findings);

  if (blocking.length === 0) {
    return { kind: "advance", state: review.onward };
  }

  if ((checkpoint.cycles[review.fix] ?? 0) >= MAX_REVIEW_CYCLES) {
    return escalate(
      `${review.fix} ran ${MAX_REVIEW_CYCLES} times and these findings are still open`,
      blocking,
    );
  }

  if (repeatsLastRound(checkpoint, blocking)) {
    return escalate(
      "the same findings came back unchanged, so the loop is not converging",
      blocking,
    );
  }

  return { kind: "advance", state: review.fix };
}

function escalate(reason: string, blocking: Finding[]): Decision {
  const listed = blocking.map((finding) => `${finding.severity}: ${finding.what}`).join("; ");

  return {
    kind: "pause",
    state: "PAUSED_WAITING_USER",
    reason,
    question: `${reason}. Please look at: ${listed}`,
  };
}

function repeatsLastRound(checkpoint: Checkpoint, blocking: Finding[]): boolean {
  const previous = checkpoint.lastFindings?.[checkpoint.state];

  if (previous === undefined || previous.length === 0) {
    return false;
  }

  const current = blocking.map((finding) => finding.id).sort();

  return current.join("|") === [...previous].sort().join("|");
}
