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

  test("reads fields from a file with windows line endings", () => {
    const source = "---\r\nteacher: Іваненко\r\naliases: [a, b]\r\n---\r\nbody";

    expect(parseFrontmatter(source).data.teacher).toBe("Іваненко");
    expect(parseFrontmatter(source).data.aliases).toEqual(["a", "b"]);
  });

  test("drops a trailing comment from a value", () => {
    expect(parseFrontmatter("---\nteacher: Іваненко # головний\n---\nb").data.teacher).toBe(
      "Іваненко",
    );
  });

  test("keeps a quoted value containing a comma intact", () => {
    expect(
      parseFrontmatter('---\naliases: ["Іваненко, І.І.", ivanenko]\n---\nb').data.aliases,
    ).toEqual(["Іваненко, І.І.", "ivanenko"]);
  });

  test("does not let a key escape into the body", () => {
    const source = "---\nnote: |\n  ---\nteacher: X\n---\nbody";

    expect(parseFrontmatter(source).body.trim()).toBe("body");
  });

  test("ignores a proto key instead of touching the prototype", () => {
    const data = parseFrontmatter("---\n__proto__:\n  - polluted\n---\nb").data;

    expect(Array.isArray(Object.getPrototypeOf(data))).toBe(false);
  });

  test("keeps a body that itself contains a horizontal rule", () => {
    const source = "---\nteacher: X\n---\nfirst\n\n---\n\nsecond";

    expect(parseFrontmatter(source).body).toBe("first\n\n---\n\nsecond");
  });
});
