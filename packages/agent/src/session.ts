export interface SessionRequest {
  prompt: string;
  systemPrompt: string;
  allowedTools: string[];
  cwd: string;
  resume?: string;
}

export interface SessionResult {
  sessionId: string;
  status: "completed" | "rate_limited" | "failed";
  text: string;
  question?: string;
  resetsAt?: string;
  error?: string;
}

export interface Session {
  run(request: SessionRequest): Promise<SessionResult>;
}
