import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { createLogger, type Logger } from "@labforge/logger";
import {
  DockerodeEngine,
  type Runtime,
  runInSandbox,
  type SandboxEngine,
  SandboxTimeoutError,
} from "@labforge/sandbox";
import { z } from "zod";
import { failureFrom, rateLimitFrom, sessionIdFrom, textFrom } from "./messages";
import type { Session, SessionRequest, SessionResult } from "./session";

export const TOOL_SERVER = "labforge";

export interface ClaudeSessionOptions {
  jobDir: string;
  runtime: Runtime;
  engine?: SandboxEngine;
  logger?: Logger;
  model?: string;
  maxTurns?: number;
}

export function claudeSession(options: ClaudeSessionOptions): Session {
  const logger = options.logger ?? createLogger({ service: "core" });
  const engine = options.engine ?? new DockerodeEngine();

  return {
    async run(request: SessionRequest): Promise<SessionResult> {
      const asked: string[] = [];
      const servers = { [TOOL_SERVER]: labforgeTools(options, engine, asked, logger) };
      const stream = {
        sessionId: "",
        text: "",
        limited: undefined,
        failure: undefined,
        ended: false,
      } as Collected;

      try {
        for await (const message of query({
          prompt: request.prompt,
          options: { ...sessionOptions(request, options), mcpServers: servers },
        })) {
          collect(stream, message);
        }
      } catch (error) {
        return {
          sessionId: stream.sessionId,
          status: "failed",
          text: stream.text,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      return settle(stream, asked[0]);
    },
  };
}

interface Collected {
  sessionId: string;
  text: string;
  limited?: { resetsAt?: string };
  failure?: string;
  ended: boolean;
}

function collect(stream: Collected, message: unknown): void {
  stream.sessionId = sessionIdFrom(message) ?? stream.sessionId;
  stream.text += textFrom(message);
  stream.limited = rateLimitFrom(message) ?? stream.limited;

  if ((message as { type?: string }).type === "result") {
    stream.ended = true;
    stream.failure = failureFrom(message);
  }
}

function settle(stream: Collected, question?: string): SessionResult {
  const base = { sessionId: stream.sessionId, text: stream.text };

  if (stream.limited !== undefined) {
    return { ...base, status: "rate_limited", resetsAt: stream.limited.resetsAt };
  }

  if (!stream.ended) {
    return { ...base, status: "failed", error: "the session ended with no result" };
  }

  if (stream.failure !== undefined) {
    return { ...base, status: "failed", error: stream.failure };
  }

  return { ...base, status: "completed", question };
}

export function sessionOptions(
  request: SessionRequest,
  options: Pick<ClaudeSessionOptions, "model" | "maxTurns"> = {},
) {
  return {
    cwd: request.cwd,
    systemPrompt: request.systemPrompt,
    tools: request.allowedTools,
    allowedTools: request.allowedTools,
    settingSources: [] as [],
    permissionMode: "bypassPermissions" as const,
    ...(options.model !== undefined && { model: options.model }),
    ...(options.maxTurns !== undefined && { maxTurns: options.maxTurns }),
    ...(request.resume !== undefined && request.resume !== "" && { resume: request.resume }),
  };
}

function labforgeTools(
  options: ClaudeSessionOptions,
  engine: SandboxEngine,
  asked: string[],
  logger: Logger,
) {
  return createSdkMcpServer({
    name: TOOL_SERVER,
    version: "1.0.0",
    tools: [
      tool(
        "ask_user",
        "Ask the student something that cannot be found in the files. Ends your turn.",
        { question: z.string().min(1) },
        (args) => {
          asked.push(args.question);
          logger.info({ question: args.question }, "agent asked the student");

          return Promise.resolve({
            content: [
              {
                type: "text" as const,
                text: "The question was sent. Stop now; you will be resumed with the answer.",
              },
            ],
          });
        },
      ),
      tool(
        "run_in_sandbox",
        "Run a file from this job in the sandbox and return its output.",
        { path: z.string().min(1), args: z.array(z.string()).optional() },
        async (args) => {
          const result = await execute(options, engine, args.path, args.args ?? []);

          return { content: [{ type: "text" as const, text: result }] };
        },
      ),
    ],
  });
}

async function execute(
  options: ClaudeSessionOptions,
  engine: SandboxEngine,
  path: string,
  args: string[],
): Promise<string> {
  try {
    const result = await runInSandbox(
      {
        runtime: options.runtime.id,
        cmd: [...options.runtime.cellCommand(path), ...args],
        jobDir: options.jobDir,
      },
      engine,
    );

    return [
      `exit code: ${result.exitCode}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ].join("\n");
  } catch (error) {
    if (error instanceof SandboxTimeoutError) {
      return `The run was killed after ${error.timeoutMs} ms.`;
    }

    return `The run could not start: ${error instanceof Error ? error.message : String(error)}`;
  }
}
