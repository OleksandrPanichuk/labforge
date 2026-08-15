import type { AgentOutcome, AgentRequest, AgentRunner } from "@labforge/orchestrator";
import { readFindings } from "./findings";
import { agentForState, fill, loadPrompt } from "./prompts";
import type { Session } from "./session";

export interface AgentRunnerOptions {
  agentsDir: string;
  session: Session;
  language: string;
  context?: Record<string, string>;
  revision?: RevisionContext;
}

export interface RevisionContext {
  userComment: string;
  blockIds?: string;
  quotedText?: string;
  codeRef?: string;
  selection?: string;
}

export function createAgentRunner(options: AgentRunnerOptions): AgentRunner {
  return {
    async run(request: AgentRequest): Promise<AgentOutcome> {
      const agent = agentForState(request.state);

      if (agent === undefined) {
        throw new Error(`State ${request.state} is not agent work`);
      }

      const prompt = loadPrompt(options.agentsDir, agent);
      const systemPrompt = fill(prompt.body, placeholders(request, options));

      const send = (resume?: string) =>
        options.session.run({
          prompt: `Continue the lab in state ${request.state}.`,
          systemPrompt,
          allowedTools: prompt.allowedTools,
          cwd: request.job.dir,
          ...(resume !== undefined && resume !== "" && { resume }),
        });

      let result = await send(request.resumeSessionId);

      if (result.status === "failed" && request.resumeSessionId !== undefined) {
        result = await send(undefined);
      }

      if (result.status === "rate_limited") {
        return { status: "rate_limited", sessionId: result.sessionId, resumeAt: result.resetsAt };
      }

      if (result.status === "failed") {
        return {
          status: "failed",
          sessionId: result.sessionId,
          error: result.error ?? result.text,
        };
      }

      if (result.question !== undefined) {
        return { status: "needs_user", sessionId: result.sessionId, question: result.question };
      }

      return completed(request, result.sessionId);
    },
  };
}

function placeholders(request: AgentRequest, options: AgentRunnerOptions): Record<string, string> {
  const previous = Object.values(request.checkpoint.lastFindings ?? {}).flat();

  return {
    jobDir: request.job.dir,
    language: options.language,
    subject: options.context?.subject ?? "unknown",
    methodichkaPath: "(none)",
    similarLabs: "(none)",
    sandboxImage: options.language,
    prevFindings: previous.length === 0 ? "(none)" : previous.join(", "),
    blockIds: "(none)",
    quotedText: "(none)",
    codeRef: "(none)",
    selection: "(none)",
    ...options.context,
    ...(options.revision ?? {}),
  };
}

function completed(request: AgentRequest, sessionId: string): AgentOutcome {
  try {
    const findings = readFindings(request.job.dir, request.state);

    return { status: "completed", sessionId, ...(findings !== undefined && { findings }) };
  } catch (error) {
    return {
      status: "failed",
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
