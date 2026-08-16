import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobStore, type Job } from "@labforge/jobs";
import { prepareJob } from "./answer";

let root: string;
let jobsDir: string;
let job: Job;

function waiting(): void {
  job.advanceTo("CONTEXT");
  job.advanceTo("PAUSED_WAITING_USER");
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-answer-")));
  jobsDir = join(root, "jobs");
  job = createJobStore(jobsDir).createJob("job_1");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("prepareJob", () => {
  test("stores the answer for the state that asked", () => {
    waiting();

    prepareJob({ jobsDir, jobId: "job_1", answer: "Варіант 7" });

    expect(job.readCheckpoint()?.answer).toBe("Варіант 7");
  });

  test("does not invent a job for a mistyped id", () => {
    expect(() => prepareJob({ jobsDir, jobId: "job_2", answer: "Варіант 7" })).toThrow(/job_2/);
    expect(existsSync(join(jobsDir, "job_2"))).toBe(false);
  });

  test("refuses to answer a job that asked nothing", () => {
    expect(() => prepareJob({ jobsDir, jobId: "job_1", answer: "Варіант 7" })).toThrow(/INGEST/);
  });

  test("starts a brand new lab when there is nothing to answer", () => {
    const started = prepareJob({ jobsDir, jobId: "job_3" });

    expect(started.readCheckpoint()?.state).toBe("INGEST");
  });

  test("opens an existing lab again to carry it on", () => {
    job.advanceTo("SOLVE");

    expect(prepareJob({ jobsDir, jobId: "job_1" }).readCheckpoint()?.state).toBe("SOLVE");
  });
});
