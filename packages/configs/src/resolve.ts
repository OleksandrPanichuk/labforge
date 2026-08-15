import type { ConfigFiles } from "./files";
import { parseFrontmatter } from "./frontmatter";

export const REQUIREMENTS_FILE = "REQUIREMENTS.md";
export const STYLE_GUIDE_FILE = "STYLE_GUIDE.md";

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

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export function resolveConfigs(request: ResolveRequest, files: ConfigFiles): ResolvedConfigs {
  const requirements = layersOf(REQUIREMENTS_FILE, request, files);
  const styleGuide = layersOf(STYLE_GUIDE_FILE, request, files);

  return {
    requirements: merge(REQUIREMENTS_FILE, requirements, files),
    styleGuide: merge(STYLE_GUIDE_FILE, styleGuide, files),
    sources: { requirements, styleGuide },
  };
}

export function findTeacherSlug(name: string, files: ConfigFiles): string | undefined {
  const wanted = normalise(name);

  return files
    .listDirectories("teachers")
    .find((slug) => normalise(slug) === wanted || declaredNames(slug, files).includes(wanted));
}

function layersOf(file: string, request: ResolveRequest, files: ConfigFiles): string[] {
  const candidates = [file];

  if (request.subject !== undefined) {
    candidates.push(`subjects/${request.subject}/${file}`);
  }

  if (request.teacher !== undefined) {
    candidates.push(`teachers/${request.teacher}/${file}`);

    if (request.subject !== undefined) {
      candidates.push(`teachers/${request.teacher}/subjects/${request.subject}/${file}`);
    }
  }

  const present = candidates.filter((path) => files.exists(path));

  if (present.length === 0) {
    throw new ConfigError(`No ${file} found; the base configs/${file} is required`);
  }

  return present;
}

function merge(file: string, paths: string[], files: ConfigFiles): string {
  const sections = paths.map((path, index) => {
    const body = parseFrontmatter(files.read(path)).body.trim();
    const rank = index === paths.length - 1 && paths.length > 1 ? " (highest priority)" : "";

    return `<!-- ${path}${rank} -->\n\n${body}`;
  });

  return [header(file, paths), ...sections].join("\n\n");
}

function header(file: string, paths: string[]): string {
  if (paths.length === 1) {
    return `# ${file}`;
  }

  return [
    `# ${file}`,
    "",
    "Layers are ordered from general to specific. When two layers conflict, the later one",
    `wins; the last layer below has the highest priority (${paths[paths.length - 1]}).`,
  ].join("\n");
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
  return value.trim().toLowerCase();
}
