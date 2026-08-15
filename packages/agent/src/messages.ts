export interface RateLimitPause {
  resetsAt?: string;
}

export function sessionIdFrom(message: unknown): string | undefined {
  return (message as { session_id?: string }).session_id;
}

export function textFrom(message: unknown): string {
  const record = message as {
    type?: string;
    message?: { content?: { type: string; text?: string }[] };
  };

  if (record.type !== "assistant") {
    return "";
  }

  return (record.message?.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

export function rateLimitFrom(message: unknown): RateLimitPause | undefined {
  const record = message as {
    type?: string;
    rate_limit_info?: { status?: string; resetsAt?: number };
  };

  if (record.type !== "rate_limit_event" || record.rate_limit_info?.status !== "rejected") {
    return undefined;
  }

  const resetsAt = record.rate_limit_info.resetsAt;

  return { resetsAt: resetsAt === undefined ? undefined : new Date(resetsAt * 1000).toISOString() };
}

export function failureFrom(message: unknown): string | undefined {
  const record = message as {
    type?: string;
    subtype?: string;
    is_error?: boolean;
    errors?: unknown[];
  };

  if (record.type !== "result") {
    return undefined;
  }

  if (record.subtype === "success" && record.is_error !== true) {
    return undefined;
  }

  const listed = (record.errors ?? []).map((error) => String(error)).join("; ");

  return listed === "" ? `the session ended with ${record.subtype ?? "an error"}` : listed;
}
