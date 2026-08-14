import ExcelJS from "exceljs";
import type { CellValue, Worksheet } from "exceljs";
import type { ContractValidationIssue } from "../contracts/common.js";
import {
  engineeringWorkbookImportV1Schema,
  type DesignFileIntakeResultV1,
  type EngineeringWorkbookImportV1,
  type WorkbookSheetImportV1,
} from "./contracts.js";
import { deterministicId, hashCanonical, sha256 } from "./deterministic.js";
import {
  engineeringWorkbookSheetDefinitions,
  normalizeWorkbookName,
  type EngineeringWorkbookColumnDefinition,
  type EngineeringWorkbookColumnKind,
  type EngineeringWorkbookSheetDefinition,
} from "./workbook-schema.js";

export type ImportEngineeringWorkbookInput = {
  intake: DesignFileIntakeResultV1;
  data: Uint8Array;
  importVersion: number;
  importedBy: string;
  importedAt?: string;
  maxRowsPerSheet?: number;
  maxColumnsPerSheet?: number;
};

type PrimitiveCell = string | number | boolean | null;

function issue(
  code: string,
  severity: ContractValidationIssue["severity"],
  fieldPath: string,
  message: string,
): ContractValidationIssue {
  return {
    code,
    severity,
    fieldPaths: [fieldPath],
    message,
    deterministic: true,
  };
}

function normalizedDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rawCellValue(value: CellValue): { value: PrimitiveCell; error: string | null } {
  if (value === null || value === undefined) {
    return { value: null, error: null };
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { value, error: null };
  }
  if (value instanceof Date) {
    return { value: normalizedDate(value), error: null };
  }
  if ("formula" in value || "sharedFormula" in value) {
    return {
      value: null,
      error: "Formula cells are not accepted as authoritative input",
    };
  }
  if ("error" in value) {
    return { value: null, error: `Excel cell error: ${value.error}` };
  }
  if ("hyperlink" in value) {
    return {
      value: null,
      error: "Hyperlink cells are not accepted in the strict workbook",
    };
  }
  if ("richText" in value) {
    return {
      value: value.richText
        .map((part) => part.text)
        .join("")
        .trim(),
      error: null,
    };
  }

  return { value: null, error: "Unsupported Excel cell value" };
}

