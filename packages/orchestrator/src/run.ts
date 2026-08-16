import { type Checkpoint, isPaused, isTerminal, type Job, type JobState } from "@labforge/jobs";
import { createLogger, type Logger, withContext } from "@labforge/logger";
import { type AgentOutcome, blockingFindings, type Decision, decide } from "./decide";

export interface AgentRequest {
  state: JobState;
  job: Job;
  checkpoint: Checkpoint;
  resumeSessionId?: string;
  question?: string;
  answer?: string;
}

export interface AgentRunner {
  run(request: AgentRequest): Promise<AgentOutcome>;
}

export interface RunRequest {
  job: Job;
  agents: AgentRunner;
  stopBefore?: JobState;
  logger?: Logger;
  maxSteps?: number;
}

export interface RunResult {
  state: JobState;
  question?: string;
  resumeAt?: string;
  reason?: string;
}

const DEFAULT_MAX_STEPS = 60;

export const MAX_ANSWER_LENGTH = 4000;

export function recordAnswer(job: Job, answer: string): JobState {
  const checkpoint = current(job);

  if (checkpoint.state !== "PAUSED_WAITING_USER") {
    throw new Error(`Job "${job.id}" is in ${checkpoint.state} and is not waiting for an answer`);
  }

  if (answer.trim() === "") {
    throw new Error("The answer is empty");
  }

  if (answer.length > MAX_ANSWER_LENGTH) {
    throw new Error(`The answer is too long; keep it under ${MAX_ANSWER_LENGTH} characters`);
  }

  const target = checkpoint.previousState;

  if (target === undefined) {
    throw new Error(`Job "${job.id}" was paused with no state to return to`);
  }

  job.update((current) => ({ ...current, answer }));

  return target;
}

export async function runJob(request: RunRequest): Promise<RunResult> {
  const { job, agents } = request;
  const logger = withContext(request.logger ?? createLogger({ service: "core" }), {
    jobId: job.id,
  });
  const limit = request.maxSteps ?? DEFAULT_MAX_STEPS;

  for (let step = 0; step < limit; step += 1) {
    const checkpoint = current(job);

    if (
      isTerminal(checkpoint.state) ||
      checkpoint.state === "FAILED" ||
      checkpoint.state === request.stopBefore
    ) {
      return { state: checkpoint.state, reason: checkpoint.lastError };
    }

    if (checkpoint.state === "PAUSED_WAITING_USER" && checkpoint.answer === undefined) {
      return {
        state: checkpoint.state,
        question: checkpoint.question,
        reason: checkpoint.lastError,
      };
    }

    const decision = isPaused(checkpoint.state)
      ? decide(checkpoint, { status: "completed", sessionId: "" })
      : await runState(job, agents, checkpoint, logger);

    const settled = apply(job, decision);

    if (settled !== undefined) {
      return settled;
    }
  }

  return stall(job, limit);
}

async function runState(
  job: Job,
  agents: AgentRunner,
  checkpoint: Checkpoint,
  logger: Logger,
): Promise<Decision> {
  const outcome = await agents.run({
    state: checkpoint.state,
    job,
    checkpoint,
    resumeSessionId: checkpoint.sessionIds[checkpoint.state],
    ...(checkpoint.answer !== undefined && {
      answer: checkpoint.answer,
      ...(checkpoint.question !== undefined && { question: checkpoint.question }),
    }),
  });
  const decision = decide(checkpoint, outcome);

  remember(job, checkpoint, outcome);
  logger.info({ state: checkpoint.state, decision: decision.kind }, "state finished");

  return decision;
}

function apply(job: Job, decision: Decision): RunResult | undefined {
  if (decision.kind === "advance") {
    job.advanceTo(decision.state);

    return undefined;
  }

  if (decision.kind === "finished") {
    return { state: current(job).state };
  }

  if (decision.kind === "fail") {
    note(job, { lastError: decision.reason });
    job.advanceTo("FAILED");

    return { state: "FAILED", reason: decision.reason };
  }

  note(job, {
    resumeAt: decision.resumeAt,
    lastError: decision.reason,
    question: decision.question,
  });

  if (decision.escalated === true) {
    clearLoop(job);
  }

  job.advanceTo(decision.state);

  return {
    state: decision.state,
    question: decision.question,
    resumeAt: decision.resumeAt,
    reason: decision.reason,
  };
}

function clearLoop(job: Job): void {
  const checkpoint = current(job);
  const cycles = { ...checkpoint.cycles };
  const findings = { ...checkpoint.lastFindings };

  for (const state of ["FIX", "IR_FIX"] as const) {
    delete cycles[state];
    delete findings[state === "FIX" ? "CODE_REVIEW" : "REPORT_REVIEW"];
  }

  job.writeCheckpoint({ ...checkpoint, cycles, lastFindings: findings });
}

function stall(job: Job, limit: number): RunResult {
  const reason = `the job did not settle within ${limit} steps`;

  note(job, { lastError: reason });
  job.advanceTo("FAILED");

  return { state: "FAILED", reason };
}

function current(job: Job): Checkpoint {
  const checkpoint = job.readCheckpoint();

  if (checkpoint === undefined) {
    throw new Error(`Job "${job.id}" has no checkpoint to run`);
  }

  return checkpoint;
}

function remember(job: Job, checkpoint: Checkpoint, outcome: AgentOutcome): void {
  const held = outcome.status === "rate_limited";

  job.writeCheckpoint({
    ...checkpoint,
    answer: held ? checkpoint.answer : undefined,
    question: held ? checkpoint.question : undefined,
    sessionIds: { ...checkpoint.sessionIds, [checkpoint.state]: outcome.sessionId },
    ...(outcome.findings !== undefined && {
      lastFindings: {
        ...checkpoint.lastFindings,
        [checkpoint.state]: blockingFindings(outcome.findings).map((finding) => finding.id),
      },
    }),
  });
}

function note(
  job: Job,
  fields: { resumeAt?: string; lastError?: string; question?: string },
): void {
  const checkpoint = current(job);

  job.writeCheckpoint({
    ...checkpoint,
    ...(fields.resumeAt !== undefined && { resumeAt: fields.resumeAt }),
    ...(fields.lastError !== undefined && { lastError: fields.lastError }),
    ...(fields.question !== undefined && { question: fields.question }),
  });
}
