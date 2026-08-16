import { existsSync } from "node:fs";
import { basename } from "node:path";
import { claudeSession, createAgentRunner } from "@labforge/agent";
import { configFilesAt, readStudentProfile } from "@labforge/configs";
import { JOB_STATES, type JobState } from "@labforge/jobs";
import { createLogger, type Logger, withContext } from "@labforge/logger";
import { type RunResult, runJob } from "@labforge/orchestrator";
import { DockerodeEngine, type Runtime, runInSandbox, runtimeFor } from "@labforge/sandbox";
import { prepareJob } from "./answer";
import { createDispatcher } from "./dispatch";

export interface LabRunOptions {
  taskPath: string;
  subject?: string;
  teacher?: string;
  variant?: string;
  answer?: string;
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

function splitArgv(argv: string[]): { flags: Map<string, string>; positional: string[] } {
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

  return { flags, positional };
}

export function parseArgs(argv: string[], now: () => string = () => `${Date.now()}`): ParsedArgs {
  const { flags, positional } = splitArgv(argv);

  const answer = flags.get("answer");
  const named = flags.get("job");
  const taskPath = positional[0] ?? (answer === undefined ? undefined : "");

  if (answer !== undefined && named === undefined) {
    throw new Error("--answer needs --job <id> so the answer reaches the right lab");
  }

  if (taskPath === undefined) {
    throw new Error(
      "Usage: bun run lab:run <task-file> --subject <subject> [--teacher <name>] [--variant <n>] [--language python]\n" +
        "       bun run lab:run --job <id> --answer <text>",
    );
  }

  return {
    taskPath,
    ...(answer !== undefined && { answer }),
    subject: flags.get("subject"),
    teacher: flags.get("teacher"),
    variant: flags.get("variant"),
    language: flags.get("language") ?? DEFAULTS.language,
    jobId: named ?? `lab-${slug(basename(taskPath))}-${now()}`,
    jobsDir: flags.get("jobs-dir") ?? DEFAULTS.jobsDir,
    configsDir: flags.get("configs-dir") ?? DEFAULTS.configsDir,
    agentsDir: flags.get("agents-dir") ?? DEFAULTS.agentsDir,
    stopBefore: stopBefore(flags.get("stop-before")),
  };
}

export async function labRun(options: LabRunOptions): Promise<RunResult> {
  const runtime = runtimeFor(options.language);
  const job = prepareJob({
    jobsDir: options.jobsDir,
    jobId: options.jobId,
    ...(options.answer !== undefined && { answer: options.answer }),
  });

  if (job.readCheckpoint()?.state === "INGEST" && !existsSync(options.taskPath)) {
    throw new Error(`No task file at ${options.taskPath}`);
  }
  const logger = withContext(options.logger ?? createLogger({ service: "cli" }), {
    jobId: job.id,
  });

  readStudentProfile(configFilesAt(options.configsDir), {
    ...(options.variant !== undefined && { variant: options.variant }),
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
    logger,
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
