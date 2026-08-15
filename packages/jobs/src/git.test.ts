import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobGitAt } from "./git";

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "labforge-git-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("jobGitAt", () => {
  test("initialises a repository in the job directory", () => {
    const git = jobGitAt(dir);

    git.init();

    expect(git.isRepository()).toBe(true);
  });

  test("commits the job contents and records the message", () => {
    const git = jobGitAt(dir);
    git.init();
    writeFileSync(join(dir, "checkpoint.json"), "{}");

    expect(git.commit("checkpoint: SOLVE")).toBe(true);
    expect(git.log()[0]).toBe("checkpoint: SOLVE");
  });

  test("keeps one commit per state, newest first", () => {
    const git = jobGitAt(dir);
    git.init();

    for (const state of ["INGEST", "SOLVE", "BUILD"]) {
      writeFileSync(join(dir, "checkpoint.json"), JSON.stringify({ state }));
      git.commit(`checkpoint: ${state}`);
    }

    expect(git.log()).toEqual(["checkpoint: BUILD", "checkpoint: SOLVE", "checkpoint: INGEST"]);
  });

  test("reports that nothing was committed when nothing changed", () => {
    const git = jobGitAt(dir);
    git.init();
    writeFileSync(join(dir, "checkpoint.json"), "{}");
    git.commit("first");

    expect(git.commit("second")).toBe(false);
    expect(git.log()).toEqual(["first"]);
  });

  test("does not need the machine's git identity to be configured", () => {
    const git = jobGitAt(dir);
    git.init();
    writeFileSync(join(dir, "checkpoint.json"), "{}");

    expect(git.commit("checkpoint: INGEST")).toBe(true);
  });

  test("says a plain directory is not a repository", () => {
    expect(jobGitAt(dir).isRepository()).toBe(false);
  });

  test("initialising twice is harmless", () => {
    const git = jobGitAt(dir);

    git.init();
    git.init();

    expect(git.isRepository()).toBe(true);
  });
});
