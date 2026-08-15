export type FrontmatterValue = string | string[];

export interface Frontmatter {
  data: Record<string, FrontmatterValue>;
  body: string;
}

const DELIMITER = "---";
const SCALAR_RE = /^([A-Za-z_][\w-]*):\s*(.*)$/;
const ITEM_RE = /^\s*-\s+(.*)$/;

export function parseFrontmatter(source: string): Frontmatter {
  const lines = source.split("\n");

  if (lines[0]?.trim() !== DELIMITER) {
    return { data: {}, body: source };
  }

  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === DELIMITER);

  if (closing === -1) {
    return { data: {}, body: source };
  }

  return {
    data: parseFields(lines.slice(1, closing)),
    body: lines.slice(closing + 1).join("\n"),
  };
}

function parseFields(lines: string[]): Record<string, FrontmatterValue> {
  const data: Record<string, FrontmatterValue> = {};
  let pending: string | undefined;

  for (const line of lines) {
    const item = ITEM_RE.exec(line);

    if (item?.[1] !== undefined && pending !== undefined) {
      appendItem(data, pending, unquote(item[1]));
      continue;
    }

    const scalar = SCALAR_RE.exec(line);

    if (scalar?.[1] === undefined) {
      continue;
    }

    const value = (scalar[2] ?? "").trim();
    pending = value === "" ? scalar[1] : undefined;

    if (value !== "") {
      data[scalar[1]] = parseValue(value);
    }
  }

  return data;
}

function appendItem(data: Record<string, FrontmatterValue>, key: string, value: string): void {
  const current = data[key];

  data[key] = Array.isArray(current) ? [...current, value] : [value];
}

function parseValue(value: string): FrontmatterValue {
  if (!(value.startsWith("[") && value.endsWith("]"))) {
    return unquote(value);
  }

  return value
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter((item) => item !== "");
}

function unquote(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length > 1 && /^(".*"|'.*')$/.test(trimmed)) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}
