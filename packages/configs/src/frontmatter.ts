import { parse } from "yaml";
import { z } from "zod";
import { ConfigError } from "./errors";

export type FrontmatterValue = string | string[];

export interface Frontmatter {
  data: Record<string, FrontmatterValue>;
  body: string;
}

const DELIMITER = "---";
const FIELD_LINE_RE = /^[A-Za-z_][\w-]*\s*:/m;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const fieldSchema = z.union([
  z.string(),
  z.number().transform(String),
  z.boolean().transform(String),
  z.array(z.union([z.string(), z.number().transform(String)])),
]);

export function parseFrontmatter(source: string): Frontmatter {
  const lines = source.split(/\r?\n/);

  if (lines[0]?.trim() !== DELIMITER) {
    return { data: {}, body: source };
  }

  const closing = lines.findIndex((line, index) => index > 0 && line === DELIMITER);

  if (closing === -1) {
    return { data: {}, body: source };
  }

  const block = lines.slice(1, closing).join("\n");
  const parsed = parseYaml(block);

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    if (FIELD_LINE_RE.test(block)) {
      throw new ConfigError(
        "The frontmatter block could not be read as YAML; fix it rather than letting the fields be ignored",
      );
    }

    return { data: {}, body: source };
  }

  return {
    data: toFields(parsed),
    body: lines.slice(closing + 1).join("\n"),
  };
}

function toFields(parsed: object): Record<string, FrontmatterValue> {
  const data: Record<string, FrontmatterValue> = Object.create(null) as Record<
    string,
    FrontmatterValue
  >;

  for (const [key, value] of Object.entries(parsed)) {
    const field = fieldSchema.safeParse(value);

    if (!UNSAFE_KEYS.has(key) && field.success) {
      data[key] = field.data;
    }
  }

  return data;
}

function parseYaml(block: string): unknown {
  try {
    return parse(block, { merge: false });
  } catch {
    return null;
  }
}
