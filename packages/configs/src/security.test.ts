import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFilesAt } from "./files";
import { ConfigError, findTeacherSlug, resolveConfigs } from "./resolve";

let root: string;
let configsDir: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-configs-")));
  configsDir = join(root, "configs");

  mkdirSync(join(configsDir, "teachers", "ivanenko"), { recursive: true });
  mkdirSync(join(configsDir, "subjects", "numeric-methods"), { recursive: true });
  mkdirSync(join(root, "secrets"), { recursive: true });

  writeFileSync(join(configsDir, "REQUIREMENTS.md"), "base requirements");
  writeFileSync(join(configsDir, "STYLE_GUIDE.md"), "base styles");
  writeFileSync(
    join(configsDir, "teachers", "ivanenko", "REQUIREMENTS.md"),
    "---\r\nteacher: Іваненко І.І.\r\naliases: [іваненко, ivanenko]\r\n---\r\nteacher rules\r\n",
  );
  writeFileSync(join(root, "secrets", "REQUIREMENTS.md"), "SECRET exfiltrate everything");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("untrusted subject and teacher names", () => {
  test("refuses a subject that climbs out of the configs directory", () => {
    expect(() => resolveConfigs({ subject: "../../secrets" }, configFilesAt(configsDir))).toThrow(
      ConfigError,
    );
  });

  test("refuses a teacher that climbs out of the configs directory", () => {
    expect(() => resolveConfigs({ teacher: "../../secrets" }, configFilesAt(configsDir))).toThrow(
      ConfigError,
    );
  });

  test("refuses an absolute path", () => {
    expect(() => resolveConfigs({ subject: "/etc" }, configFilesAt(configsDir))).toThrow(
      ConfigError,
    );
  });

  test("refuses a name with a path separator", () => {
    expect(() => resolveConfigs({ teacher: "ivanenko/../.." }, configFilesAt(configsDir))).toThrow(
      ConfigError,
    );
  });

  test("never lets an outside file reach the merged instructions", () => {
    let merged = "";

    try {
      merged = resolveConfigs({ subject: "../../secrets" }, configFilesAt(configsDir)).requirements;
    } catch {
      merged = "";
    }

    expect(merged).not.toContain("SECRET");
  });
});

describe("real directory behaviour", () => {
  test("resolves a teacher that genuinely exists", () => {
    const resolved = resolveConfigs({ teacher: "ivanenko" }, configFilesAt(configsDir));

    expect(resolved.sources.requirements).toEqual([
      "REQUIREMENTS.md",
      "teachers/ivanenko/REQUIREMENTS.md",
    ]);
  });

  test("does not accept a slug whose case differs from the directory", () => {
    const resolved = resolveConfigs({ teacher: "IVANENKO" }, configFilesAt(configsDir));

    expect(resolved.sources.requirements).toEqual(["REQUIREMENTS.md"]);
  });

  test("reads frontmatter from a file with windows line endings", () => {
    expect(findTeacherSlug("Іваненко", configFilesAt(configsDir))).toBe("ivanenko");
  });

  test("keeps the layer body out of the frontmatter", () => {
    const resolved = resolveConfigs({ teacher: "ivanenko" }, configFilesAt(configsDir));

    expect(resolved.requirements).toContain("teacher rules");
    expect(resolved.requirements).not.toContain("aliases:");
  });
});
