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

export function withState(
  checkpoint: Checkpoint,
  state: JobState,
  now = new Date().toISOString(),
): Checkpoint {
  return {
    ...checkpoint,
    state,
    previousState: checkpoint.state,
    updatedAt: now,
    cycles: { ...checkpoint.cycles, [state]: (checkpoint.cycles[state] ?? 0) + 1 },
  };
}
