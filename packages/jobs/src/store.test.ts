import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialCheckpoint, withState } from "./checkpoint";
import { createJobStore, JobStoreError } from "./store";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-jobs-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createJob", () => {
  test("creates every directory a state needs", () => {
    const job = createJobStore(root).createJob("job_1");

    for (const directory of ["src", "cells", "artifacts", "runs", "context", "review"]) {
      expect(existsSync(join(job.dir, directory))).toBe(true);
    }
  });

  test("creates artifacts up front so a sandbox run can write into it", () => {
    const job = createJobStore(root).createJob("job_1");

    writeFileSync(join(job.dir, "artifacts", "plot.png"), "png");

    expect(existsSync(join(job.dir, "artifacts", "plot.png"))).toBe(true);
  });

  test("writes an initial checkpoint", () => {
    const job = createJobStore(root).createJob("job_1");

    expect(job.readCheckpoint()?.state).toBe("INGEST");
  });

  test("starts a git history so every state is recoverable", () => {
    const job = createJobStore(root).createJob("job_1");

    expect(job.git.isRepository()).toBe(true);
    expect(job.git.log()).toHaveLength(1);
  });

  test("refuses a job id that is not a safe directory name", () => {
    const store = createJobStore(root);

    expect(() => store.createJob("../escape")).toThrow(JobStoreError);
    expect(() => store.createJob("job 1/../..")).toThrow(JobStoreError);
  });

  test("refuses to create a job twice", () => {
    const store = createJobStore(root);
    store.createJob("job_1");

    expect(() => store.createJob("job_1")).toThrow(JobStoreError);
  });
});

describe("checkpoints", () => {
  test("round-trips a checkpoint through disk", () => {
    const job = createJobStore(root).createJob("job_1");
    const moved = withState(initialCheckpoint("job_1"), "SOLVE", "2026-08-15T10:00:00.000Z");

    job.writeCheckpoint(moved);

    expect(job.readCheckpoint()).toEqual(moved);
  });

  test("reports no checkpoint for a job that has none", () => {
    const job = createJobStore(root).openJob("job_1", { create: true });
    rmSync(join(job.dir, "checkpoint.json"));

    expect(job.readCheckpoint()).toBeUndefined();
  });

  test("falls back to the committed checkpoint when the file is off-schema", () => {
    const job = createJobStore(root).createJob("job_1");
    writeFileSync(join(job.dir, "checkpoint.json"), JSON.stringify({ state: "VIBING" }));

    expect(job.readCheckpoint()?.state).toBe("INGEST");
  });

  test("refuses a checkpoint that is neither readable nor recoverable", () => {
    const job = createJobStore(root).createJob("job_1");
    writeFileSync(join(job.dir, "checkpoint.json"), "not json");
    rmSync(join(job.dir, ".git"), { recursive: true, force: true });

    expect(() => job.readCheckpoint()).toThrow(JobStoreError);
  });

  test("writes the checkpoint so a human can read the diff", () => {
    const job = createJobStore(root).createJob("job_1");

    expect(readFileSync(join(job.dir, "checkpoint.json"), "utf8")).toContain("\n");
  });
});

describe("advanceTo", () => {
  test("records the new state and commits it in one step", () => {
    const job = createJobStore(root).createJob("job_1");

    const moved = job.advanceTo("SOLVE", "2026-08-15T10:00:00.000Z");

    expect(moved.state).toBe("SOLVE");
    expect(job.readCheckpoint()?.state).toBe("SOLVE");
    expect(job.git.log()[0]).toContain("SOLVE");
  });

  test("leaves one commit per state entered", () => {
    const job = createJobStore(root).createJob("job_1");

    job.advanceTo("CONTEXT", "2026-08-15T10:00:00.000Z");
    job.advanceTo("SOLVE", "2026-08-15T10:01:00.000Z");

    expect(job.git.log()).toHaveLength(3);
  });

  test("carries the cycle count so stop rules can read it", () => {
    const job = createJobStore(root).createJob("job_1");

    job.advanceTo("FIX", "2026-08-15T10:00:00.000Z");
    job.advanceTo("CODE_REVIEW", "2026-08-15T10:01:00.000Z");
    const second = job.advanceTo("FIX", "2026-08-15T10:02:00.000Z");

    expect(second.cycles.FIX).toBe(2);
  });

  test("refuses to advance a job whose checkpoint is gone", () => {
    const job = createJobStore(root).createJob("job_1");
    rmSync(join(job.dir, "checkpoint.json"));

    expect(() => job.advanceTo("SOLVE")).toThrow(JobStoreError);
  });
});

describe("openJob", () => {
  test("opens an existing job", () => {
    const store = createJobStore(root);
    store.createJob("job_1");

    expect(store.openJob("job_1").readCheckpoint()?.jobId).toBe("job_1");
  });

  test("refuses to open a job that does not exist", () => {
    expect(() => createJobStore(root).openJob("ghost")).toThrow(JobStoreError);
  });

  test("lists the jobs it knows about", () => {
    const store = createJobStore(root);
    store.createJob("job_1");
    store.createJob("job_2");

    expect(store.listJobs()).toEqual(["job_1", "job_2"]);
  });
});

describe("update", () => {
  test("changes one field and keeps the rest", () => {
    const job = createJobStore(root).createJob("job_1");

    job.update((checkpoint) => ({ ...checkpoint, answer: "Варіант 7" }));

    expect(job.readCheckpoint()?.answer).toBe("Варіант 7");
    expect(job.readCheckpoint()?.state).toBe("INGEST");
  });

  test("does not undo a change another holder of the job just made", () => {
    const store = createJobStore(root);
    const mine = store.createJob("job_1");
    const theirs = store.openJob("job_1");

    theirs.advanceTo("CONTEXT");
    mine.update((checkpoint) => ({ ...checkpoint, answer: "Варіант 7" }));

    expect(mine.readCheckpoint()?.state).toBe("CONTEXT");
    expect(mine.readCheckpoint()?.answer).toBe("Варіант 7");
  });

  test("refuses a change that would break the checkpoint", () => {
    const job = createJobStore(root).createJob("job_1");

    expect(() => job.update((checkpoint) => ({ ...checkpoint, version: 2 }) as never)).toThrow();
  });
});
