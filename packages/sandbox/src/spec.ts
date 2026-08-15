import { BUILD_MOUNT, JOB_MOUNT } from "./mounts";
import { RUNTIMES, type RuntimeId } from "./runtime";

export { BUILD_MOUNT, JOB_MOUNT };
export const LIMITS = {
  memoryBytes: 1024 * 1024 * 1024,
  nanoCpus: 1_000_000_000,
  pidsLimit: 256,
  timeoutMs: 120_000,
  user: "1000:1000",
  tmpfsSize: "size=64m",
} as const;

export interface SandboxRunRequest {
  image?: string;
  runtime?: RuntimeId;
  cmd: string[];
  jobDir: string;
  workdir?: string;
  timeoutMs?: number;
  network?: boolean;
  env?: Record<string, string>;
}

export interface ContainerSpec {
  Image: string;
  Cmd: string[];
  WorkingDir: string;
  User: string;
  Env: string[];
  Tty: false;
  AttachStdout: true;
  AttachStderr: true;
  HostConfig: {
    Memory: number;
    NanoCpus: number;
    PidsLimit: number;
    NetworkMode: string;
    Binds: string[];
    Tmpfs: Record<string, string>;
    CapDrop: string[];
    SecurityOpt: string[];
    AutoRemove: false;
  };
}

export function buildContainerSpec(request: SandboxRunRequest): ContainerSpec {
  if (!request.jobDir.startsWith("/")) {
    throw new Error(`jobDir must be an absolute path, got "${request.jobDir}"`);
  }

  const runtime = RUNTIMES[request.runtime ?? "python"];
  const env = { ...runtime.env, ...request.env };

  return {
    Image: request.image ?? runtime.image,
    Cmd: request.cmd,
    WorkingDir: request.workdir ?? JOB_MOUNT,
    User: LIMITS.user,
    Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
    Tty: false,
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: {
      Memory: LIMITS.memoryBytes,
      NanoCpus: LIMITS.nanoCpus,
      PidsLimit: LIMITS.pidsLimit,
      NetworkMode: request.network === true ? "bridge" : "none",
      Binds: [
        `${request.jobDir}:${JOB_MOUNT}:ro`,
        `${request.jobDir}/artifacts:${JOB_MOUNT}/artifacts:rw`,
        `${request.jobDir}/build:${BUILD_MOUNT}:rw`,
      ],
      Tmpfs: { "/tmp": `rw,${LIMITS.tmpfsSize}` },
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      AutoRemove: false,
    },
  };
}
