import { describe, expect, test } from "bun:test";
import type { ConfigFiles } from "./files";
import { findTeacherSlug, resolveConfigs } from "./resolve";

function files(entries: Record<string, string>): ConfigFiles {
  return {
    exists: (path) => path in entries,
    read: (path) => {
      const entry = entries[path];

      if (entry === undefined) {
        throw new Error(`missing ${path}`);
      }

      return entry;
    },
    listDirectories: (path) => {
      const prefix = `${path}/`;

      return [
        ...new Set(
          Object.keys(entries)
            .filter((name) => name.startsWith(prefix))
            .map((name) => name.slice(prefix.length).split("/")[0])
            .filter((name): name is string => name !== undefined && name !== ""),
        ),
      ];
    },
  };
}

const base = {
  "REQUIREMENTS.md": "base requirements",
  "STYLE_GUIDE.md": "base styles",
};

describe("resolveConfigs", () => {
  test("falls back to the base files when nothing more specific exists", () => {
    const resolved = resolveConfigs({}, files(base));

    expect(resolved.requirements).toContain("base requirements");
    expect(resolved.sources.requirements).toEqual(["REQUIREMENTS.md"]);
  });

  test("layers the subject on top of the base", () => {
    const resolved = resolveConfigs(
      { subject: "numeric-methods" },
      files({ ...base, "subjects/numeric-methods/REQUIREMENTS.md": "subject requirements" }),
    );

    expect(resolved.requirements).toContain("base requirements");
    expect(resolved.requirements).toContain("subject requirements");
    expect(resolved.requirements.indexOf("base requirements")).toBeLessThan(
      resolved.requirements.indexOf("subject requirements"),
    );
  });

  test("puts the teacher last so it wins a conflict", () => {
    const resolved = resolveConfigs(
      { subject: "numeric-methods", teacher: "ivanenko" },
      files({
        ...base,
        "subjects/numeric-methods/REQUIREMENTS.md": "subject requirements",
        "teachers/ivanenko/REQUIREMENTS.md": "teacher requirements",
      }),
    );

    expect(resolved.requirements.indexOf("subject requirements")).toBeLessThan(
      resolved.requirements.indexOf("teacher requirements"),
    );
    expect(resolved.sources.requirements).toEqual([
      "REQUIREMENTS.md",
      "subjects/numeric-methods/REQUIREMENTS.md",
      "teachers/ivanenko/REQUIREMENTS.md",
    ]);
  });

  test("puts a teacher's subject-specific file above the teacher's general one", () => {
    const resolved = resolveConfigs(
      { subject: "numeric-methods", teacher: "ivanenko" },
      files({
        ...base,
        "teachers/ivanenko/REQUIREMENTS.md": "teacher general",
        "teachers/ivanenko/subjects/numeric-methods/REQUIREMENTS.md": "teacher for subject",
      }),
    );

    expect(resolved.requirements.indexOf("teacher general")).toBeLessThan(
      resolved.requirements.indexOf("teacher for subject"),
    );
  });

  test("resolves requirements and styles independently", () => {
    const resolved = resolveConfigs(
      { teacher: "ivanenko" },
      files({ ...base, "teachers/ivanenko/STYLE_GUIDE.md": "teacher styles" }),
    );

    expect(resolved.sources.requirements).toEqual(["REQUIREMENTS.md"]);
    expect(resolved.sources.styleGuide).toEqual([
      "STYLE_GUIDE.md",
      "teachers/ivanenko/STYLE_GUIDE.md",
    ]);
  });

  test("labels each layer so the agent knows which one wins", () => {
    const resolved = resolveConfigs(
      { teacher: "ivanenko" },
      files({ ...base, "teachers/ivanenko/REQUIREMENTS.md": "teacher requirements" }),
    );

    expect(resolved.requirements).toContain("teachers/ivanenko/REQUIREMENTS.md");
    expect(resolved.requirements.toLowerCase()).toContain("priority");
  });

  test("drops frontmatter from the merged output", () => {
    const resolved = resolveConfigs(
      { teacher: "ivanenko" },
      files({
        ...base,
        "teachers/ivanenko/REQUIREMENTS.md": "---\nteacher: Іваненко\n---\nteacher requirements",
      }),
    );

    expect(resolved.requirements).not.toContain("teacher: Іваненко");
    expect(resolved.requirements).toContain("teacher requirements");
  });

  test("reports missing base configuration rather than returning nothing", () => {
    expect(() => resolveConfigs({}, files({}))).toThrow(/REQUIREMENTS\.md/);
  });

  test("ignores an unknown teacher instead of failing the job", () => {
    const resolved = resolveConfigs({ teacher: "nobody" }, files(base));

    expect(resolved.sources.requirements).toEqual(["REQUIREMENTS.md"]);
  });
});

describe("findTeacherSlug", () => {
  const directory = files({
    "REQUIREMENTS.md": "base",
    "STYLE_GUIDE.md": "base",
    "teachers/ivanenko/REQUIREMENTS.md":
      "---\nteacher: Іваненко І.І.\naliases: [іваненко, ivanenko]\n---\nrules",
    "teachers/petrenko/STYLE_GUIDE.md": "---\nteacher: Петренко\n---\nstyles",
  });

  test("matches the directory name itself", () => {
    expect(findTeacherSlug("ivanenko", directory)).toBe("ivanenko");
  });

  test("matches a declared alias", () => {
    expect(findTeacherSlug("Іваненко", directory)).toBe("ivanenko");
  });

  test("matches the declared teacher name", () => {
    expect(findTeacherSlug("Іваненко І.І.", directory)).toBe("ivanenko");
  });

  test("ignores case and surrounding whitespace", () => {
    expect(findTeacherSlug("  IVANENKO  ", directory)).toBe("ivanenko");
  });

  test("reads frontmatter from the style guide when there are no requirements", () => {
    expect(findTeacherSlug("Петренко", directory)).toBe("petrenko");
  });

  test("returns undefined when nobody matches", () => {
    expect(findTeacherSlug("Сидоренко", directory)).toBeUndefined();
  });
});
