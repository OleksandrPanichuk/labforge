import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const IDENTITY = [
  "-c",
  "user.name=LabForge",
  "-c",
  "user.email=labforge@localhost",
  "-c",
  "commit.gpgsign=false",
];

export interface JobGit {
  init(): void;
  isRepository(): boolean;
  commit(message: string): boolean;
  log(): string[];
}

export function jobGitAt(dir: string): JobGit {
  const run = (args: string[]): string =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  return {
    init() {
      if (!existsSync(join(dir, ".git"))) {
        run(["init", "-q", "-b", "main"]);
      }
    },
    isRepository: () => existsSync(join(dir, ".git")),
    commit(message) {
      run(["add", "-A"]);

      if (run(["status", "--porcelain"]).trim() === "") {
        return false;
      }

      run([...IDENTITY, "commit", "-q", "-m", message]);

      return true;
    },
    log: () =>
      run(["log", "--format=%s"])
        .split("\n")
        .filter((line) => line !== ""),
  };
}
