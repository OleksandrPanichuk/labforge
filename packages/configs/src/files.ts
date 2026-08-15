import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { ConfigError } from "./errors";

export interface ConfigFiles {
  exists(relativePath: string): boolean;
  read(relativePath: string): string;
  listDirectories(relativePath: string): string[];
}

function canonical(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

export function configFilesAt(configsDir: string): ConfigFiles {
  const root = canonical(resolve(configsDir));

  const inside = (relativePath: string): string => {
    const target = resolve(root, relativePath);
    const real = canonical(target);

    if (real !== root && !real.startsWith(root + sep)) {
      throw new ConfigError(`Refusing to read "${relativePath}" from outside ${root}`);
    }

    return target;
  };

  return {
    exists(relativePath) {
      try {
        return statSync(inside(relativePath)).isFile();
      } catch (error) {
        if (error instanceof ConfigError) {
          throw error;
        }

        return false;
      }
    },
    read: (relativePath) => readFileSync(inside(relativePath), "utf8"),
    listDirectories(relativePath) {
      try {
        return readdirSync(inside(relativePath), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
      } catch (error) {
        if (error instanceof ConfigError) {
          throw error;
        }

        return [];
      }
    },
  };
}
