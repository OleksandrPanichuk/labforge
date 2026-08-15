# domain

Entities, value objects, and ports (interfaces) — the innermost layer.

Rules:
- No NestJS imports, no I/O, no dependencies on any other layer or on infrastructure packages.
- Ports are named `XxxPort` and describe what the application needs, not how it is done
  (e.g. `SandboxPort`, `LlmSessionPort`, `JobRepositoryPort`, `UserNotifierPort`).
- Depends only on `@labforge/ir` types and the standard library.
