import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobStore, type Job } from "@labforge/jobs";
import { RUN_CONTEXT, settingsFor, writeRunContext } from "./run-context";

let root: string;
let job: Job;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-run-context-")));
  job = createJobStore(join(root, "jobs")).createJob("job_1");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("settingsFor", () => {
  test("uses what the command line says", () => {
    const settings = settingsFor({ language: "C++", subject: "numeric-methods" }, job.dir);

    expect(settings).toEqual({ language: "C++", subject: "numeric-methods" });
  });

  test("remembers the settings for the runs that follow", () => {
    settingsFor({ language: "C++", subject: "numeric-methods", teacher: "ivanenko" }, job.dir);

    expect(settingsFor({}, job.dir)).toEqual({
      language: "C++",
      subject: "numeric-methods",
      teacher: "ivanenko",
    });
  });

  test("does not quietly move an answered lab to another language", () => {
    settingsFor({ language: "java", subject: "oop" }, job.dir);

    expect(settingsFor({}, job.dir).language).toBe("java");
  });

  test("lets a later run correct what was recorded", () => {
    settingsFor({ language: "java", variant: "7" }, job.dir);

    expect(settingsFor({ variant: "9" }, job.dir)).toEqual({ language: "java", variant: "9" });
  });

  test("falls back to python when nobody ever said", () => {
    expect(settingsFor({}, job.dir).language).toBe("python");
  });

  test("refuses to record settings it would not accept back", () => {
    expect(() => writeRunContext(job.dir, { language: "" })).toThrow(/language/);
  });

  test("ignores a run file that has been mangled", () => {
    writeFileSync(join(job.dir, RUN_CONTEXT), "{ language: ", "utf8");

    expect(settingsFor({}, job.dir).language).toBe("python");
  });

  test("ignores a run file that names no language", () => {
    writeRunContext(job.dir, { language: "java" });
    writeFileSync(join(job.dir, RUN_CONTEXT), JSON.stringify({ subject: "oop" }), "utf8");

    expect(settingsFor({}, job.dir).language).toBe("python");
  });
});
