import { z } from "zod";
import { ConfigError } from "./errors";
import type { ConfigFiles } from "./files";
import { parseFrontmatter } from "./frontmatter";

export const REQUIREMENTS_FILE = "REQUIREMENTS.md";
export const STYLE_GUIDE_FILE = "STYLE_GUIDE.md";

const SEGMENT_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
const COMMENT_OPEN_RE = /<!--/g;

const segmentSchema = z
  .string()
  .regex(SEGMENT_RE)
  .refine((value) => value !== "." && value !== "..");

export interface ResolveRequest {
  subject?: string;
  teacher?: string;
}

export interface ResolvedConfigs {
  requirements: string;
  styleGuide: string;
  sources: {
    requirements: string[];
    styleGuide: string[];
  };
}

export { ConfigError };

export function resolveConfigs(request: ResolveRequest, files: ConfigFiles): ResolvedConfigs {
  const subject = directorySegment("subjects", request.subject, files);
  const teacher = directorySegment("teachers", request.teacher, files);

  const requirements = layersOf(REQUIREMENTS_FILE, subject, teacher, files);
  const styleGuide = layersOf(STYLE_GUIDE_FILE, subject, teacher, files);

  return {
    requirements: merge(REQUIREMENTS_FILE, requirements, files),
    styleGuide: merge(STYLE_GUIDE_FILE, styleGuide, files),
    sources: { requirements, styleGuide },
  };
}

export function findTeacherSlug(name: string, files: ConfigFiles): string | undefined {
  const wanted = normalise(name);
  const matches = files
    .listDirectories("teachers")
    .filter((slug) => normalise(slug) === wanted || declaredNames(slug, files).includes(wanted));

  if (matches.length > 1) {
    throw new ConfigError(
      `"${name}" matches more than one teacher: ${matches.join(", ")}; make the aliases unique`,
    );
  }

  return matches[0];
}

function directorySegment(
  kind: "subjects" | "teachers",
  value: string | undefined,
  files: ConfigFiles,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!segmentSchema.safeParse(value).success) {
    throw new ConfigError(`"${value}" is not a valid ${kind} name`);
  }

  const present = files.listDirectories(kind);
  const sameName = present.find((name) => name.toLowerCase() === value.toLowerCase());

  if (sameName !== undefined && sameName !== value) {
    return undefined;
  }

  return value;
}

function layersOf(
  file: string,
  subject: string | undefined,
  teacher: string | undefined,
  files: ConfigFiles,
): string[] {
  if (!files.exists(file)) {
    throw new ConfigError(`The base ${file} is required and was not found`);
  }

  const candidates = [file];

  if (subject !== undefined) {
    candidates.push(`subjects/${subject}/${file}`);
  }

  if (teacher !== undefined) {
    candidates.push(`teachers/${teacher}/${file}`);

    if (subject !== undefined) {
      candidates.push(`teachers/${teacher}/subjects/${subject}/${file}`);
    }
  }

  return candidates.filter((path) => files.exists(path));
}

function merge(file: string, paths: string[], files: ConfigFiles): string {
  const sections = paths.map((path, index) => {
    const body = parseFrontmatter(files.read(path)).body.trim();

    return `## Layer ${index + 1} of ${paths.length} — ${path}\n\n${neutralise(body)}`;
  });

  return [header(file, paths), ...sections].join("\n\n");
}

function header(file: string, paths: string[]): string {
  const last = paths[paths.length - 1];

  if (paths.length === 1) {
    return `# ${file}`;
  }

  return [
    `# ${file}`,
    "",
    `Layers run from general to specific. Where two layers conflict the later one wins, so`,
    `layer ${paths.length} (${last}) has the highest priority.`,
  ].join("\n");
}

function neutralise(body: string): string {
  return body.replace(COMMENT_OPEN_RE, "<!‑-");
}

function declaredNames(slug: string, files: ConfigFiles): string[] {
  const names: string[] = [];

  for (const file of [REQUIREMENTS_FILE, STYLE_GUIDE_FILE]) {
    const path = `teachers/${slug}/${file}`;

    if (!files.exists(path)) {
      continue;
    }

    const { data } = parseFrontmatter(files.read(path));

    names.push(...valuesOf(data.teacher), ...valuesOf(data.aliases));
  }

  return names.map(normalise);
}

function valuesOf(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalise(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("uk");
}
