import { readFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";
import { RenderError } from "./errors";

export interface JobFiles {
  read(relativePath: string): Buffer;
}

export function jobFilesAt(jobDir: string): JobFiles {
  return {
    read(relativePath: string): Buffer {
      const target = normalize(join(jobDir, relativePath));
      const insideJob = relative(jobDir, target);

      if (insideJob.startsWith("..") || isAbsolute(insideJob)) {
        throw new RenderError(`Refusing to read "${relativePath}" outside the job directory`);
      }

      try {
        return readFileSync(target);
      } catch {
        throw new RenderError(`Cannot read "${relativePath}" from the job directory`);
      }
    },
  };
}
