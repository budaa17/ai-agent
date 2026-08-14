import ExcelJS from "exceljs";
import type { CellValue } from "exceljs";
import {
  engineeringWorkbookSheetDefinitions,
  type EngineeringWorkbookColumnDefinition,
} from "./workbook-schema.js";

export type WorkbookFixtureOverride = {
  sheetName: string;
  columnName: string;
  value: CellValue;
};

export type EngineeringWorkbookFixtureOptions = {
  omittedSheets?: readonly string[];
  overrides?: readonly WorkbookFixtureOverride[];
  unexpectedSheet?: string;
};

function fixtureValue(column: EngineeringWorkbookColumnDefinition, sheetIndex: number): CellValue {
  if (column.kind === "DATE") return "2026-08-01";
  if (column.kind === "TIME") return "08:00";
  if (column.kind === "BOOLEAN") return true;
  if (column.kind === "INTEGER") return sheetIndex + 1;
  if (column.kind === "DECIMAL") return sheetIndex + 1.25;
  return `${column.name.toLocaleUpperCase("en-US")}-${String(sheetIndex + 1).padStart(2, "0")}`;
}

export async function buildEngineeringWorkbookFixture(
  options: EngineeringWorkbookFixtureOptions = {},
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BuildWatch deterministic fixture";
  workbook.created = new Date("2026-08-01T00:00:00.000Z");
  const omitted = new Set(options.omittedSheets ?? []);

  engineeringWorkbookSheetDefinitions.forEach((definition, sheetIndex) => {
    if (omitted.has(definition.name)) return;
    const worksheet = workbook.addWorksheet(definition.name);
    worksheet.addRow(definition.columns.map((column) => column.name));
    const row = definition.columns.map((column) => {
      const override = options.overrides?.find(
        (candidate) =>
          candidate.sheetName === definition.name && candidate.columnName === column.name,
      );
      return override?.value ?? fixtureValue(column, sheetIndex);
    });
    worksheet.addRow(row);
  });

  if (options.unexpectedSheet !== undefined) {
    const worksheet = workbook.addWorksheet(options.unexpectedSheet);
    worksheet.addRow(["Unexpected"]);
    worksheet.addRow(["value"]);
  }

  const data = await workbook.xlsx.writeBuffer();
  return new Uint8Array(data);
}

export type VectorPdfFixtureOptions = {
  rotation?: 0 | 90 | 180 | 270;
  missingScale?: boolean;
  mixedScale?: boolean;
  pages?: number;
};

const architectureLabels = [
  ["FLOOR F1 Ground Floor", 50, 650, 500, 80],
  ["ZONE Z1 East Wing", 70, 540, 220, 70],
  ["ROOM R101 Office", 320, 540, 180, 70],
  ["WALL W1 External Wall", 70, 420, 430, 30],
  ["DOOR D1 Main Door", 120, 320, 70, 100],
  ["WINDOW WIN1 North Window", 320, 340, 120, 60],
] as const;

function escapePdfText(value: string): string {
  return value.replace(/([\\()])/gu, "\\$1");
}

function textOperator(text: string, x: number, y: number, size = 10): string {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function pageContent(pageNumber: number, options: VectorPdfFixtureOptions): string {
  const lines = [
    "q",
    "0.75 w",
    textOperator("DISCIPLINE ARCHITECTURE", 40, 800),
    textOperator(`SHEET A-${100 + pageNumber}`, 40, 784),
    textOperator("REV B", 40, 768),
    textOperator(`TITLE Ground Floor Plan ${pageNumber}`, 40, 752),
    textOperator("ISSUED 2026-08-01", 40, 736),
  ];

  if (!options.missingScale) {
    lines.push(textOperator("SCALE 1:100", 430, 800));
    lines.push("100 250 m 241.7323 250 l S");
    lines.push(textOperator(options.mixedScale ? "DIM 10m" : "DIM 5m", 120, 256));
  }

  for (const [label, x, y, width, height] of architectureLabels) {
    lines.push(`${x} ${y} ${width} ${height} re S`);
    lines.push(textOperator(label, x + 8, y + height / 2));
  }
  lines.push("Q");
  return `${lines.join("\n")}\n`;
}

function pdfObject(identifier: number, body: string): string {
  return `${identifier} 0 obj\n${body}\nendobj\n`;
}

export function buildVectorArchitecturalPdfFixture(
  options: VectorPdfFixtureOptions = {},
): Uint8Array {
  const pageCount = options.pages ?? 1;
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 20) {
    throw new Error("PDF fixture page count must be 1-20");
  }

  const objectBodies = new Map<number, string>();
  const pageReferences: string[] = [];
  objectBodies.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objectBodies.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageObjectId = 4 + pageIndex * 2;
    const contentObjectId = pageObjectId + 1;
    const content = pageContent(pageIndex + 1, options);
    pageReferences.push(`${pageObjectId} 0 R`);
    objectBodies.set(
      pageObjectId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate ${options.rotation ?? 0} /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    );
    objectBodies.set(
      contentObjectId,
      `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}endstream`,
    );
  }

  objectBodies.set(2, `<< /Type /Pages /Kids [${pageReferences.join(" ")}] /Count ${pageCount} >>`);

  const maxObjectId = Math.max(...objectBodies.keys());
  let pdf = "%PDF-1.7\n";
  const offsets = Array.from<number>({ length: maxObjectId + 1 }).fill(0);
  for (let identifier = 1; identifier <= maxObjectId; identifier += 1) {
    const body = objectBodies.get(identifier);
    if (body === undefined) {
      throw new Error(`PDF fixture object ${identifier} is missing`);
    }
    offsets[identifier] = Buffer.byteLength(pdf, "ascii");
    pdf += pdfObject(identifier, body);
  }

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${maxObjectId + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let identifier = 1; identifier <= maxObjectId; identifier += 1) {
    pdf += `${String(offsets[identifier]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "ascii"));
}

export const vectorArchitectureGoldenLabels = architectureLabels.map(([label]) => {
  const [type, code] = label.split(" ");
  return `${type}:${code}`;
});
