import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ConfigFiles {
  exists(relativePath: string): boolean;
  read(relativePath: string): string;
  listDirectories(relativePath: string): string[];
}

export function configFilesAt(configsDir: string): ConfigFiles {
  return {
    exists: (relativePath) => existsSync(join(configsDir, relativePath)),
    read: (relativePath) => readFileSync(join(configsDir, relativePath), "utf8"),
    listDirectories(relativePath) {
      const target = join(configsDir, relativePath);

      if (!existsSync(target)) {
        return [];
      }

      return readdirSync(target, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    },
  };
}
