# configs

Ієрархія вимог і стилів (docs/labforge-architecture.md §4). Пріоритет: викладач > предмет > база.

```
REQUIREMENTS.md / STYLE_GUIDE.md   # базові
subjects/<subject-slug>/           # опційно per предмет
teachers/<teacher-slug>/           # опційно per викладач (+ subjects/<subject>/ всередині)
```

Кожен конфіг предмету/викладача — з frontmatter (`teacher:`, `aliases: [...]`), щоб
Scout міг зіставити ім'я з файлу лаби без вгадування.
