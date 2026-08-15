import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJobStore, type Job } from "@labforge/jobs";
import type { AgentOutcome, AgentRequest, AgentRunner } from "@labforge/orchestrator";
import { runJob } from "@labforge/orchestrator";
import { DockerodeEngine, RUNTIMES, resolveDockerSocket, runInSandbox } from "@labforge/sandbox";
import { createDispatcher } from "./dispatch";

const dockerAvailable = resolveDockerSocket() !== undefined;
const IMAGE = process.env.LABFORGE_TEST_IMAGE ?? "python:3.12-slim";

let root: string;
let job: Job;

const REPORT = {
  version: 1,
  meta: {
    labId: "lab_1",
    subject: "numeric-methods",
    title: "Лабораторна робота №1",
    student: { name: "Панічук О.", group: "ІП-21" },
    language: "uk",
  },
  page: { size: "A4", marginsMm: { top: 20, right: 10, bottom: 20, left: 20 }, pageNumbers: true },
  styles: { default: { font: "Times New Roman", size: 14, lineHeight: 1.5 } },
  blocks: [
    { id: "blk_1", type: "heading", level: 1, text: "РЕЗУЛЬТАТИ" },
    { id: "blk_2", type: "paragraph", text: "Максимальна похибка склала {{v:err_max}}." },
  ],
  values: { err_max: { cellRef: "cells/metrics.py", format: "sci:2" } },
  explanations: {},
};

function scriptedAgent(): AgentRunner {
  return {
    run(request: AgentRequest): Promise<AgentOutcome> {
      if (request.state === "SOLVE") {
        writeFileSync(
          join(request.job.dir, "src", "solver.py"),
          "def max_error(values):\n    return max(abs(v) for v in values)\n",
          "utf8",
        );
      }

      if (request.state === "IR_WRITE") {
        writeFileSync(
          join(request.job.dir, "cells", "metrics.py"),
          'import json\nfrom src.solver import max_error\nprint(json.dumps({"err_max": max_error([1e-6, -3.2e-6])}))',
          "utf8",
        );
        writeFileSync(request.job.reportPath, JSON.stringify(REPORT, null, 2), "utf8");
      }

      if (request.state === "CODE_REVIEW" || request.state === "REPORT_REVIEW") {
        const file = request.state === "CODE_REVIEW" ? "findings.json" : "report-findings.json";
        writeFileSync(join(request.job.dir, "review", file), "[]", "utf8");
      }

      return Promise.resolve({ status: "completed", sessionId: `session-${request.state}` });
    },
  };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-e2e-")));
  job = createJobStore(join(root, "jobs")).createJob("job_1");

  mkdirSync(join(root, "configs"), { recursive: true });
  writeFileSync(join(root, "configs", "REQUIREMENTS.md"), "base requirements");
  writeFileSync(join(root, "configs", "STYLE_GUIDE.md"), "base styles");
  writeFileSync(join(root, "task.md"), "# Лабораторна 1\n\nОбчислити похибку.");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test.skipIf(!dockerAvailable)(
  "a lab runs from task file to docx without the web",
  async () => {
    const engine = new DockerodeEngine();
    const agents = createDispatcher({
      agent: scriptedAgent(),
      configsDir: join(root, "configs"),
      taskPath: join(root, "task.md"),
      subject: "numeric-methods",
      runtime: RUNTIMES.python,
      cells: {
        run: (cellRef) =>
          runInSandbox(
            {
              image: IMAGE,
              runtime: "python",
              cmd: RUNTIMES.python.cellCommand(cellRef),
              jobDir: job.dir,
            },
            engine,
          ),
      },
    });

    const result = await runJob({ job, agents, stopBefore: "HUMAN_REVIEW" });

    expect(result.state).toBe("HUMAN_REVIEW");

    expect(readFileSync(join(job.dir, "task.md"), "utf8")).toContain("Обчислити");
    expect(readFileSync(join(job.dir, "context", "requirements.md"), "utf8")).toContain("base");

    const report = JSON.parse(readFileSync(job.reportPath, "utf8"));
    expect(report.values.err_max.value).toBe("3,20e-6");
    expect(report.values.err_max.runRef).toBe("runs/cells-metrics-py.json");

    expect(existsSync(join(job.dir, "report.docx"))).toBe(true);
    expect(existsSync(join(job.dir, "runs", "cells-metrics-py.json"))).toBe(true);

    const history = job.git.log();
    expect(history).toContain("checkpoint: RESOLVE");
    expect(job.readCheckpoint()?.sessionIds.SOLVE).toBe("session-SOLVE");
  },
  300_000,
);
