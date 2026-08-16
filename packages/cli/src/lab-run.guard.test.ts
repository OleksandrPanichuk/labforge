import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobStore, type Job } from "@labforge/jobs";
import { labRun } from "./lab-run";

let root: string;
let job: Job;

function configs(withStudent: boolean): void {
  const dir = join(root, "configs");

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "REQUIREMENTS.md"), "base");
  writeFileSync(join(dir, "STYLE_GUIDE.md"), "base");

  if (withStudent) {
    writeFileSync(
      join(dir, "student.json"),
      JSON.stringify({ name: "Панічук О. В.", group: "ІП-21" }),
    );
  }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-labrun-")));
  job = createJobStore(join(root, "jobs")).createJob("job_1");
  job.advanceTo("SOLVE");
  writeFileSync(join(root, "task.md"), "# task");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("refuses to resume a lab whose configuration it cannot read", async () => {
  configs(false);

  await expect(
    labRun({
      taskPath: join(root, "task.md"),
      language: "python",
      jobId: "job_1",
      jobsDir: join(root, "jobs"),
      configsDir: join(root, "configs"),
      agentsDir: join(root, "agents"),
    }),
  ).rejects.toThrow(/student\.json/);
});

test("leaves the lab exactly where it was rather than failing it", async () => {
  configs(false);

  await labRun({
    taskPath: join(root, "task.md"),
    language: "python",
    jobId: "job_1",
    jobsDir: join(root, "jobs"),
    configsDir: join(root, "configs"),
    agentsDir: join(root, "agents"),
  }).catch(() => undefined);

  expect(job.readCheckpoint()?.state).toBe("SOLVE");
});
