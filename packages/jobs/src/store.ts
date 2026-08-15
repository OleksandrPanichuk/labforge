import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  type Checkpoint,
  checkpointSchema,
  initialCheckpoint,
  type JobState,
  withState,
} from "./checkpoint";
import { type JobGit, jobGitAt } from "./git";

export const JOB_DIRECTORIES = ["src", "cells", "artifacts", "runs", "context", "review"] as const;

export const CHECKPOINT_FILE = "checkpoint.json";
export const REPORT_FILE = "report.ir.json";

const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class JobStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface Job {
  id: string;
  dir: string;
  reportPath: string;
  git: JobGit;
  readCheckpoint(): Checkpoint | undefined;
  writeCheckpoint(checkpoint: Checkpoint): void;
  advanceTo(state: JobState, now?: string): Checkpoint;
}

export interface JobStore {
  createJob(jobId: string): Job;
  openJob(jobId: string, options?: { create?: boolean }): Job;
  listJobs(): string[];
}

export function createJobStore(jobsRoot: string): JobStore {
  const root = resolve(jobsRoot);

  return {
    createJob(jobId) {
      const dir = jobDir(root, jobId);

      if (existsSync(dir)) {
        throw new JobStoreError(`Job "${jobId}" already exists`);
      }

      return prepare(root, jobId, initialCheckpoint(jobId));
    },
    openJob(jobId, options = {}) {
      const dir = jobDir(root, jobId);

      if (!existsSync(dir)) {
        if (options.create !== true) {
          throw new JobStoreError(`Job "${jobId}" does not exist`);
        }

        return prepare(root, jobId, initialCheckpoint(jobId));
      }

      return job(dir, jobId);
    },
    listJobs() {
      if (!existsSync(root)) {
        return [];
      }

      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    },
  };
}

function prepare(root: string, jobId: string, checkpoint: Checkpoint): Job {
  const dir = jobDir(root, jobId);

  for (const directory of JOB_DIRECTORIES) {
    mkdirSync(join(dir, directory), { recursive: true });
  }

  const created = job(dir, jobId);
  created.git.init();
  created.writeCheckpoint(checkpoint);
  created.git.commit(`checkpoint: ${checkpoint.state}`);

  return created;
}

function job(dir: string, jobId: string): Job {
  const checkpointPath = join(dir, CHECKPOINT_FILE);
  const git = jobGitAt(dir);

  const readCheckpoint = (): Checkpoint | undefined =>
    existsSync(checkpointPath)
      ? parseCheckpoint(readFileSync(checkpointPath, "utf8"), checkpointPath)
      : undefined;

  const writeCheckpoint = (checkpoint: Checkpoint): void => {
    writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  };

  return {
    id: jobId,
    dir,
    git,
    reportPath: join(dir, REPORT_FILE),
    advanceTo(state, now) {
      const current = readCheckpoint();

      if (current === undefined) {
        throw new JobStoreError(`Job "${jobId}" has no checkpoint to advance`);
      }

      const next = withState(current, state, now);
      writeCheckpoint(next);
      git.commit(`checkpoint: ${state}`);

      return next;
    },
    readCheckpoint,
    writeCheckpoint,
  };
}

function parseCheckpoint(content: string, path: string): Checkpoint {
  let raw: unknown;

  try {
    raw = JSON.parse(content);
  } catch {
    throw new JobStoreError(`${path} is not valid JSON`);
  }

  const parsed = checkpointSchema.safeParse(raw);

  if (!parsed.success) {
    throw new JobStoreError(`${path} is not a valid checkpoint: ${parsed.error.message}`);
  }

  return parsed.data;
}

function jobDir(root: string, jobId: string): string {
  if (!JOB_ID_RE.test(jobId)) {
    throw new JobStoreError(`"${jobId}" is not a usable job id`);
  }

  const dir = resolve(root, jobId);

  if (!dir.startsWith(root + sep)) {
    throw new JobStoreError(`"${jobId}" would place the job outside ${root}`);
  }

  return dir;
}
