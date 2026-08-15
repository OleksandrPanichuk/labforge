# modules

Standard NestJS feature modules — one folder per feature, wired into `AppModule`.

```
modules/<feature>/
  <feature>.module.ts        # wiring: imports, providers, exports
  <feature>.controller.ts    # thin HTTP layer, zod-validated DTOs, no business logic
  <feature>.service.ts       # business logic
  <feature>.repository.ts    # all Prisma access for the feature; services never touch Prisma directly
  <feature>.errors.ts        # typed errors (RateLimitError, SandboxTimeoutError, …), when the feature has them
  dto/                       # zod schemas + inferred types for the module boundary
```

Expected features (arrive with Phases 1–3): `jobs`, `orchestrator` (state machine +
Agent SDK sessions), `queue` (BullMQ worker), `users`, `sse`, `sandbox` (thin bridge
to @labforge/sandbox), `configs` (REQUIREMENTS/STYLE_GUIDE resolution).

Conventions: see the `nestjs-modules` skill and CLAUDE.md.
