import { describe, expect, test } from "bun:test";
import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  test("returns the whole text as body when there is no frontmatter", () => {
    expect(parseFrontmatter("# Requirements\n\ntext")).toEqual({
      data: {},
      body: "# Requirements\n\ntext",
    });
  });

  test("reads scalar fields", () => {
    const source = "---\nteacher: Іваненко\n---\n# Requirements\n";

    expect(parseFrontmatter(source)).toEqual({
      data: { teacher: "Іваненко" },
      body: "# Requirements\n",
    });
  });

  test("reads an inline list", () => {
    const source = "---\naliases: [іваненко, ivanenko, I. Ivanenko]\n---\nbody";

    expect(parseFrontmatter(source).data.aliases).toEqual(["іваненко", "ivanenko", "I. Ivanenko"]);
  });

  test("reads a dashed list", () => {
    const source = "---\naliases:\n  - іваненко\n  - ivanenko\n---\nbody";

    expect(parseFrontmatter(source).data.aliases).toEqual(["іваненко", "ivanenko"]);
  });

  test("strips surrounding quotes from values", () => {
    expect(parseFrontmatter('---\nteacher: "Іваненко І.І."\n---\nbody').data.teacher).toBe(
      "Іваненко І.І.",
    );
  });

  test("ignores an unterminated frontmatter block", () => {
    const source = "---\nteacher: Іваненко\n\nbody without close";

    expect(parseFrontmatter(source)).toEqual({ data: {}, body: source });
  });

  test("keeps a body that itself contains a horizontal rule", () => {
    const source = "---\nteacher: X\n---\nfirst\n\n---\n\nsecond";

    expect(parseFrontmatter(source).body).toBe("first\n\n---\n\nsecond");
  });
});
