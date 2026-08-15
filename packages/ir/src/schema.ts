import { z } from "zod";

const ALLOWED_TAGS = ["b", "i", "u", "sub", "sup", "span"] as const;

export const inlineHtml = z.string().superRefine((value, ctx) => {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)/g;
  for (const match of value.matchAll(tagRe)) {
    if (!(ALLOWED_TAGS as readonly string[]).includes(match[1].toLowerCase())) {
      ctx.addIssue({ code: "custom", message: `Tag <${match[1]}> is not allowed in inline text` });
    }
  }

  const spanRe = /<span\b([^>]*)>/g;
  for (const match of value.matchAll(spanRe)) {
    if (!/^\s*data-x="[\w-]+"\s*$/.test(match[1])) {
      ctx.addIssue({
        code: "custom",
        message: `<span> accepts exactly one attribute, data-x, got: <span${match[1]}>`,
      });
    }
  }
});

export const valuePlaceholderRe = /\{\{v:([\w-]+)\}\}/g;

export const blockId = z.string().regex(/^blk_[\w-]+$/);

export const styleDef = z.object({
  font: z.string().optional(),
  size: z.number().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  caps: z.boolean().optional(),
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  lineHeight: z.number().optional(),
  firstLineIndent: z.string().optional(),
  spaceBefore: z.number().optional(),
  spaceAfter: z.number().optional(),
});
export type StyleDef = z.infer<typeof styleDef>;

const base = { id: blockId, style: z.string().optional() };

export const headingBlock = z.object({
  ...base,
  type: z.literal("heading"),
  level: z.number().int().min(1).max(4),
  text: inlineHtml,
});

export const paragraphBlock = z.object({
  ...base,
  type: z.literal("paragraph"),
  text: inlineHtml,
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
  caption: inlineHtml.optional(),
  header: z.array(inlineHtml).min(1),
  rows: z.array(z.array(inlineHtml)).min(1),
  columnWidths: z
    .array(z.number().positive())
    .optional()
    .refine(
      (widths) => widths === undefined || Math.abs(widths.reduce((a, b) => a + b, 0) - 1) < 0.01,
      { message: "columnWidths are fractions of table width and must sum to 1" },
    ),
});

export const imageBlock = z.object({
  ...base,
  type: z.literal("image"),
  src: z.string(),
  caption: inlineHtml.optional(),
  width: z.string().default("100%"),
  provenance: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("generated"), codeRef: z.string() }),
    z.object({ kind: z.literal("screenshot"), codeRef: z.string() }),
    z.object({ kind: z.literal("web"), url: z.string().url(), retrievedAt: z.string() }),
  ]),
});

export const formulaBlock = z.object({
  ...base,
  type: z.literal("formula"),
  latex: z.string(),
  numbered: z.boolean().default(false),
});

export const codeListingBlock = z.object({
  ...base,
  type: z.literal("code-listing"),
  language: z.string(),
  file: z.string(),
  lines: z.tuple([z.number().int().min(1), z.number().int()]).optional(),
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

export const valueEntry = z.object({
  value: z.string(),
  raw: z.union([z.number(), z.string()]).optional(),
  cellRef: z.string(),
  format: z.string().optional(),
  runRef: z.string().optional(),
});
export type ValueEntry = z.infer<typeof valueEntry>;

export const explanation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    html: inlineHtml,
    sources: z
      .array(z.object({ title: z.string(), url: z.string().url().optional() }))
      .min(1, "a text explanation without a source is not valid"),
  }),
  z.object({
    type: z.literal("code"),
    codeRef: z.string(),
    note: inlineHtml.optional(),
    runRef: z.string().optional(),
  }),
]);
export type Explanation = z.infer<typeof explanation>;

export const reportIR = z.object({
  version: z.literal(1),
  meta: z.object({
    labId: z.string(),
    subject: z.string(),
    teacher: z.string().optional(),
    title: z.string(),
    student: z.object({
      name: z.string(),
      group: z.string(),
      variant: z.string().optional(),
    }),
    language: z.literal("uk"),
  }),
  page: z.object({
    size: z.literal("A4").default("A4"),
    marginsMm: z.object({
      top: z.number().default(20),
      right: z.number().default(10),
      bottom: z.number().default(20),
      left: z.number().default(20),
    }),
    pageNumbers: z.boolean().default(true),
  }),
  styles: z.record(z.string(), styleDef).refine((styles) => "default" in styles, {
    message: 'styles must define a "default" entry',
  }),
  blocks: z.array(block).min(1),
  values: z.record(z.string(), valueEntry).default({}),
  explanations: z.record(z.string(), explanation).default({}),
});
export type ReportIR = z.infer<typeof reportIR>;
