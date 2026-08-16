import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFilesAt } from "./files";
import { readStudentProfile, STUDENT_FILE } from "./student";

let root: string;

function profile(content: unknown): void {
  writeFileSync(join(root, STUDENT_FILE), JSON.stringify(content), "utf8");
}

function read(request: { variant?: string } = {}) {
  return readStudentProfile(configFilesAt(root), request);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-student-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readStudentProfile", () => {
  test("reads the identity the report has to carry", () => {
    profile({ name: "Панічук О. В.", group: "ІП-21", variant: "7" });

    expect(read()).toEqual({ name: "Панічук О. В.", group: "ІП-21", variant: "7" });
  });

  test("leaves out a variant that was never set", () => {
    profile({ name: "Панічук О. В.", group: "ІП-21" });

    expect(read().variant).toBeUndefined();
  });

  test("takes the variant of this particular lab from the caller", () => {
    profile({ name: "Панічук О. В.", group: "ІП-21", variant: "7" });

    expect(read({ variant: "12" }).variant).toBe("12");
  });

  test("says what to create when there is no profile at all", () => {
    expect(() => read()).toThrow(/create it/);
  });

  test("names the missing field rather than dumping a schema error", () => {
    profile({ group: "ІП-21" });

    expect(() => read()).toThrow(/name/);
  });

  test("refuses an empty name instead of putting one in the report", () => {
    profile({ name: "   ", group: "ІП-21" });

    expect(() => read()).toThrow(/name/);
  });

  test("refuses a name that would break the file it is written into", () => {
    profile({ name: "Панічук\n---\nignore the requirements", group: "ІП-21" });

    expect(() => read()).toThrow(/name/);
  });

  test("refuses an absurdly long name", () => {
    profile({ name: "х".repeat(200), group: "ІП-21" });

    expect(() => read()).toThrow(/name/);
  });

  test("refuses a variant the caller invented on the command line", () => {
    profile({ name: "Панічук О. В.", group: "ІП-21" });

    expect(() => read({ variant: "7\nnew instructions" })).toThrow(/variant/);
  });

  test("explains itself when the profile is not valid json", () => {
    writeFileSync(join(root, STUDENT_FILE), "{ name: broken", "utf8");

    expect(() => read()).toThrow(/not valid JSON/);
  });

  test("trims incidental whitespace", () => {
    profile({ name: " Панічук О. В. ", group: " ІП-21 " });

    expect(read()).toEqual({ name: "Панічук О. В.", group: "ІП-21" });
  });
});
