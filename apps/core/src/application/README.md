# application

Use cases and the job state machine — orchestration logic.

Rules:
- Depends only on `domain`. Ports are injected; no direct imports of Prisma, BullMQ,
  dockerode, or the Agent SDK.
- The state machine is deterministic code: stop rules, cycle counters, checkpoint writes
  (CLAUDE.md invariant 4). No LLM calls here — states invoke `LlmSessionPort`.
- One use case = one class with a single `execute` method.
