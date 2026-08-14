import path from "node:path";
import type { ArtifactStore } from "../artifacts/store.js";
import { malwareScanResultV1Schema, type MalwareScanner } from "../artifacts/index.js";
import type { ContractValidationIssue } from "../contracts/common.js";
import { designFileIntakeResultV1Schema, type DesignFileIntakeResultV1 } from "./contracts.js";
import { sha256 } from "./deterministic.js";
import { inspectPdfDocument, type InspectedPdfDocument } from "./pdf-inspection.js";
import { inspectXlsxContainer } from "./xlsx-container.js";

export type ExistingDesignFile = {
  documentId: string;
  artifactId: string;
  sha256: string;
};

export type DesignFileIntakePolicy = {
  maxFileBytes: number;
  maxPdfPages: number;
  maxXlsxEntries: number;
  maxXlsxUncompressedBytes: number;
  maxXlsxCompressionRatio: number;
};

export const defaultDesignFileIntakePolicy: DesignFileIntakePolicy = {
  maxFileBytes: 100 * 1024 * 1024,
  maxPdfPages: 500,
  maxXlsxEntries: 5_000,
  maxXlsxUncompressedBytes: 500 * 1024 * 1024,
  maxXlsxCompressionRatio: 500,
};

export type IntakeDesignFileInput = {
  intakeId: string;
  tenantId: string;
  projectId: string;
  documentId: string;
  artifactId: string;
  originalFileName: string;
  data: Uint8Array;
  declaredMediaType?: "PDF" | "XLSX";
  disciplineHint?:
    | "ARCHITECTURE"
    | "STRUCTURE"
    | "MECHANICAL"
    | "ELECTRICAL"
    | "PLUMBING"
    | "FIRE_SAFETY"
    | "GENERAL"
    | "UNKNOWN";
  existingFiles?: readonly ExistingDesignFile[];
  scanner: MalwareScanner;
  artifactStore?: ArtifactStore;
  policy?: Partial<DesignFileIntakePolicy>;
  createdAt?: string;
  createdBy: string;
};

export type IntakeDesignFileOutput = {
  result: DesignFileIntakeResultV1;
  inspectedPdf: InspectedPdfDocument | null;
};

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

function fileExtension(fileName: string): string {
  return path.extname(fileName).toLocaleLowerCase("en-US");
}

function preliminaryMediaType(data: Uint8Array): "PDF" | "XLSX" | null {
  if (Buffer.from(data.subarray(0, 5)).toString("ascii") === "%PDF-") {
    return "PDF";
  }
  if (data[0] === 0x50 && data[1] === 0x4b) {
    return "XLSX";
  }
  return null;
}

function inferDiscipline(
  text: string,
  hint: IntakeDesignFileInput["disciplineHint"],
): NonNullable<IntakeDesignFileInput["disciplineHint"]> {
  if (hint !== undefined && hint !== "UNKNOWN") {
    return hint;
  }

  const normalized = text.toLocaleUpperCase("en-US");
  const rules = [
    ["ARCHITECTURE", /\b(?:ARCHITECTURE|ARCHITECTURAL|АРХИТЕКТУР)\b/u],
    ["STRUCTURE", /\b(?:STRUCTURE|STRUCTURAL|БҮТЭЭЦ)\b/u],
    ["MECHANICAL", /\b(?:MECHANICAL|HVAC)\b/u],
    ["ELECTRICAL", /\b(?:ELECTRICAL|ЦАХИЛГААН)\b/u],
    ["PLUMBING", /\b(?:PLUMBING|САНТЕХНИК)\b/u],
    ["FIRE_SAFETY", /\b(?:FIRE SAFETY|ГАЛЫН)\b/u],
  ] as const;
  return rules.find(([, pattern]) => pattern.test(normalized))?.[0] ?? "UNKNOWN";
}

