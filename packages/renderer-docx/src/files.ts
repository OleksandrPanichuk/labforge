import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { RenderError } from "./errors";

export const MAX_FILE_BYTES = 32 * 1024 * 1024;

export interface JobFiles {
  read(relativePath: string): Buffer;
}

export function jobFilesAt(jobDir: string): JobFiles {
  const root = realpathSync(jobDir);

  return {
    read(relativePath: string): Buffer {
      const target = resolveInside(root, relativePath);
      const size = statSync(target).size;

      if (size > MAX_FILE_BYTES) {
        throw new RenderError(
          `"${relativePath}" is too large to embed (${size} bytes, limit ${MAX_FILE_BYTES})`,
        );
      }

      return readFileSync(target);
    },
  };
}

function resolveInside(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new RenderError(`Refusing to read "${relativePath}": paths must be relative to the job`);
  }

  let real: string;

  try {
    real = realpathSync(join(root, relativePath));
  } catch {
    throw new RenderError(`Cannot read "${relativePath}" from the job directory`);
  }

  const inside = relative(root, real);

  if (inside === "" || inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside)) {
    throw new RenderError(`Refusing to read "${relativePath}" from outside the job directory`);
  }

  return real;
}
