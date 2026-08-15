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

export function fakePng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(13);
  const dimensions = Buffer.alloc(8);
  dimensions.writeUInt32BE(width, 0);
  dimensions.writeUInt32BE(height, 4);

  return Buffer.concat([signature, length, Buffer.from("IHDR"), dimensions, Buffer.alloc(5)]);
}
