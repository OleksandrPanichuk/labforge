import { demuxDockerStream } from "./demux";
import { SandboxTimeoutError } from "./errors";
import { buildContainerSpec, type ContainerSpec, LIMITS, type SandboxRunRequest } from "./spec";

export interface SandboxContainer {
  start(): Promise<void>;
  wait(): Promise<number>;
  kill(): Promise<void>;
  output(): Promise<Buffer>;
  remove(): Promise<void>;
}

export interface SandboxEngine {
  create(spec: ContainerSpec): Promise<SandboxContainer>;
}

export interface SandboxRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function runInSandbox(
  request: SandboxRunRequest,
  engine: SandboxEngine,
): Promise<SandboxRunResult> {
  const timeoutMs = request.timeoutMs ?? LIMITS.timeoutMs;
  const startedAt = Date.now();
  const container = await engine.create(buildContainerSpec(request));

  try {
    await container.start();
    const exitCode = await waitWithTimeout(container, timeoutMs);
    const { stdout, stderr } = demuxDockerStream(await container.output());

    return { exitCode, stdout, stderr, durationMs: Date.now() - startedAt };
  } finally {
    await container.remove().catch(() => undefined);
  }
}

async function waitWithTimeout(container: SandboxContainer, timeoutMs: number): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SandboxTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([container.wait(), expiry]);
  } catch (error) {
    if (error instanceof SandboxTimeoutError) {
      await container.kill().catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