function coerceCell(
  value: PrimitiveCell,
  kind: EngineeringWorkbookColumnKind,
): { value: PrimitiveCell; error: string | null } {
  if (value === null || value === "") {
    return { value: null, error: null };
  }

  if (kind === "TEXT") {
    return { value: String(value).trim(), error: null };
  }

  if (kind === "BOOLEAN") {
    if (typeof value === "boolean") {
      return { value, error: null };
    }
    const normalized = String(value).trim().toUpperCase();
    if (["TRUE", "YES", "1"].includes(normalized)) {
      return { value: true, error: null };
    }
    if (["FALSE", "NO", "0"].includes(normalized)) {
      return { value: false, error: null };
    }
    return { value: null, error: "Expected a boolean value" };
  }

  if (kind === "DATE") {
    const normalized = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
      const parsed = new Date(`${normalized}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(normalized)) {
        return { value: normalized, error: null };
      }
    }
    return { value: null, error: "Expected a valid YYYY-MM-DD date" };
  }

  if (kind === "TIME") {
    const normalized = String(value).trim();
    if (/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(normalized)) {
      return { value: normalized, error: null };
    }
    return { value: null, error: "Expected a valid HH:mm time" };
  }

  const numeric =
    typeof value === "number" ? value : Number(String(value).trim().replace(/,/gu, ""));
  if (!Number.isFinite(numeric)) {
    return { value: null, error: "Expected a finite numeric value" };
  }
  if (kind === "INTEGER" && !Number.isInteger(numeric)) {
    return { value: null, error: "Expected an integer value" };
  }
  return { value: numeric, error: null };
}

function headerText(value: CellValue): string | null {
  const raw = rawCellValue(value);
  if (raw.error !== null || raw.value === null) {
    return null;
  }
  const text = String(raw.value).trim();
  return text.length > 0 ? text : null;
}

function columnLookup(definition: EngineeringWorkbookSheetDefinition) {
  const lookup = new Map<string, EngineeringWorkbookColumnDefinition>();
  for (const column of definition.columns) {
    lookup.set(normalizeWorkbookName(column.name), column);
    for (const alias of column.aliases ?? []) {
      lookup.set(normalizeWorkbookName(alias), column);
    }
  }
  return lookup;
}

function importSheet(
  definition: EngineeringWorkbookSheetDefinition,
  worksheet: Worksheet | undefined,
  context: {
    tenantId: string;
    projectId: string;
    artifactId: string;
    sourceSha256: string;
    importId: string;
    maxRows: number;
    maxColumns: number;
  },
): WorkbookSheetImportV1 {
  if (worksheet === undefined) {
    return {
      sheetName: definition.name,
      required: true,
      present: false,
      checksum: null,
      headerRowNumber: 1,
      columnMappings: definition.columns.map((column) => ({
        sourceColumn: null,
        targetColumn: column.name,
        status: "MISSING",
      })),
      sourceRowCount: 0,
      acceptedRows: [],
      rejectedRowNumbers: [],
      issues: [
        issue(
          "WORKBOOK_SHEET_MISSING",
          "ERROR",
          `sheets.${definition.name}`,
          `Required sheet ${definition.name} is missing`,
        ),
      ],
    };
  }

  const issues: ContractValidationIssue[] = [];
  if (worksheet.rowCount > context.maxRows) {
    issues.push(
      issue(
        "WORKBOOK_ROW_LIMIT_EXCEEDED",
        "ERROR",
        `sheets.${definition.name}`,
        `Sheet has ${worksheet.rowCount} rows; limit is ${context.maxRows}`,
      ),
    );
  }
  if (worksheet.columnCount > context.maxColumns) {
    issues.push(
      issue(
        "WORKBOOK_COLUMN_LIMIT_EXCEEDED",
        "ERROR",
        `sheets.${definition.name}`,
        `Sheet has ${worksheet.columnCount} columns; limit is ${context.maxColumns}`,
      ),
    );
  }

  const lookup = columnLookup(definition);
  const mappedColumns = new Map<number, EngineeringWorkbookColumnDefinition>();
  const mappings: WorkbookSheetImportV1["columnMappings"] = [];
  const matchedNames = new Set<string>();
  const sourceHeaders = new Set<string>();
  const header = worksheet.getRow(1);

  for (let columnIndex = 1; columnIndex <= worksheet.columnCount; columnIndex += 1) {
    const sourceColumn = headerText(header.getCell(columnIndex).value);
    if (sourceColumn === null) {
      continue;
    }
    const normalizedSource = normalizeWorkbookName(sourceColumn);
    if (sourceHeaders.has(normalizedSource)) {
      issues.push(
        issue(
          "WORKBOOK_DUPLICATE_COLUMN",
          "ERROR",
          `sheets.${definition.name}.columns.${sourceColumn}`,
          `Column ${sourceColumn} appears more than once`,
        ),
      );
      continue;
    }
    sourceHeaders.add(normalizedSource);
    const target = lookup.get(normalizedSource);
    if (target === undefined) {
      mappings.push({
        sourceColumn,
        targetColumn: null,
        status: "UNEXPECTED",
      });
      issues.push(
        issue(
          "WORKBOOK_UNEXPECTED_COLUMN",
          "ERROR",
          `sheets.${definition.name}.columns.${sourceColumn}`,
          `Column ${sourceColumn} is outside the strict sheet schema`,
        ),
      );
      continue;
    }
    if (matchedNames.has(target.name)) {
      issues.push(
        issue(
          "WORKBOOK_DUPLICATE_COLUMN_MAPPING",
          "ERROR",
          `sheets.${definition.name}.columns.${sourceColumn}`,
          `Multiple source columns map to ${target.name}`,
        ),
      );
      continue;
    }
    matchedNames.add(target.name);
    mappedColumns.set(columnIndex, target);
    mappings.push({
      sourceColumn,
      targetColumn: target.name,
      status: sourceColumn === target.name ? "EXACT" : "NORMALIZED",
    });
  }

  for (const expected of definition.columns) {
    if (matchedNames.has(expected.name)) {
      continue;
    }
    mappings.push({
      sourceColumn: null,
      targetColumn: expected.name,
      status: "MISSING",
    });
    if (expected.required) {
      issues.push(
        issue(
          "WORKBOOK_REQUIRED_COLUMN_MISSING",
          "ERROR",
          `sheets.${definition.name}.columns.${expected.name}`,
          `Required column ${expected.name} is missing`,
        ),
      );
    }
  }

  const acceptedRows: WorkbookSheetImportV1["acceptedRows"] = [];
  const rejectedRowNumbers: number[] = [];
  const seenKeys = new Set<string>();
  const maxRow = Math.min(worksheet.rowCount, context.maxRows);

  for (let rowNumber = 2; rowNumber <= maxRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const hasValue = Array.from(mappedColumns.keys()).some(
      (columnIndex) => row.getCell(columnIndex).value !== null,
    );
    if (!hasValue) {
      continue;
    }

    const values: Record<string, PrimitiveCell> = {};
    const rowIssues: ContractValidationIssue[] = [];
    for (const [columnIndex, expected] of mappedColumns) {
      const path = `sheets.${definition.name}.rows.${rowNumber}.${expected.name}`;
      const raw = rawCellValue(row.getCell(columnIndex).value);
      if (raw.error !== null) {
        rowIssues.push(issue("WORKBOOK_CELL_UNSUPPORTED", "ERROR", path, raw.error));
        values[expected.name] = null;
        continue;
      }
      const coerced = coerceCell(raw.value, expected.kind);
      values[expected.name] = coerced.value;
      if (coerced.error !== null) {
        rowIssues.push(issue("WORKBOOK_CELL_TYPE_INVALID", "ERROR", path, coerced.error));
      }
      if (expected.required && coerced.value === null) {
        rowIssues.push(
          issue(
            "WORKBOOK_REQUIRED_VALUE_MISSING",
            "ERROR",
            path,
            `Required value ${expected.name} is missing`,
          ),
        );
      }
    }

    const key = values[definition.keyColumn];
    if (key !== null && key !== undefined) {
      const canonicalKey = String(key).trim().toLocaleUpperCase("en-US");
      if (seenKeys.has(canonicalKey)) {
        rowIssues.push(
          issue(
            "WORKBOOK_DUPLICATE_KEY",
            "ERROR",
            `sheets.${definition.name}.rows.${rowNumber}.${definition.keyColumn}`,
            `Duplicate ${definition.keyColumn}: ${key}`,
          ),
        );
      }
      seenKeys.add(canonicalKey);
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      rejectedRowNumbers.push(rowNumber);
      continue;
    }

    acceptedRows.push({
      rowNumber,
      values,
      checksum: hashCanonical(values),
      sourceRef: {
        sourceRefId: deterministicId(
          "xlsx-source",
          context.importId,
          definition.name,
          String(rowNumber),
        ),
        tenantId: context.tenantId,
        projectId: context.projectId,
        sourceType: "EXCEL_IMPORT_ROW",
        sourceId: context.importId,
        sourceVersionId: null,
        artifactId: context.artifactId,
        pageNumber: null,
        sheetName: definition.name,
        rowNumber,
        fieldPath: null,
        region: null,
        asOf: null,
        sha256: context.sourceSha256,
      },
    });
  }

  return {
    sheetName: definition.name,
    required: true,
    present: true,
    checksum: hashCanonical(
      acceptedRows.map((row) => ({ rowNumber: row.rowNumber, values: row.values })),
    ),
    headerRowNumber: 1,
    columnMappings: mappings,
    sourceRowCount: Math.max(0, maxRow - 1),
    acceptedRows,
    rejectedRowNumbers,
    issues,
  };
}

export async function importEngineeringWorkbook(
  input: ImportEngineeringWorkbookInput,
): Promise<EngineeringWorkbookImportV1> {
  if (input.intake.detectedMediaType !== "XLSX") {
    throw new Error("Engineering workbook import requires an XLSX intake");
  }
  if (input.intake.status === "REJECTED") {
    throw new Error("Rejected design intake cannot enter workbook import");
  }
  const workbookChecksum = sha256(input.data);
  if (workbookChecksum !== input.intake.sha256) {
    throw new Error("Workbook bytes do not match the accepted intake checksum");
  }
  if (!Number.isInteger(input.importVersion) || input.importVersion < 1) {
    throw new Error("Workbook import version must be a positive integer");
  }

  const workbook = new ExcelJS.Workbook();
  const workbookBytes = new Uint8Array(input.data);
  await workbook.xlsx.load(workbookBytes.buffer);
  const importId = deterministicId(
    "workbook-import",
    input.intake.tenantId,
    input.intake.projectId,
    workbookChecksum,
    String(input.importVersion),
  );
  const issues: ContractValidationIssue[] = [];
  const canonicalByNormalized = new Map(
    engineeringWorkbookSheetDefinitions.map((definition) => [
      normalizeWorkbookName(definition.name),
      definition.name,
    ]),
  );
  const worksheetByCanonical = new Map<string, Worksheet>();

  for (const worksheet of workbook.worksheets) {
    const canonical = canonicalByNormalized.get(normalizeWorkbookName(worksheet.name));
    if (canonical === undefined) {
      issues.push(
        issue(
          "WORKBOOK_UNEXPECTED_SHEET",
          "ERROR",
          `sheets.${worksheet.name}`,
          `Sheet ${worksheet.name} is outside the strict 18-sheet schema`,
        ),
      );
      continue;
    }
    if (worksheetByCanonical.has(canonical)) {
      issues.push(
        issue(
          "WORKBOOK_DUPLICATE_SHEET",
          "ERROR",
          `sheets.${worksheet.name}`,
          `Multiple sheets map to ${canonical}`,
        ),
      );
      continue;
    }
    if (worksheet.name !== canonical) {
      issues.push(
        issue(
          "WORKBOOK_SHEET_NAME_NORMALIZED",
          "WARNING",
          `sheets.${worksheet.name}`,
          `Sheet name was normalized to ${canonical}`,
        ),
      );
    }
    if (worksheet.state !== "visible") {
      issues.push(
        issue(
          "WORKBOOK_HIDDEN_SHEET",
          "ERROR",
          `sheets.${worksheet.name}`,
          `Canonical sheet ${canonical} must be visible`,
        ),
      );
    }
    worksheetByCanonical.set(canonical, worksheet);
  }

  const sheets = engineeringWorkbookSheetDefinitions.map((definition) =>
    importSheet(definition, worksheetByCanonical.get(definition.name), {
      tenantId: input.intake.tenantId,
      projectId: input.intake.projectId,
      artifactId: input.intake.artifactId,
      sourceSha256: workbookChecksum,
      importId,
      maxRows: input.maxRowsPerSheet ?? 100_000,
      maxColumns: input.maxColumnsPerSheet ?? 200,
    }),
  );
  const hasError = [...issues, ...sheets.flatMap((sheet) => sheet.issues)].some(
    (item) => item.severity === "ERROR",
  );

  return engineeringWorkbookImportV1Schema.parse({
    schemaVersion: 1,
    importType: "ENGINEERING_WORKBOOK",
    importId,
    importVersion: input.importVersion,
    tenantId: input.intake.tenantId,
    projectId: input.intake.projectId,
    sourceArtifactId: input.intake.artifactId,
    sourceDocumentId: input.intake.documentId,
    sourceSha256: workbookChecksum,
    workbookChecksum,
    sheets,
    status: hasError ? "INVALID" : "READY_FOR_REVIEW",
    issues,
    deterministic: true,
    importedAt: input.importedAt ?? new Date().toISOString(),
    importedBy: input.importedBy,
  });
}
