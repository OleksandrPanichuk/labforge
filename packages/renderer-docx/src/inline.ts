import type { ValueEntry } from "@labforge/ir";
import { InlineMarkupError, UnresolvedValueError } from "./errors";

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  subscript?: boolean;
  superscript?: boolean;
  explanationId?: string;
}

type Marker = "b" | "i" | "u" | "sub" | "sup" | "span";

const MARKER_FLAGS: Record<Exclude<Marker, "span">, keyof InlineRun> = {
  b: "bold",
  i: "italic",
  u: "underline",
  sub: "subscript",
  sup: "superscript",
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

const TOKEN_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
const PLACEHOLDER_RE = /\{\{v:([\w-]+)\}\}/g;
const PLACEHOLDER_START_RE = /\{\{\s*v\s*:/;
const DATA_X_RE = /data-x="([\w-]+)"/;

interface OpenTag {
  marker: Marker;
  explanationId?: string;
}

export function parseInline(text: string, values: Record<string, ValueEntry>): InlineRun[] {
  const runs: InlineRun[] = [];
  const stack: OpenTag[] = [];
  let cursor = 0;

  for (const match of text.matchAll(new RegExp(TOKEN_RE.source, "g"))) {
    const index = match.index ?? 0;
    pushRun(runs, text.slice(cursor, index), stack, values);
    applyTag(stack, match[0], match[1] ?? "", match[2] ?? "");
    cursor = index + match[0].length;
  }

  pushRun(runs, text.slice(cursor), stack, values);

  if (stack.length > 0) {
    throw new InlineMarkupError(`Unclosed tag <${stack[stack.length - 1]?.marker}>`);
  }

  return runs;
}

function applyTag(stack: OpenTag[], raw: string, name: string, attributes: string): void {
  const marker = asMarker(name, raw);

  if (!raw.startsWith("</")) {
    stack.push({ marker, explanationId: explanationIdOf(marker, attributes) });
    return;
  }

  const open = stack.pop();

  if (open?.marker !== marker) {
    throw new InlineMarkupError(`Mismatched closing tag ${raw}`);
  }
}

function asMarker(name: string, raw: string): Marker {
  const lowered = name.toLowerCase();

  if (lowered in MARKER_FLAGS || lowered === "span") {
    return lowered as Marker;
  }

  throw new InlineMarkupError(`Tag ${raw} is not allowed in inline text`);
}

function explanationIdOf(marker: Marker, attributes: string): string | undefined {
  if (marker !== "span") {
    return undefined;
  }

  const id = DATA_X_RE.exec(attributes)?.[1];

  if (id === undefined) {
    throw new InlineMarkupError("<span> requires a data-x attribute");
  }

  return id;
}

function pushRun(
  runs: InlineRun[],
  raw: string,
  stack: OpenTag[],
  values: Record<string, ValueEntry>,
): void {
  const text = decodeEntities(substitute(raw, values));

  if (text === "") {
    return;
  }

  runs.push({ text, ...formatting(stack) });
}

function formatting(stack: OpenTag[]): Omit<InlineRun, "text"> {
  const format: Omit<InlineRun, "text"> = {};

  for (const tag of stack) {
    if (tag.marker === "span") {
      format.explanationId = tag.explanationId;
      continue;
    }

    Object.assign(format, { [MARKER_FLAGS[tag.marker]]: true });
  }

  return format;
}

function substitute(raw: string, values: Record<string, ValueEntry>): string {
  const substituted = raw.replace(new RegExp(PLACEHOLDER_RE.source, "g"), (_match, key: string) => {
    const resolved = values[key]?.value;

    if (resolved === undefined) {
      throw new UnresolvedValueError(key);
    }

    return resolved;
  });

  if (PLACEHOLDER_START_RE.test(substituted)) {
    throw new InlineMarkupError(
      `Malformed value placeholder in "${raw}"; a key may only contain letters, digits, _ and -`,
    );
  }

  return substituted;
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}
