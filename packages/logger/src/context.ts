export interface LogContext {
  jobId?: string;
  userId?: string;
  tgId?: number;
  state?: string;
  agent?: string;
  sessionId?: string;
  cellRef?: string;
  runId?: string;
  queueJobId?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export type ServiceName = "core" | "tg-bot" | "web" | "cli" | "queue";
