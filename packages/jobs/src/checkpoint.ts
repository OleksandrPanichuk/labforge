import { z } from "zod";

export const JOB_STATES = [
  "INGEST",
  "CONTEXT",
  "CLARIFY",
  "SOLVE",
  "CODE_REVIEW",
  "FIX",
  "IR_WRITE",
  "RESOLVE",
  "REPORT_REVIEW",
  "IR_FIX",
  "HUMAN_REVIEW",
  "REVISION",
  "BUILD",
  "DEFENSE_PREP",
  "DONE",
  "PAUSED_RATE_LIMIT",
  "PAUSED_WAITING_USER",
  "FAILED",
  "CANCELLED",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const checkpointSchema = z.object({
  version: z.literal(1),
  jobId: z.string().min(1),
  state: z.enum(JOB_STATES),
  previousState: z.enum(JOB_STATES).optional(),
  updatedAt: z.string(),
  cycles: z.record(z.enum(JOB_STATES), z.number().int().positive()).default({}),
  sessionIds: z.record(z.string(), z.string()).default({}),
  lastError: z.string().optional(),
  lastFindings: z.record(z.enum(JOB_STATES), z.array(z.string())).optional(),
  resumeAt: z.string().optional(),
});

export type Checkpoint = z.infer<typeof checkpointSchema>;

export function initialCheckpoint(jobId: string, now = new Date().toISOString()): Checkpoint {
  return {
    version: 1,
    jobId,
    state: "INGEST",
    updatedAt: now,
    cycles: {},
    sessionIds: {},
  };
}

export const PAUSED_STATES = ["PAUSED_RATE_LIMIT", "PAUSED_WAITING_USER"] as const;

export const TERMINAL_STATES = ["DONE", "CANCELLED"] as const;

export function isPaused(state: JobState): boolean {
  return (PAUSED_STATES as readonly JobState[]).includes(state);
}

export function isTerminal(state: JobState): boolean {
  return (TERMINAL_STATES as readonly JobState[]).includes(state);
}

export function canLeave(state: JobState): boolean {
  return !isTerminal(state);
}

export function withState(
  checkpoint: Checkpoint,
  state: JobState,
  now = new Date().toISOString(),
): Checkpoint {
  const next: Checkpoint = {
    ...checkpoint,
    state,
    previousState: checkpoint.state,
    updatedAt: now,
    cycles: { ...checkpoint.cycles, ...cycleFor(checkpoint, state) },
  };

  if (!isPaused(state) && state !== "FAILED") {
    next.resumeAt = undefined;
    next.lastError = undefined;
  }

  return next;
}

function cycleFor(checkpoint: Checkpoint, state: JobState): Partial<Record<JobState, number>> {
  const rerun = checkpoint.state === state;
  const resumed = isPaused(checkpoint.state);

  if (rerun || resumed) {
    return {};
  }

  return { [state]: (checkpoint.cycles[state] ?? 0) + 1 };
}
