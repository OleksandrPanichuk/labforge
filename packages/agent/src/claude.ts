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
import { rateLimitFrom, sessionIdFrom, textFrom } from "./messages";
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

      let sessionId = "";
      let text = "";
      let limited: { resetsAt?: string } | undefined;

      try {
        for await (const message of query({
          prompt: request.prompt,
          options: {
            cwd: request.cwd,
            systemPrompt: request.systemPrompt,
            allowedTools: request.allowedTools,
            mcpServers: servers,
            ...(options.model !== undefined && { model: options.model }),
            ...(options.maxTurns !== undefined && { maxTurns: options.maxTurns }),
            ...(request.resume !== undefined && { resume: request.resume }),
          },
        })) {
          sessionId = sessionIdFrom(message) ?? sessionId;
          text += textFrom(message);
          limited = rateLimitFrom(message) ?? limited;
        }
      } catch (error) {
        return {
          sessionId,
          status: "failed",
          text,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (limited !== undefined) {
        return { sessionId, status: "rate_limited", text, resetsAt: limited.resetsAt };
      }

      return { sessionId, status: "completed", text, question: asked[0] };
    },
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
