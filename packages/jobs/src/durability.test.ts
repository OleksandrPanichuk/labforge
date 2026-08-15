import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialCheckpoint, withState } from "./checkpoint";
import { JobGitError, jobGitAt } from "./git";
import { createJobStore, JobStoreError } from "./store";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-durable-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function commitCount(repository: string): number {
  try {
    return Number(
      execFileSync("git", ["-C", repository, "rev-list", "--count", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    );
  } catch {
    return 0;
  }
}

describe("crash safety", () => {
  test("never leaves a partial checkpoint behind", () => {
    const job = createJobStore(root).createJob("job_1");

    job.advanceTo("SOLVE", "2026-08-15T10:00:00.000Z");

    const written = readFileSync(join(job.dir, "checkpoint.json"), "utf8");
    expect(() => JSON.parse(written)).not.toThrow();
    expect(existsSync(join(job.dir, "checkpoint.json.tmp"))).toBe(false);
  });

  test("recovers the last committed checkpoint when the working copy is corrupt", () => {
    const store = createJobStore(root);
    const job = store.createJob("job_1");
    job.advanceTo("SOLVE", "2026-08-15T10:00:00.000Z");

    writeFileSync(join(job.dir, "checkpoint.json"), "{ truncated");

    expect(store.openJob("job_1").readCheckpoint()?.state).toBe("SOLVE");
  });

  test("still fails loudly when neither the file nor the history can be read", () => {
    const store = createJobStore(root);
    const job = store.createJob("job_1");
    writeFileSync(join(job.dir, "checkpoint.json"), "{ truncated");
    rmSync(join(job.dir, ".git"), { recursive: true, force: true });

    expect(() => store.openJob("job_1").readCheckpoint()).toThrow(JobStoreError);
  });

  test("refuses to write a checkpoint it could not read back", () => {
    const job = createJobStore(root).createJob("job_1");
    const broken = { ...initialCheckpoint("job_1"), state: "VIBING" } as never;

    expect(() => job.writeCheckpoint(broken)).toThrow(JobStoreError);
  });

  test("keeps the previous checkpoint when the commit fails", () => {
    const job = createJobStore(root).createJob("job_1");
    writeFileSync(join(job.dir, ".git", "index.lock"), "");

    expect(() => job.advanceTo("SOLVE")).toThrow(JobGitError);
    expect(job.readCheckpoint()?.state).toBe("INGEST");
  });
});

describe("git isolation", () => {
  test("a job inside another repository never commits to it", () => {
    const parent = join(root, "parent");
    mkdirSync(parent, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", parent]);
    writeFileSync(join(parent, "developer-wip.ts"), "uncommitted work");

    const job = createJobStore(join(parent, "jobs")).createJob("job_1");
    job.advanceTo("SOLVE", "2026-08-15T10:00:00.000Z");

    expect(commitCount(parent)).toBe(0);
    expect(readFileSync(join(parent, "developer-wip.ts"), "utf8")).toBe("uncommitted work");
  });

  test("a job directory that lost its repository is repaired, not hijacked", () => {
    const store = createJobStore(root);
    const job = store.createJob("job_1");
    rmSync(join(job.dir, ".git"), { recursive: true, force: true });

    const reopened = store.openJob("job_1");

    expect(reopened.git.isRepository()).toBe(true);
  });

  test("keeps job files a global ignore rule would have dropped", () => {
    const excludes = join(root, "global-ignore");
    writeFileSync(excludes, "*.log\nartifacts/\n");
    const job = createJobStore(root).createJob("job_1");
    writeFileSync(join(job.dir, "runs", "run-1.log"), "log");
    writeFileSync(join(job.dir, "artifacts", "plot.png"), "png");

    execFileSync("git", ["config", "--local", "core.excludesFile", excludes], {
      cwd: job.dir,
      stdio: "ignore",
    });
    job.advanceTo("SOLVE", "2026-08-15T10:00:00.000Z");

    const tracked = execFileSync("git", ["-C", job.dir, "ls-files"], { encoding: "utf8" });

    expect(tracked).toContain("runs/run-1.log");
    expect(tracked).toContain("artifacts/plot.png");
  });

  test("reports an empty history instead of throwing before the first commit", () => {
    const dir = join(root, "fresh");
    mkdirSync(dir);
    const git = jobGitAt(dir);
    git.init();

    expect(git.log()).toEqual([]);
  });

  test("raises a typed error when git itself fails", () => {
    const job = createJobStore(root).createJob("job_1");
    writeFileSync(join(job.dir, ".git", "index.lock"), "");

    expect(() => job.git.commit("blocked")).toThrow(JobGitError);
  });
});

describe("cycle counting", () => {
  test("counts a real review loop", () => {
    const job = createJobStore(root).createJob("job_1");

    job.advanceTo("FIX", "2026-08-15T10:00:00.000Z");
    job.advanceTo("CODE_REVIEW", "2026-08-15T10:01:00.000Z");
    const second = job.advanceTo("FIX", "2026-08-15T10:02:00.000Z");

    expect(second.cycles.FIX).toBe(2);
  });

  test("does not spend a cycle on a rate-limit pause and resume", () => {
    const job = createJobStore(root).createJob("job_1");
    job.advanceTo("FIX", "2026-08-15T10:00:00.000Z");

    job.advanceTo("PAUSED_RATE_LIMIT", "2026-08-15T10:01:00.000Z");
    const resumed = job.advanceTo("FIX", "2026-08-15T10:02:00.000Z");

    expect(resumed.cycles.FIX).toBe(1);
  });

  test("does not spend a cycle when a state is rerun after a crash", () => {
    const job = createJobStore(root).createJob("job_1");
    job.advanceTo("FIX", "2026-08-15T10:00:00.000Z");

    const rerun = job.advanceTo("FIX", "2026-08-15T10:05:00.000Z");

    expect(rerun.cycles.FIX).toBe(1);
  });
});

describe("transitions", () => {
  test("refuses to resurrect a finished job", () => {
    const job = createJobStore(root).createJob("job_1");
    job.advanceTo("CONTEXT");
    job.advanceTo("SOLVE");
    job.advanceTo("CODE_REVIEW");
    job.advanceTo("IR_WRITE");
    job.advanceTo("RESOLVE");
    job.advanceTo("REPORT_REVIEW");
    job.advanceTo("HUMAN_REVIEW");
    job.advanceTo("BUILD");
    job.advanceTo("DEFENSE_PREP");
    job.advanceTo("DONE");

    expect(() => job.advanceTo("SOLVE")).toThrow(JobStoreError);
  });

  test("allows pausing from any working state", () => {
    const job = createJobStore(root).createJob("job_1");
    job.advanceTo("CONTEXT");

    expect(job.advanceTo("PAUSED_WAITING_USER").state).toBe("PAUSED_WAITING_USER");
  });

  test("clears the pause bookkeeping once the job resumes", () => {
    const job = createJobStore(root).createJob("job_1");
    job.advanceTo("CONTEXT");
    job.writeCheckpoint({
      ...withState(initialCheckpoint("job_1"), "PAUSED_RATE_LIMIT"),
      resumeAt: "2026-08-15T13:00:00.000Z",
      lastError: "rate limited",
    });

    const resumed = job.advanceTo("CONTEXT");

    expect(resumed.resumeAt).toBeUndefined();
    expect(resumed.lastError).toBeUndefined();
  });
});

describe("identity", () => {
  test("never hands back another job's checkpoint", () => {
    const store = createJobStore(root);
    const first = store.createJob("job_1");
    const second = store.createJob("job_2");
    writeFileSync(
      join(second.dir, "checkpoint.json"),
      readFileSync(join(first.dir, "checkpoint.json"), "utf8"),
    );

    expect(store.openJob("job_2").readCheckpoint()?.jobId).toBe("job_2");
  });

  test("rejects a foreign checkpoint when there is no history to fall back on", () => {
    const store = createJobStore(root);
    const first = store.createJob("job_1");
    const second = store.createJob("job_2");
    writeFileSync(
      join(second.dir, "checkpoint.json"),
      readFileSync(join(first.dir, "checkpoint.json"), "utf8"),
    );
    rmSync(join(second.dir, ".git"), { recursive: true, force: true });

    expect(() => store.openJob("job_2").readCheckpoint()).toThrow(JobStoreError);
  });

  test("lists only directories that are really jobs", () => {
    const store = createJobStore(root);
    store.createJob("job_1");
    mkdirSync(join(root, "stray-directory"));

    expect(store.listJobs()).toEqual(["job_1"]);
  });
});

describe("a dead worker must not brick the job", () => {
  test("reclaims a lock whose owner is gone", () => {
    const job = createJobStore(root).createJob("job_1");
    writeFileSync(join(job.dir, "checkpoint.lock"), JSON.stringify({ pid: 999999, at: 0 }));

    expect(job.advanceTo("SOLVE", "2026-08-15T10:00:00.000Z").state).toBe("SOLVE");
  });

  test("reclaims a lock left with no owner information", () => {
    const job = createJobStore(root).createJob("job_1");
    writeFileSync(join(job.dir, "checkpoint.lock"), "");

    expect(job.advanceTo("SOLVE", "2026-08-15T10:00:00.000Z").state).toBe("SOLVE");
  });

  test("does not commit the lock, so restoring from git cannot recreate it", () => {
    const job = createJobStore(root).createJob("job_1");

    job.advanceTo("SOLVE", "2026-08-15T10:00:00.000Z");

    const tracked = execFileSync("git", ["-C", job.dir, "ls-files"], { encoding: "utf8" });

    expect(tracked).not.toContain("checkpoint.lock");
    expect(tracked).not.toContain(".tmp");
    expect(tracked).toContain("checkpoint.json");
  });

  test("leaves the job clean against its own history", () => {
    const job = createJobStore(root).createJob("job_1");

    job.advanceTo("SOLVE", "2026-08-15T10:00:00.000Z");
    const dirty = execFileSync("git", ["-C", job.dir, "status", "--porcelain"], {
      encoding: "utf8",
    }).trim();

    expect(dirty).toBe("");
  });
});

describe("job directories stay complete and clean", () => {
  test("does not commit compiled output", () => {
    const job = createJobStore(root).createJob("job_1");
    writeFileSync(join(job.dir, "build", "a.out"), "binary");

    job.advanceTo("SOLVE", "2026-08-15T10:00:00.000Z");
    const tracked = execFileSync("git", ["-C", job.dir, "ls-files"], { encoding: "utf8" });

    expect(tracked).not.toContain("build/");
  });

  test("adds a directory a job created before it existed", () => {
    const store = createJobStore(root);
    const job = store.createJob("job_1");
    rmSync(join(job.dir, "build"), { recursive: true, force: true });

    const reopened = store.openJob("job_1");

    expect(existsSync(join(reopened.dir, "build"))).toBe(true);
  });
});
