import { describe, expect, test } from "bun:test";
import { checkpointSchema, initialCheckpoint, JOB_STATES, withState } from "./checkpoint";

describe("checkpointSchema", () => {
  test("accepts a freshly created checkpoint", () => {
    expect(checkpointSchema.safeParse(initialCheckpoint("job_1")).success).toBe(true);
  });

  test("rejects a state outside the machine", () => {
    const invalid = { ...initialCheckpoint("job_1"), state: "VIBING" };

    expect(checkpointSchema.safeParse(invalid).success).toBe(false);
  });

  test("rejects a checkpoint without a job id", () => {
    const { jobId, ...rest } = initialCheckpoint("job_1");

    expect(checkpointSchema.safeParse(rest).success).toBe(false);
  });

  test("keeps every state of the documented machine", () => {
    expect(JOB_STATES).toContain("INGEST");
    expect(JOB_STATES).toContain("RESOLVE");
    expect(JOB_STATES).toContain("PAUSED_RATE_LIMIT");
    expect(JOB_STATES).toContain("PAUSED_WAITING_USER");
    expect(JOB_STATES).toContain("DONE");
  });
});

describe("initialCheckpoint", () => {
  test("starts a job at ingest with no history", () => {
    const checkpoint = initialCheckpoint("job_1");

    expect(checkpoint.state).toBe("INGEST");
    expect(checkpoint.cycles).toEqual({});
    expect(checkpoint.sessionIds).toEqual({});
  });
});

describe("withState", () => {
  test("moves the job and records the previous state", () => {
    const moved = withState(initialCheckpoint("job_1"), "SOLVE", "2026-08-15T10:00:00.000Z");

    expect(moved.state).toBe("SOLVE");
    expect(moved.previousState).toBe("INGEST");
    expect(moved.updatedAt).toBe("2026-08-15T10:00:00.000Z");
  });

  test("does not mutate the checkpoint it was given", () => {
    const before = initialCheckpoint("job_1");

    withState(before, "SOLVE", "2026-08-15T10:00:00.000Z");

    expect(before.state).toBe("INGEST");
  });

  test("counts a state each time the job comes back round to it", () => {
    const first = withState(initialCheckpoint("job_1"), "FIX", "2026-08-15T10:00:00.000Z");
    const review = withState(first, "CODE_REVIEW", "2026-08-15T10:01:00.000Z");
    const second = withState(review, "FIX", "2026-08-15T10:02:00.000Z");

    expect(second.cycles.FIX).toBe(2);
  });

  test("does not count re-entering the state the job is already in", () => {
    const first = withState(initialCheckpoint("job_1"), "FIX", "2026-08-15T10:00:00.000Z");
    const rerun = withState(first, "FIX", "2026-08-15T10:05:00.000Z");

    expect(rerun.cycles.FIX).toBe(1);
  });

  test("keeps counts per state", () => {
    const one = withState(initialCheckpoint("job_1"), "FIX", "2026-08-15T10:00:00.000Z");
    const two = withState(one, "CODE_REVIEW", "2026-08-15T10:01:00.000Z");

    expect(two.cycles).toEqual({ FIX: 1, CODE_REVIEW: 1 });
  });
});
