import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  type Checkpoint,
  canLeave,
  checkpointSchema,
  initialCheckpoint,
  type JobState,
  withState,
} from "./checkpoint";
import { type JobGit, jobGitAt, readCommittedFile } from "./git";

export const JOB_DIRECTORIES = [
  "src",
  "cells",
  "artifacts",
  "build",
  "runs",
  "context",
  "review",
] as const;

export const CHECKPOINT_FILE = "checkpoint.json";
const IGNORED = ["checkpoint.lock", "*.tmp", "build/"];
export const LOCK_FILE = "checkpoint.lock";
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
  update(change: (checkpoint: Checkpoint) => Checkpoint): Checkpoint;
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

      for (const directory of JOB_DIRECTORIES) {
        mkdirSync(join(dir, directory), { recursive: true });
      }

      const existing = job(dir, jobId);
      existing.git.init();

      return existing;
    },
    listJobs() {
      if (!existsSync(root)) {
        return [];
      }

      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => existsSync(join(root, name, CHECKPOINT_FILE)))
        .sort();
    },
  };
}

function prepare(root: string, jobId: string, checkpoint: Checkpoint): Job {
  const dir = jobDir(root, jobId);

  for (const directory of JOB_DIRECTORIES) {
    mkdirSync(join(dir, directory), { recursive: true });
  }

  writeFileSync(join(dir, ".gitignore"), `${IGNORED.join("\n")}\n`, "utf8");

  const created = job(dir, jobId);
  created.git.init();
  created.writeCheckpoint(checkpoint);
  created.git.commit(`checkpoint: ${checkpoint.state}`);

  return created;
}

function job(dir: string, jobId: string): Job {
  const checkpointPath = join(dir, CHECKPOINT_FILE);
  const lockPath = join(dir, LOCK_FILE);
  const git = jobGitAt(dir);

  const readCheckpoint = (): Checkpoint | undefined => {
    if (!existsSync(checkpointPath)) {
      return undefined;
    }

    try {
      return parseCheckpoint(readFileSync(checkpointPath, "utf8"), checkpointPath, jobId);
    } catch (error) {
      const committed = readCommittedFile(dir, CHECKPOINT_FILE);

      if (committed === undefined) {
        throw error;
      }

      return parseCheckpoint(committed, `${checkpointPath} (from git)`, jobId);
    }
  };

  const writeCheckpoint = (checkpoint: Checkpoint): void => {
    const parsed = checkpointSchema.safeParse(checkpoint);

    if (!parsed.success) {
      throw new JobStoreError(`Refusing to write an invalid checkpoint: ${parsed.error.message}`);
    }

    writeAtomically(checkpointPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
  };

  return {
    id: jobId,
    dir,
    git,
    reportPath: join(dir, REPORT_FILE),
    update(change) {
      return withLock(lockPath, () => {
        const current = readCheckpoint();

        if (current === undefined) {
          throw new JobStoreError(`Job "${jobId}" has no checkpoint to change`);
        }

        const next = change(current);

        writeCheckpoint(next);

        return next;
      });
    },
    advanceTo(state, now) {
      return withLock(lockPath, () => {
        const current = readCheckpoint();

        if (current === undefined) {
          throw new JobStoreError(`Job "${jobId}" has no checkpoint to advance`);
        }

        if (!canLeave(current.state)) {
          throw new JobStoreError(`Job "${jobId}" is ${current.state} and cannot move to ${state}`);
        }

        const previous = readFileSync(checkpointPath, "utf8");
        const next = withState(current, state, now);
        writeCheckpoint(next);

        try {
          git.commit(`checkpoint: ${state}`);
        } catch (error) {
          writeAtomically(checkpointPath, previous);
          throw error;
        }

        return next;
      });
    },
    readCheckpoint,
    writeCheckpoint,
  };
}

function writeAtomically(path: string, content: string): void {
  const temporary = `${path}.tmp`;
  const file = openSync(temporary, "w");

  try {
    writeSync(file, content);
    fsyncSync(file);
  } finally {
    closeSync(file);
  }

  renameSync(temporary, path);
}

function withLock<T>(lockPath: string, work: () => T): T {
  const lock = acquire(lockPath);

  try {
    return work();
  } finally {
    closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}

function acquire(lockPath: string): number {
  try {
    return claim(lockPath);
  } catch {
    if (heldByLiveProcess(lockPath)) {
      throw new JobStoreError(`Job is already being advanced (${lockPath} is held)`);
    }

    rmSync(lockPath, { force: true });

    try {
      return claim(lockPath);
    } catch {
      throw new JobStoreError(`Job is already being advanced (${lockPath} is held)`);
    }
  }
}

function claim(lockPath: string): number {
  const lock = openSync(lockPath, "wx");

  writeSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));

  return lock;
}

function heldByLiveProcess(lockPath: string): boolean {
  let owner: number;

  try {
    owner = Number((JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number }).pid);
  } catch {
    return false;
  }

  if (!Number.isInteger(owner) || owner === process.pid) {
    return false;
  }

  try {
    process.kill(owner, 0);

    return true;
  } catch {
    return false;
  }
}

function parseCheckpoint(content: string, path: string, jobId: string): Checkpoint {
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

  if (parsed.data.jobId !== jobId) {
    throw new JobStoreError(`${path} belongs to job "${parsed.data.jobId}" but sits in "${jobId}"`);
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
