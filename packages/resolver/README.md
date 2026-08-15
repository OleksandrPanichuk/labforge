# @labforge/resolver

Виконує computation cells і заповнює `values` у Report IR — механіка, якою гарантується
інваріант 1 (числа в звіті не можуть бути вигадані).

```ts
const { ir, runs, errors } = await resolveValues(document, {
  run: (cellRef) => runInSandbox({ image, cmd: ["python", cellRef], jobDir }, engine),
});
```

## Що робить

1. Збирає всі `{{v:key}}` з блоків (включно з таблицями і списками).
2. Групує ключі по `cellRef` — cell із кількома ключами запускається **один раз**.
3. Запускає cell через `CellRunner` (порт; у core за ним стоїть sandbox).
4. Читає з stdout JSON-обʼєкт: спершу пробує весь вивід, потім останній рядок, що
   парситься, — тому логи cell перед JSON не ламають резолв.
5. Форматує (`sci:N`, `fixed:N`, `int`; десятковий роздільник за замовчуванням — кома)
   і кладе в `values[key]` разом із `raw` і `runRef`.

Повертає новий документ — вхідний не мутується.

## Помилки

Не кидає винятків: повертає `errors: ResolveIssue[]`, щоб стейт-машина сама вирішила,
що з ними робити (`cell-failed` — це FIX, а `binding-missing` — це помилка report-writer).

| rule | Коли |
|---|---|
| `binding-missing` | `{{v:key}}` без запису в `values` |
| `cell-failed` | cell завершився ненульовим кодом (у message — stderr) |
| `output-unparsable` | у stdout нема JSON-обʼєкта |
| `key-missing` | cell відпрацював, але не надрукував оголошений ключ |
| `format-invalid` | невідомий `format` — значення лишається незаповненим, а не кривим |

Значення, яке не вдалося отримати, лишається без `value` — і його ловить
`validateReport(ir, { phase: "post-resolve" })` як блокер збірки.

## runRef

`runs/<cellRef із заміненими нелітерними символами>.json` — детерміновано, без годинника,
тому повторний прогін стану перезаписує той самий лог, а не плодить сміття. Часовий вимір
дає git-історія job-директорії.