export async function intakeDesignFile(
  input: IntakeDesignFileInput,
): Promise<IntakeDesignFileOutput> {
  const policy = { ...defaultDesignFileIntakePolicy, ...input.policy };
  const contentSha256 = sha256(input.data);
  const preliminary = preliminaryMediaType(input.data);
  const mediaTypeValue =
    preliminary === "PDF"
      ? "application/pdf"
      : preliminary === "XLSX"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/octet-stream";
  const scan = malwareScanResultV1Schema.parse(
    await input.scanner.scan({
      data: input.data,
      sha256: contentSha256,
      mediaType: mediaTypeValue,
      fileName: input.originalFileName,
    }),
  );
  const issues: ContractValidationIssue[] = [];

  if (input.data.byteLength < 1) {
    issues.push(issue("DESIGN_FILE_EMPTY", "ERROR", "data", "Uploaded file is empty"));
  }
  if (input.data.byteLength > policy.maxFileBytes) {
    issues.push(
      issue(
        "DESIGN_FILE_SIZE_LIMIT",
        "ERROR",
        "data",
        `File exceeds the ${policy.maxFileBytes}-byte intake limit`,
      ),
    );
  }
  if (scan.status !== "CLEAN") {
    issues.push(
      issue(
        scan.status === "INFECTED" ? "DESIGN_FILE_INFECTED" : "DESIGN_FILE_SCAN_ERROR",
        "ERROR",
        "malwareScan",
        scan.status === "INFECTED"
          ? `Malware scanner rejected the file: ${scan.threatName}`
          : `Malware scan failed: ${scan.errorMessage}`,
      ),
    );
  }

  const baseName = path.basename(input.originalFileName);
  if (baseName !== input.originalFileName || baseName.trim().length === 0) {
    issues.push(
      issue(
        "DESIGN_FILE_NAME_UNSAFE",
        "ERROR",
        "originalFileName",
        "Original filename must not contain a path",
      ),
    );
  }
  if (preliminary === null) {
    issues.push(
      issue(
        "DESIGN_FILE_SIGNATURE_UNSUPPORTED",
        "ERROR",
        "data",
        "Only PDF and XLSX file signatures are supported in Phase 6",
      ),
    );
  }
  if (input.declaredMediaType !== undefined && preliminary !== input.declaredMediaType) {
    issues.push(
      issue(
        "DESIGN_FILE_MEDIA_MISMATCH",
        "ERROR",
        "declaredMediaType",
        `Declared ${input.declaredMediaType} does not match file signature ${preliminary ?? "UNKNOWN"}`,
      ),
    );
  }
  const expectedExtension =
    preliminary === "PDF" ? ".pdf" : preliminary === "XLSX" ? ".xlsx" : null;
  if (expectedExtension !== null && fileExtension(input.originalFileName) !== expectedExtension) {
    issues.push(
      issue(
        "DESIGN_FILE_EXTENSION_MISMATCH",
        "ERROR",
        "originalFileName",
        `File signature requires the ${expectedExtension} extension`,
      ),
    );
  }

  let inspectedPdf: InspectedPdfDocument | null = null;
  if (preliminary === "PDF" && input.data.byteLength <= policy.maxFileBytes) {
    try {
      inspectedPdf = await inspectPdfDocument(input.data, {
        maxPages: policy.maxPdfPages,
      });
    } catch (error) {
      issues.push(
        issue(
          "DESIGN_PDF_INVALID",
          "ERROR",
          "data",
          error instanceof Error ? error.message : "PDF parsing failed",
        ),
      );
    }
  }
  if (preliminary === "XLSX" && input.data.byteLength <= policy.maxFileBytes) {
    try {
      inspectXlsxContainer(input.data, {
        maxEntries: policy.maxXlsxEntries,
        maxUncompressedBytes: policy.maxXlsxUncompressedBytes,
        maxCompressionRatio: policy.maxXlsxCompressionRatio,
      });
    } catch (error) {
      issues.push(
        issue(
          "DESIGN_XLSX_INVALID",
          "ERROR",
          "data",
          error instanceof Error ? error.message : "XLSX validation failed",
        ),
      );
    }
  }

  const discipline =
    preliminary === "PDF"
      ? inferDiscipline(inspectedPdf?.text ?? "", input.disciplineHint)
      : "GENERAL";
  const classification =
    preliminary === "XLSX"
      ? "PROJECT_WORKBOOK"
      : discipline === "ARCHITECTURE"
        ? "ARCHITECTURAL_DRAWING"
        : discipline === "STRUCTURE"
          ? "STRUCTURAL_DRAWING"
          : discipline === "MECHANICAL" ||
              discipline === "ELECTRICAL" ||
              discipline === "PLUMBING" ||
              discipline === "FIRE_SAFETY"
            ? "MEP_DRAWING"
            : "UNKNOWN";

  if (preliminary === "PDF" && discipline === "UNKNOWN" && inspectedPdf !== null) {
    issues.push(
      issue(
        "DESIGN_DISCIPLINE_UNKNOWN",
        "WARNING",
        "discipline",
        "Drawing discipline requires engineer confirmation",
      ),
    );
  }
  if (preliminary === "PDF" && !["ARCHITECTURE", "UNKNOWN"].includes(discipline)) {
    issues.push(
      issue(
        "DESIGN_DISCIPLINE_OUT_OF_SCOPE",
        "ERROR",
        "discipline",
        `${discipline} drawings are outside the Phase 6 architectural MVP`,
      ),
    );
  }
  if (inspectedPdf?.pages.some((page) => ["RASTER", "EMPTY"].includes(page.contentMode))) {
    issues.push(
      issue(
        "DESIGN_PDF_NON_VECTOR_PAGE",
        "ERROR",
        "pages",
        "Raster-only or empty pages are outside the vector PDF MVP",
      ),
    );
  } else if (inspectedPdf?.pages.some((page) => page.contentMode === "MIXED")) {
    issues.push(
      issue(
        "DESIGN_PDF_MIXED_CONTENT",
        "WARNING",
        "pages",
        "Mixed vector/raster pages require engineer review",
      ),
    );
  }

  const duplicateFile = input.existingFiles?.find((existing) => existing.sha256 === contentSha256);
  if (duplicateFile !== undefined) {
    issues.push(
      issue(
        "DESIGN_FILE_DUPLICATE",
        "WARNING",
        "sha256",
        `Exact duplicate of document ${duplicateFile.documentId}`,
      ),
    );
  }

  const hasError = issues.some((item) => item.severity === "ERROR");
  const hasWarning = issues.some((item) => item.severity === "WARNING");
  let storedArtifact = null;
  if (
    input.artifactStore !== undefined &&
    scan.status === "CLEAN" &&
    preliminary !== null &&
    !hasError
  ) {
    storedArtifact = await input.artifactStore.put({
      artifactId: input.artifactId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      mediaType:
        preliminary === "PDF"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: input.data,
      malwareScan: scan,
      retention: {
        schemaVersion: 1,
        classification: "SOURCE_PRIVATE",
        createdAt: input.createdAt ?? new Date().toISOString(),
        expiresAt: null,
        legalHold: false,
        deletionStatus: "ACTIVE",
      },
    });
  }

  const pages =
    inspectedPdf?.pages.map(
      ({ textSpans: _textSpans, vectorPaths: _vectorPaths, ...profile }) => profile,
    ) ?? [];
  const extractionMode =
    preliminary === "XLSX"
      ? "TABULAR"
      : inspectedPdf === null
        ? "UNKNOWN"
        : inspectedPdf.pages.some((page) => page.contentMode === "MIXED")
          ? "MIXED"
          : inspectedPdf.pages.every((page) => page.contentMode === "VECTOR")
            ? "VECTOR"
            : inspectedPdf.pages.every((page) => page.contentMode === "RASTER")
              ? "RASTER"
              : "UNKNOWN";

  const result = designFileIntakeResultV1Schema.parse({
    schemaVersion: 1,
    intakeType: "DESIGN_FILE_INTAKE",
    intakeId: input.intakeId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    documentId: input.documentId,
    artifactId: input.artifactId,
    originalFileName: input.originalFileName,
    detectedMediaType: preliminary,
    mediaTypeValue:
      preliminary === "PDF"
        ? "application/pdf"
        : preliminary === "XLSX"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : null,
    sha256: contentSha256,
    sizeBytes: input.data.byteLength,
    malwareScan: scan,
    duplicate: {
      exactDuplicate: duplicateFile !== undefined,
      duplicateOfDocumentId: duplicateFile?.documentId ?? null,
      duplicateOfArtifactId: duplicateFile?.artifactId ?? null,
    },
    classification,
    discipline,
    extractionMode,
    pageCount: inspectedPdf?.pageCount ?? null,
    pages,
    storedArtifact,
    status: hasError ? "REJECTED" : hasWarning ? "REVIEW_REQUIRED" : "ACCEPTED",
    issues,
    deterministic: true,
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: input.createdBy,
  });

  return { result, inspectedPdf };
}
