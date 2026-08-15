/**
 * Report IR — єдиний source of truth звіту.
 * Розташування в репо: packages/ir/src/schema.ts
 * Правила: див. CLAUDE.md (інваріанти 1, 2, 7) і docs/labforge-architecture.md §5.
 */
import { z } from "zod";

/* ---------- primitives ---------- */

// Inline-текст: обмежений HTML-сабсет. Санітизація білим списком — обовʼязок
// рендерерів; ця regex — лише перша лінія валідації на межі.
const ALLOWED_TAGS = ["b", "i", "u", "sub", "sup", "span"] as const;
export const inlineHtml = z.string().superRefine((s, ctx) => {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)/g;
  for (const m of s.matchAll(tagRe)) {
    if (!(ALLOWED_TAGS as readonly string[]).includes(m[1].toLowerCase())) {
      ctx.addIssue({ code: "custom", message: `Заборонений тег <${m[1]}>` });
    }
  }
  // span дозволений тільки як <span data-x="id">
  const spanRe = /<span\b([^>]*)>/g;
  for (const m of s.matchAll(spanRe)) {
    if (!/^\s*data-x="[\w-]+"\s*$/.test(m[1])) {
      ctx.addIssue({
        code: "custom",
        message: `span тільки з єдиним атрибутом data-x: <span${m[1]}>`,
      });
    }
  }
});

export const valuePlaceholderRe = /\{\{v:([\w-]+)\}\}/g;

export const blockId = z.string().regex(/^blk_[\w-]+$/); // стабільні id для патчів і selection-чату

/* ---------- styles ---------- */

export const styleDef = z.object({
  font: z.string().optional(), // "Times New Roman"
  size: z.number().optional(), // pt
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  caps: z.boolean().optional(),
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  lineHeight: z.number().optional(), // 1.5
  firstLineIndent: z.string().optional(), // "1.25cm"
  spaceBefore: z.number().optional(), // pt
  spaceAfter: z.number().optional(),
});
export type StyleDef = z.infer<typeof styleDef>;

/* ---------- blocks ---------- */

const base = { id: blockId, style: z.string().optional() }; // style = ключ у styles map

export const headingBlock = z.object({
  ...base,
  type: z.literal("heading"),
  level: z.number().int().min(1).max(4),
  text: inlineHtml,
});

export const paragraphBlock = z.object({
  ...base,
  type: z.literal("paragraph"),
  text: inlineHtml, // може містити {{v:key}} і <span data-x="id">
});

export const listBlock = z.object({
  ...base,
  type: z.literal("list"),
  ordered: z.boolean().default(false),
  items: z.array(inlineHtml).min(1),
});

export const tableBlock = z.object({
  ...base,
  type: z.literal("table"),
  caption: inlineHtml.optional(), // "Таблиця 1 — …" (нумерацію пише агент; авто-нумерація — можливе покращення)
  header: z.array(inlineHtml).min(1),
  rows: z.array(z.array(inlineHtml)),
  columnWidths: z.array(z.number()).optional(), // частки, сума ≈ 1
});

export const imageBlock = z.object({
  ...base,
  type: z.literal("image"),
  src: z.string(), // шлях відносно jobs/<id>/, зазвичай artifacts/*.png
  caption: inlineHtml.optional(), // "Рисунок 1 — …"
  width: z.string().default("100%"),
  provenance: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("generated"), codeRef: z.string() }), // cells/plot_x.py
    z.object({ kind: z.literal("screenshot"), codeRef: z.string() }),
    z.object({ kind: z.literal("web"), url: z.string().url(), retrievedAt: z.string() }),
  ]),
});

export const formulaBlock = z.object({
  ...base,
  type: z.literal("formula"),
  latex: z.string(),
  numbered: z.boolean().default(false),
  inline: z.boolean().default(false), // true → рендер в потоці тексту сусіднього блоку не підтримуємо; inline-формули йдуть як $...$ у text? НІ — inline-формули в text заборонені в v1, тільки блокові. Поле лишено на майбутнє.
});

export const codeListingBlock = z.object({
  ...base,
  type: z.literal("code-listing"),
  language: z.string(), // "python" | "cpp" | ...
  file: z.string(), // шлях у src/
  lines: z.tuple([z.number().int().min(1), z.number().int()]).optional(), // включно; без поля — весь файл
  caption: inlineHtml.optional(),
});

export const pagebreakBlock = z.object({ ...base, type: z.literal("pagebreak") });

export const block = z.discriminatedUnion("type", [
  headingBlock,
  paragraphBlock,
  listBlock,
  tableBlock,
  imageBlock,
  formulaBlock,
  codeListingBlock,
  pagebreakBlock,
]);
export type Block = z.infer<typeof block>;

/* ---------- values (заповнює ТІЛЬКИ resolver) ---------- */

export const valueEntry = z.object({
  value: z.string(), // вже відформатований рядок для вставки
  raw: z.union([z.number(), z.string()]).optional(), // сире значення з cell
  cellRef: z.string(), // cells/compute_errors.py
  format: z.string().optional(), // "sci:2" | "fixed:4" | "int" | "uk-decimal" (кома)
  runRef: z.string().optional(), // runs/2026-08-15T13-04.json — provenance
});

/* ---------- explanations ---------- */

export const explanation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    html: inlineHtml,
    sources: z.array(z.object({ title: z.string(), url: z.string().url().optional() })).min(1), // текстове пояснення БЕЗ джерела не валідне — інваріант
  }),
  z.object({
    type: z.literal("code"),
    codeRef: z.string(),
    note: inlineHtml.optional(),
    runRef: z.string().optional(),
  }),
]);

/* ---------- document ---------- */

export const reportIR = z.object({
  version: z.literal(1),
  meta: z.object({
    labId: z.string(),
    subject: z.string(),
    teacher: z.string().optional(),
    title: z.string(),
    student: z.object({ name: z.string(), group: z.string(), variant: z.string().optional() }),
    language: z.literal("uk"),
  }),
  page: z.object({
    // ДСТУ за замовчуванням; переоприділяється STYLE_GUIDE
    size: z.literal("A4").default("A4"),
    marginsMm: z.object({
      top: z.number().default(20),
      right: z.number().default(10),
      bottom: z.number().default(20),
      left: z.number().default(20),
    }),
    pageNumbers: z.boolean().default(true),
  }),
  styles: z.record(z.string(), styleDef), // мусить містити "default"
  blocks: z.array(block).min(1),
  values: z.record(z.string(), valueEntry).default({}),
  explanations: z.record(z.string(), explanation).default({}),
});
export type ReportIR = z.infer<typeof reportIR>;

/* ---------- cross-validation (валідатор збірки) ----------
 * Реалізувати в packages/ir/src/validate.ts, викликати перед RESOLVE і перед BUILD:
 * 1. Кожен {{v:key}} у blocks має існувати як cells-джерело (до resolve) / у values (після).
 * 2. Кожен <span data-x="id"> має запис у explanations; кожен explanation використаний хоча б раз.
 * 3. styles["default"] існує; кожен block.style існує в styles.
 * 4. image.src існує на диску; code-listing.file існує в src/ і lines у межах файлу.
 * 5. Анти-галюцинація: у text-полях числа з ≥3 значущими цифрами поза {{v:}} —
 *    warning-список на рев'ю (не hard fail: роки, номери формул, константи легітимні).
 * 6. block.id унікальні по документу.
 */
