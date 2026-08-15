import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { configFilesAt, findTeacherSlug, resolveConfigs } from "@labforge/configs";
import { ingestDocument } from "@labforge/ingest";
import type { Job } from "@labforge/jobs";
import type { AgentOutcome, AgentRequest, AgentRunner } from "@labforge/orchestrator";
import { BuildError, buildReport } from "@labforge/pipeline";
import type { CellRunner } from "@labforge/resolver";
import type { Runtime } from "@labforge/sandbox";

export interface DispatcherOptions {
  agent: AgentRunner;
  configsDir: string;
  taskPath: string;
  subject?: string;
  teacher?: string;
  runtime: Runtime;
  cells: CellRunner;
}

const AGENT_STATES = new Set([
  "CONTEXT",
  "SOLVE",
  "CODE_REVIEW",
  "FIX",
  "IR_WRITE",
  "IR_FIX",
  "REPORT_REVIEW",
  "DEFENSE_PREP",
  "REVISION",
]);

export function createDispatcher(options: DispatcherOptions): AgentRunner {
  return {
    run(request: AgentRequest): Promise<AgentOutcome> {
      if (AGENT_STATES.has(request.state)) {
        return options.agent.run(request);
      }

      if (request.state === "INGEST") {
        return ingest(options, request);
      }

      if (request.state === "RESOLVE" || request.state === "BUILD") {
        return build(options, request);
      }

      return Promise.resolve({
        status: "failed",
        sessionId: "",
        error: `No handler for state ${request.state}`,
      });
    },
  };
}

async function ingest(options: DispatcherOptions, request: AgentRequest): Promise<AgentOutcome> {
  try {
    await writeTask(options.taskPath, request.job);
    writeContext(options, request.job);

    return { status: "completed", sessionId: "" };
  } catch (error) {
    return {
      status: "failed",
      sessionId: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writeTask(taskPath: string, job: Job): Promise<void> {
  const target = join(job.dir, "task.md");

  if (taskPath.endsWith(".md")) {
    copyFileSync(taskPath, target);

    return;
  }

  const result = await ingestDocument({ name: basename(taskPath), bytes: readFileSync(taskPath) });

  writeFileSync(target, result.markdown, "utf8");
}

function writeContext(options: DispatcherOptions, job: Job): void {
  const files = configFilesAt(options.configsDir);
  const teacher =
    options.teacher === undefined
      ? undefined
      : (findTeacherSlug(options.teacher, files) ?? options.teacher);
  const resolved = resolveConfigs({ subject: options.subject, teacher }, files);

  writeFileSync(join(job.dir, "context", "requirements.md"), resolved.requirements, "utf8");
  writeFileSync(join(job.dir, "context", "style_guide.md"), resolved.styleGuide, "utf8");
  writeFileSync(
    join(job.dir, "context", "sources.json"),
    `${JSON.stringify(resolved.sources, null, 2)}\n`,
    "utf8",
  );
}

async function build(options: DispatcherOptions, request: AgentRequest): Promise<AgentOutcome> {
  try {
    await buildReport({
      job: request.job,
      cells: options.cells,
      mode: request.state === "RESOLVE" ? "resolve" : "render",
    });

    return { status: "completed", sessionId: "" };
  } catch (error) {
    if (!(error instanceof BuildError)) {
      return { status: "failed", sessionId: "", error: String(error) };
    }

    return {
      status: "failed",
      sessionId: "",
      error: `${error.stage}: ${error.message}`,
      fixIn: error.stage === "resolve" ? "FIX" : "IR_FIX",
    };
  }
}
