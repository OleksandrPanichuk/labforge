import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { FileProbe, ReportIR } from "@labforge/ir";

export const MAX_PROBE_BYTES = 32 * 1024 * 1024;

export function jobProbe(jobDir: string, pending: Set<string> = new Set()): FileProbe {
  const root = realpathSync(jobDir);

  const inside = (relativePath: string): string | undefined => {
    if (isAbsolute(relativePath)) {
      return undefined;
    }

    let real: string;

    try {
      real = realpathSync(join(root, relativePath));
    } catch {
      return undefined;
    }

    const within = relative(root, real);

    return within === "" || within.startsWith(`..${sep}`) || within === ".." || isAbsolute(within)
      ? undefined
      : real;
  };

  const regularFile = (relativePath: string): string | undefined => {
    const target = inside(relativePath);

    if (target === undefined) {
      return undefined;
    }

    const stats = statSync(target);

    return stats.isFile() && stats.size <= MAX_PROBE_BYTES ? target : undefined;
  };

  return {
    exists: (relativePath) => pending.has(relativePath) || regularFile(relativePath) !== undefined,
    countLines(relativePath) {
      const target = regularFile(relativePath);

      if (target === undefined) {
        return 0;
      }

      return readFileSync(target, "utf8")
        .replace(/\r?\n$/, "")
        .split(/\r?\n/).length;
    },
  };
}

export function generatedArtifacts(document: ReportIR): Set<string> {
  const pending = new Set<string>();

  for (const block of document.blocks) {
    if (block.type === "image" && block.provenance.kind !== "web") {
      pending.add(block.src);
    }
  }

  return pending;
}
