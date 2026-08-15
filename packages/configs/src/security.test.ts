import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

describe("frontmatter cannot silently swallow content", () => {
  test("keeps a file that opens with a horizontal rule", () => {
    const dir = join(root, "hr");
    mkdirSync(join(dir, "teachers", "ivanenko"), { recursive: true });
    writeFileSync(join(dir, "REQUIREMENTS.md"), "base");
    writeFileSync(join(dir, "STYLE_GUIDE.md"), "base");
    writeFileSync(
      join(dir, "teachers", "ivanenko", "REQUIREMENTS.md"),
      "---\n\n## Заборонено\n\nНЕ використовувати numpy без дозволу\n\n---\n\nІнші вимоги.",
    );

    const resolved = resolveConfigs({ teacher: "ivanenko" }, configFilesAt(dir));

    expect(resolved.requirements).toContain("Заборонено");
    expect(resolved.requirements).toContain("numpy");
  });

  test("refuses a malformed frontmatter block instead of dropping every field", () => {
    const dir = join(root, "broken");
    mkdirSync(join(dir, "teachers", "ivanenko"), { recursive: true });
    writeFileSync(join(dir, "REQUIREMENTS.md"), "base");
    writeFileSync(join(dir, "STYLE_GUIDE.md"), "base");
    writeFileSync(
      join(dir, "teachers", "ivanenko", "REQUIREMENTS.md"),
      "---\nteacher: Іваненко\nteacher: Петренко\n---\nrules",
    );

    expect(() => findTeacherSlug("Іваненко", configFilesAt(dir))).toThrow(ConfigError);
  });

  test("refuses a symlink that leads out of the configs directory", () => {
    const dir = join(root, "linked");
    mkdirSync(join(dir, "subjects"), { recursive: true });
    mkdirSync(join(root, "outside"), { recursive: true });
    writeFileSync(join(dir, "REQUIREMENTS.md"), "base");
    writeFileSync(join(dir, "STYLE_GUIDE.md"), "base");
    writeFileSync(join(root, "outside", "REQUIREMENTS.md"), "PLANTED INSTRUCTIONS");
    symlinkSync(join(root, "outside"), join(dir, "subjects", "evil"));

    const resolved = (() => {
      try {
        return resolveConfigs({ subject: "evil" }, configFilesAt(dir)).requirements;
      } catch {
        return "";
      }
    })();

    expect(resolved).not.toContain("PLANTED INSTRUCTIONS");
  });
});
