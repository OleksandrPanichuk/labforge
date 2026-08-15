import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PINNED_CONFIG = [
  "-c",
  "user.name=LabForge",
  "-c",
  "user.email=labforge@localhost",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.excludesFile=",
  "-c",
  "core.hooksPath=",
  "-c",
  "init.templateDir=",
];

export class JobGitError extends Error {
  constructor(
    readonly command: string,
    readonly detail: string,
  ) {
    super(`git ${command} failed: ${detail}`);
    this.name = new.target.name;
  }
}

export interface JobGit {
  init(): void;
  isRepository(): boolean;
  commit(message: string): boolean;
  log(): string[];
}

export function jobGitAt(dir: string): JobGit {
  const gitDir = join(dir, ".git");

  const run = (args: string[]): string => {
    try {
      return execFileSync(
        "git",
        ["--git-dir", gitDir, "--work-tree", dir, ...PINNED_CONFIG, ...args],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      throw new JobGitError(args[0] ?? "", detailOf(error));
    }
  };

  const isRepository = (): boolean => existsSync(gitDir);

  return {
    init() {
      if (isRepository()) {
        return;
      }

      try {
        execFileSync("git", [...PINNED_CONFIG, "init", "-q", "-b", "main", dir], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        throw new JobGitError("init", detailOf(error));
      }
    },
    isRepository,
    commit(message) {
      run(["add", "-A", "--", "."]);

      if (run(["status", "--porcelain"]).trim() === "") {
        return false;
      }

      run(["commit", "-q", "-m", message]);

      return true;
    },
    log() {
      try {
        run(["rev-parse", "--verify", "HEAD"]);
      } catch {
        return [];
      }

      return run(["log", "--format=%s"])
        .split("\n")
        .filter((line) => line !== "");
    },
  };
}

export function readCommittedFile(dir: string, path: string): string | undefined {
  try {
    return execFileSync("git", ["--git-dir", join(dir, ".git"), "show", `HEAD:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return undefined;
  }
}

function detailOf(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr;

  return (stderr ?? (error instanceof Error ? error.message : String(error))).trim();
}
