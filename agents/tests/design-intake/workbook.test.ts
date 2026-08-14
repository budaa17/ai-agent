import { describe, expect, it } from "vitest";
import { BuiltInArtifactMalwareScanner } from "../../src/artifacts/index.js";
import {
  buildEngineeringWorkbookFixture,
  importEngineeringWorkbook,
  intakeDesignFile,
} from "../../src/design-intake/index.js";

const now = "2026-08-01T00:00:00.000Z";

async function intakeWorkbook(data: Uint8Array, suffix: string) {
  return intakeDesignFile({
    intakeId: `intake-${suffix}`,
    tenantId: "tenant-demo",
    projectId: "project-atlas",
    documentId: `document-${suffix}`,
    artifactId: `artifact-${suffix}`,
    originalFileName: `${suffix}.xlsx`,
    data,
    declaredMediaType: "XLSX",
    scanner: new BuiltInArtifactMalwareScanner(() => now),
    createdAt: now,
    createdBy: "engineer-test",
  });
}

describe("BuildWatch v2.2 engineering workbook import", () => {
  it("imports all 18 strict sheets with row checksums and sources", async () => {
    const data = await buildEngineeringWorkbookFixture();
    const intake = await intakeWorkbook(data, "valid-workbook");
    const imported = await importEngineeringWorkbook({
      intake: intake.result,
      data,
      importVersion: 1,
      importedBy: "engineer-test",
      importedAt: now,
    });

    expect(imported.status).toBe("READY_FOR_REVIEW");
    expect(imported.sheets).toHaveLength(18);
    expect(imported.sheets.every((sheet) => sheet.acceptedRows.length === 1)).toBe(true);
    expect(imported.sheets[0]?.acceptedRows[0]?.sourceRef).toMatchObject({
      sourceType: "EXCEL_IMPORT_ROW",
      artifactId: "artifact-valid-workbook",
      sheetName: "01_Project",
      rowNumber: 2,
    });
  });

  it("reports missing sheets and formula cells without accepting bad rows", async () => {
    const data = await buildEngineeringWorkbookFixture({
      omittedSheets: ["18_Approval_Matrix"],
      overrides: [
        {
          sheetName: "07_Prices",
          columnName: "UnitPriceMnt",
          value: { formula: "1+1", result: 2 },
        },
      ],
    });
    const intake = await intakeWorkbook(data, "invalid-workbook");
    const imported = await importEngineeringWorkbook({
      intake: intake.result,
      data,
      importVersion: 2,
      importedBy: "engineer-test",
      importedAt: now,
    });

    expect(imported.status).toBe("INVALID");
    expect(imported.sheets.flatMap((sheet) => sheet.issues).map((item) => item.code)).toEqual(
      expect.arrayContaining(["WORKBOOK_SHEET_MISSING", "WORKBOOK_CELL_UNSUPPORTED"]),
    );
    expect(
      imported.sheets.find((sheet) => sheet.sheetName === "07_Prices")?.rejectedRowNumbers,
    ).toEqual([2]);
  });

  it("rejects unexpected sheets and checksum substitution", async () => {
    const data = await buildEngineeringWorkbookFixture({
      unexpectedSheet: "19_Unknown",
    });
    const intake = await intakeWorkbook(data, "unexpected-workbook");
    const imported = await importEngineeringWorkbook({
      intake: intake.result,
      data,
      importVersion: 1,
      importedBy: "engineer-test",
      importedAt: now,
    });
    expect(imported.status).toBe("INVALID");
    expect(imported.issues.some((item) => item.code === "WORKBOOK_UNEXPECTED_SHEET")).toBe(true);

    const substituted = new Uint8Array(data);
    substituted[substituted.length - 1] = (substituted.at(-1) ?? 0) ^ 1;
    await expect(
      importEngineeringWorkbook({
        intake: intake.result,
        data: substituted,
        importVersion: 1,
        importedBy: "engineer-test",
        importedAt: now,
      }),
    ).rejects.toThrow("checksum");
  });
});
