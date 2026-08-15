# presentation

HTTP controllers, SSE hub, DTOs.

Rules:
- Every external boundary is validated with zod (CLAUDE.md conventions) — DTOs are zod
  schemas, not bare classes.
- Controllers call `application` use cases only; no business logic, no direct repository
  or queue access.
