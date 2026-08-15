# infrastructure

Adapters implementing domain ports: Prisma repositories, BullMQ queue, dockerode sandbox
(via `@labforge/sandbox`), Claude Agent SDK sessions, filesystem job storage, git checkpoints.

Rules:
- Each adapter implements exactly one port from `domain`.
- Wiring happens in NestJS modules here; other layers never see concrete classes.
- All external errors are mapped to typed errors (`RateLimitError`, `SandboxTimeoutError`, …)
  before crossing into `application`.
