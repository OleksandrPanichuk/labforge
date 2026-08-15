export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SandboxTimeoutError extends SandboxError {
  constructor(readonly timeoutMs: number) {
    super(`Sandbox run exceeded ${timeoutMs} ms and was killed`);
  }
}

export class DockerUnavailableError extends SandboxError {
  constructor(cause: string) {
    super(`Docker is not reachable: ${cause}`);
  }
}
