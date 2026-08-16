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
import { settingsFor } from "./run-context";

export interface LabRunOptions {
  taskPath: string;
  subject?: string;
  teacher?: string;
  variant?: string;
  answer?: string;
  queue?: boolean;
  language?: string;
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
  stopBefore: "HUMAN_REVIEW" as JobState,
};

const BOOLEAN_FLAGS = new Set(["queue"]);

function splitArgv(argv: string[]): { flags: Map<string, string>; positional: string[] } {
  const flags = new Map<string, string>();
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";

    if (argument.startsWith("--")) {
      if (BOOLEAN_FLAGS.has(argument.slice(2))) {
        flags.set(argument.slice(2), "true");
        continue;
      }

      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--") || value.trim() === "") {
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
    queue: flags.get("queue") === "true",
    subject: flags.get("subject"),
    teacher: flags.get("teacher"),
    variant: flags.get("variant"),
    language: flags.get("language"),
    jobId: named ?? `lab-${slug(basename(taskPath))}-${now()}`,
    jobsDir: flags.get("jobs-dir") ?? DEFAULTS.jobsDir,
    configsDir: flags.get("configs-dir") ?? DEFAULTS.configsDir,
    agentsDir: flags.get("agents-dir") ?? DEFAULTS.agentsDir,
    stopBefore: stopBefore(flags.get("stop-before")),
  };
}

export async function labRun(options: LabRunOptions): Promise<RunResult> {
  const job = prepareJob({
    jobsDir: options.jobsDir,
    jobId: options.jobId,
    ...(options.answer !== undefined && { answer: options.answer }),
  });
  const settings = settingsFor(
    {
      ...(options.language !== undefined && { language: options.language }),
      ...(options.subject !== undefined && { subject: options.subject }),
      ...(options.teacher !== undefined && { teacher: options.teacher }),
      ...(options.variant !== undefined && { variant: options.variant }),
    },
    job.dir,
  );
  const runtime = runtimeFor(settings.language);

  if (job.readCheckpoint()?.state === "INGEST" && !existsSync(options.taskPath)) {
    throw new Error(`No task file at ${options.taskPath}`);
  }
  const logger = withContext(options.logger ?? createLogger({ service: "cli" }), {
    jobId: job.id,
  });

  readStudentProfile(configFilesAt(options.configsDir), {
    ...(settings.variant !== undefined && { variant: settings.variant }),
  });

  logger.info({ task: options.taskPath, language: runtime.id }, "lab accepted");

  const agents = createDispatcher({
    agent: createAgentRunner({
      agentsDir: options.agentsDir,
      session: claudeSession({ jobDir: job.dir, runtime }),
      language: runtime.id,
      context: { subject: settings.subject ?? "unknown" },
    }),
    configsDir: options.configsDir,
    taskPath: options.taskPath,
    subject: settings.subject,
    teacher: settings.teacher,
    variant: settings.variant,
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
