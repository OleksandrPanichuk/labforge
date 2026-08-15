# @labforge/renderer-docx

Детермінований рендер Report IR → `.docx` на бібліотеці `docx`
(docs/labforge-architecture.md §8). Реалізація — Фаза 1.

Формули: LaTeX → MathML (`temml`) → OMML; fallback для неконвертованих —
KaTeX → PNG 300 dpi.

Golden-тести (fixture IR → snapshot XML) обовʼязкові до мержа (CLAUDE.md).
