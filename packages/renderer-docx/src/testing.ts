import type { ReportIR } from "@labforge/ir";

export function makeIR(overrides: Partial<ReportIR> = {}): ReportIR {
  return {
    version: 1,
    meta: {
      labId: "lab_1",
      subject: "numeric-methods",
      title: "Lab 1",
      student: { name: "Student", group: "IP-21" },
      language: "uk",
    },
    page: {
      size: "A4",
      marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
      pageNumbers: true,
    },
    styles: {
      default: {
        font: "Times New Roman",
        size: 14,
        lineHeight: 1.5,
        align: "justify",
        firstLineIndent: "1.25cm",
      },
    },
    blocks: [{ id: "blk_1", type: "paragraph", text: "Plain text" }],
    values: {},
    explanations: {},
    ...overrides,
  };
}
