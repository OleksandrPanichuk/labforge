import { strToU8, zipSync } from "fflate";

export function makePdf(lines: string[]): Buffer {
  const content = Buffer.from(
    `BT /F1 14 Tf 72 720 Td ${lines
      .map((line, index) => `${index === 0 ? "" : "0 -20 Td "}(${line}) Tj`)
      .join(" ")} ET`,
    "latin1",
  );

  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];

  let pdf = Buffer.from("%PDF-1.4\n");
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf = Buffer.concat([
      pdf,
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
  });

  const xref = pdf.length;
  const table = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");

  return Buffer.concat([
    pdf,
    Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}`),
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  ]);
}

export function makeDocx(bodyXml: string): Buffer {
  const document = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`;

  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(document),
    }),
  );
}

export function paragraph(text: string, style?: string): string {
  const properties = style === undefined ? "" : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`;

  return `<w:p>${properties}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

export function listItem(text: string): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

export function table(rows: string[][]): string {
  const cells = rows
    .map((row) => `<w:tr>${row.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`)
    .join("");

  return `<w:tbl>${cells}</w:tbl>`;
}
