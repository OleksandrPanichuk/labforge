import Docker from "dockerode";
import { DockerUnavailableError } from "./errors";
import type { SandboxContainer, SandboxEngine } from "./run";
import { resolveDockerSocket } from "./socket";
import type { ContainerSpec } from "./spec";

export interface DockerContainerHandle {
  start(): Promise<unknown>;
  wait(): Promise<{ StatusCode: number }>;
  kill(): Promise<unknown>;
  logs(options: { stdout: boolean; stderr: boolean; follow: false }): Promise<unknown>;
  remove(options: { force: boolean }): Promise<unknown>;
}

export interface DockerClient {
  createContainer(spec: ContainerSpec): Promise<DockerContainerHandle>;
}

const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOENT", "EACCES"]);

export class DockerodeEngine implements SandboxEngine {
  constructor(private readonly client: DockerClient = defaultClient()) {}

  async create(spec: ContainerSpec): Promise<SandboxContainer> {
    const handle = await this.createHandle(spec);

    return {
      start: async () => {
        await handle.start();
      },
      wait: async () => (await handle.wait()).StatusCode,
      kill: async () => {
        await handle.kill();
      },
      output: async () =>
        Buffer.from(
          (await handle.logs({ stdout: true, stderr: true, follow: false })) as Uint8Array,
        ),
      remove: async () => {
        await handle.remove({ force: true });
      },
    };
  }

  private async createHandle(spec: ContainerSpec): Promise<DockerContainerHandle> {
    try {
      return await this.client.createContainer(spec);
    } catch (error) {
      const code = (error as { code?: string }).code;

      if (code !== undefined && UNREACHABLE_CODES.has(code)) {
        throw new DockerUnavailableError(code);
      }

      throw error;
    }
  }
}

function defaultClient(): DockerClient {
  const socketPath = resolveDockerSocket();
  const docker = socketPath === undefined ? new Docker() : new Docker({ socketPath });

  return docker as unknown as DockerClient;
}
