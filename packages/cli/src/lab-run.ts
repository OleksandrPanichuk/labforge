import { existsSync } from "node:fs";
import { basename } from "node:path";
import { claudeSession, createAgentRunner } from "@labforge/agent";
import { createJobStore, JOB_STATES, type JobState } from "@labforge/jobs";
import { createLogger, type Logger, withContext } from "@labforge/logger";
import { type RunResult, runJob } from "@labforge/orchestrator";
import { DockerodeEngine, type Runtime, runInSandbox, runtimeFor } from "@labforge/sandbox";
import { createDispatcher } from "./dispatch";

export interface LabRunOptions {
  taskPath: string;
  subject?: string;
  teacher?: string;
  variant?: string;
  language: string;
  jobId: string;
  jobsDir: string;
  configsDir: string;
  agentsDir: string;
  stopBefore?: JobState;
  logger?: Logger;
}

export interface ParsedArgs extends Omit<LabRunOptions, "logger"> {}

const DEFAULTS = {
  jobsDir: "jobs",
  configsDir: "configs",
  agentsDir: "agents",
  language: "python",
  stopBefore: "HUMAN_REVIEW" as JobState,
};

export function parseArgs(argv: string[], now: () => string = () => `${Date.now()}`): ParsedArgs {
  const flags = new Map<string, string>();
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";

    if (argument.startsWith("--")) {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} needs a value`);
      }

      flags.set(argument.slice(2), value);
      index += 1;
      continue;
    }

    positional.push(argument);
  }

  const taskPath = positional[0];

  if (taskPath === undefined) {
    throw new Error(
      "Usage: bun run lab:run <task-file> --subject <subject> [--teacher <name>] [--variant <n>] [--language python]",
    );
  }

  return {
    taskPath,
    subject: flags.get("subject"),
    teacher: flags.get("teacher"),
    variant: flags.get("variant"),
    language: flags.get("language") ?? DEFAULTS.language,
    jobId: flags.get("job") ?? `lab-${slug(basename(taskPath))}-${now()}`,
    jobsDir: flags.get("jobs-dir") ?? DEFAULTS.jobsDir,
    configsDir: flags.get("configs-dir") ?? DEFAULTS.configsDir,
    agentsDir: flags.get("agents-dir") ?? DEFAULTS.agentsDir,
    stopBefore: stopBefore(flags.get("stop-before")),
  };
}

export async function labRun(options: LabRunOptions): Promise<RunResult> {
  const runtime = runtimeFor(options.language);
  const store = createJobStore(options.jobsDir);
  const job = store.openJob(options.jobId, { create: true });

  if (job.readCheckpoint()?.state === "INGEST" && !existsSync(options.taskPath)) {
    throw new Error(`No task file at ${options.taskPath}`);
  }
  const logger = withContext(options.logger ?? createLogger({ service: "cli" }), {
    jobId: job.id,
  });

  logger.info({ task: options.taskPath, language: runtime.id }, "lab accepted");

  const agents = createDispatcher({
    agent: createAgentRunner({
      agentsDir: options.agentsDir,
      session: claudeSession({ jobDir: job.dir, runtime }),
      language: runtime.id,
      context: { subject: options.subject ?? "unknown" },
    }),
    configsDir: options.configsDir,
    taskPath: options.taskPath,
    subject: options.subject,
    teacher: options.teacher,
    variant: options.variant,
    runtime,
    cells: cellRunner(job.dir, runtime),
  });

  const result = await runJob({ job, agents, stopBefore: options.stopBefore, logger });

  logger.info({ state: result.state, reason: result.reason }, "lab stopped");

  return result;
}

export function cellRunner(jobDir: string, runtime: Runtime) {
  const engine = new DockerodeEngine();

  return {
    run: (cellRef: string) =>
      runInSandbox({ runtime: runtime.id, cmd: runtime.cellCommand(cellRef), jobDir }, engine),
  };
}

function stopBefore(value: string | undefined): JobState {
  if (value === undefined) {
    return DEFAULTS.stopBefore;
  }

  if (!(JOB_STATES as readonly string[]).includes(value)) {
    throw new Error(`--stop-before must be one of: ${JOB_STATES.join(", ")}`);
  }

  return value as JobState;
}

function slug(name: string): string {
  const ascii = name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "");

  return ascii === "" ? "job" : ascii;
}
