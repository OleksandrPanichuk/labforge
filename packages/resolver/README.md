# @labforge/resolver

Виконує computation cells у sandbox і заповнює `values` у Report IR
(docs/labforge-architecture.md §5.2–5.3). Реалізація — Фаза 1.

Кожна cell друкує в stdout JSON `{key: value}`; resolver збирає, форматує
(`sci:2`, `fixed:4`, `int`, `uk-decimal`) і підставляє. Unresolved value після проходу —
блокер збірки, а не попередження.

Unit-тести обовʼязкові до мержа (CLAUDE.md).
