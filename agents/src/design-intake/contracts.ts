import { z } from "zod";
import { malwareScanResultV1Schema, storedArtifactV1Schema } from "../artifacts/contracts.js";
import {
  buildWatchReviewDecisionSchema,
  buildWatchSourceReferenceSchema,
} from "../contracts/buildwatch-v2-common.js";
import {
  contractIdentifierSchema,
  contractIsoDateTimeSchema,
  contractValidationIssueSchema,
} from "../contracts/common.js";
import {
  designDocumentClassificationSchema,
  designDocumentDisciplineSchema,
  designElementCandidateV1Schema,
  drawingRevisionV1Schema,
  drawingSourceUnitSchema,
  verifiedDrawingScaleV1Schema,
} from "../contracts/design/index.js";

export const designIntakeMediaTypeSchema = z.enum(["PDF", "XLSX"]);

export const pdfPageContentModeSchema = z.enum(["VECTOR", "RASTER", "MIXED", "EMPTY"]);

export const pdfPageProfileV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    pageNumber: z.number().int().positive().max(10_000),
    widthPt: z.number().finite().positive(),
    heightPt: z.number().finite().positive(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    vectorOperatorCount: z.number().int().nonnegative(),
    imageOperatorCount: z.number().int().nonnegative(),
    textItemCount: z.number().int().nonnegative(),
    contentMode: pdfPageContentModeSchema,
  })
  .strict();

export const designIntakeStatusSchema = z.enum(["ACCEPTED", "REVIEW_REQUIRED", "REJECTED"]);

export const designFileDuplicateResultV1Schema = z
  .object({
    exactDuplicate: z.boolean(),
    duplicateOfDocumentId: contractIdentifierSchema.nullable(),
    duplicateOfArtifactId: contractIdentifierSchema.nullable(),
  })
  .strict()
  .superRefine((duplicate, context) => {
    if (duplicate.exactDuplicate !== (duplicate.duplicateOfDocumentId !== null)) {
      context.addIssue({
        code: "custom",
        message: "Exact duplicate status must match its document lineage",
        path: ["duplicateOfDocumentId"],
      });
    }

    if (duplicate.exactDuplicate !== (duplicate.duplicateOfArtifactId !== null)) {
      context.addIssue({
        code: "custom",
        message: "Exact duplicate status must match its artifact lineage",
        path: ["duplicateOfArtifactId"],
      });
    }
  });

export const designFileIntakeResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    intakeType: z.literal("DESIGN_FILE_INTAKE"),
    intakeId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    documentId: contractIdentifierSchema,
    artifactId: contractIdentifierSchema,
    originalFileName: z.string().trim().min(1).max(500),
    detectedMediaType: designIntakeMediaTypeSchema.nullable(),
    mediaTypeValue: z
      .enum([
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ])
      .nullable(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
    malwareScan: malwareScanResultV1Schema,
    duplicate: designFileDuplicateResultV1Schema,
    classification: designDocumentClassificationSchema,
    discipline: designDocumentDisciplineSchema,
    extractionMode: z.enum(["VECTOR", "RASTER", "MIXED", "TABULAR", "UNKNOWN"]),
    pageCount: z.number().int().positive().max(10_000).nullable(),
    pages: z.array(pdfPageProfileV1Schema).max(10_000),
    storedArtifact: storedArtifactV1Schema.nullable(),
    status: designIntakeStatusSchema,
    issues: z.array(contractValidationIssueSchema).max(1_000),
    deterministic: z.literal(true),
    createdAt: contractIsoDateTimeSchema,
    createdBy: contractIdentifierSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.sha256 !== result.malwareScan.sha256) {
      context.addIssue({
        code: "custom",
        message: "Intake checksum must match malware scan checksum",
        path: ["malwareScan", "sha256"],
      });
    }

    if (
      result.storedArtifact !== null &&
      (result.storedArtifact.sha256 !== result.sha256 ||
        result.storedArtifact.tenantId !== result.tenantId ||
        result.storedArtifact.projectId !== result.projectId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Stored artifact must match the intake scope and bytes",
        path: ["storedArtifact"],
      });
    }

    if (result.detectedMediaType === "PDF") {
      if (result.pageCount === null || result.pages.length !== result.pageCount) {
        context.addIssue({
          code: "custom",
          message: "PDF intake requires one profile for every page",
          path: ["pages"],
        });
      }
    } else if (result.pageCount !== null || result.pages.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Workbook intake cannot contain PDF page profiles",
        path: ["pages"],
      });
    }

    if ((result.detectedMediaType === null) !== (result.mediaTypeValue === null)) {
      context.addIssue({
        code: "custom",
        message: "Detected media type and MIME value must be set together",
        path: ["mediaTypeValue"],
      });
    }

    const hasError = result.issues.some((issue) => issue.severity === "ERROR");
    if (result.status === "REJECTED" && !hasError) {
      context.addIssue({
        code: "custom",
        message: "Rejected intake requires a deterministic error",
        path: ["status"],
      });
    }
    if (result.status !== "REJECTED" && hasError) {
      context.addIssue({
        code: "custom",
        message: "Intake with errors must be rejected",
        path: ["status"],
      });
    }
  });

export const workbookImportStatusSchema = z.enum(["READY_FOR_REVIEW", "INVALID"]);

export const workbookColumnMappingStatusSchema = z.enum([
  "EXACT",
  "NORMALIZED",
  "MISSING",
  "UNEXPECTED",
]);

export const workbookColumnMappingV1Schema = z
  .object({
    sourceColumn: z.string().trim().min(1).max(200).nullable(),
    targetColumn: z.string().trim().min(1).max(200).nullable(),
    status: workbookColumnMappingStatusSchema,
  })
  .strict();

export const workbookCellValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const workbookImportedRowV1Schema = z
  .object({
    rowNumber: z.number().int().min(2).max(10_000_000),
    values: z.record(z.string(), workbookCellValueSchema),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRef: buildWatchSourceReferenceSchema,
  })
  .strict();

export const workbookSheetImportV1Schema = z
  .object({
    sheetName: z.string().trim().min(1).max(200),
    required: z.boolean(),
    present: z.boolean(),
    checksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    headerRowNumber: z.literal(1),
    columnMappings: z.array(workbookColumnMappingV1Schema).max(500),
    sourceRowCount: z.number().int().nonnegative(),
    acceptedRows: z.array(workbookImportedRowV1Schema).max(1_000_000),
    rejectedRowNumbers: z.array(z.number().int().min(2).max(10_000_000)).max(1_000_000),
    issues: z.array(contractValidationIssueSchema).max(100_000),
  })
  .strict();

export const engineeringWorkbookImportV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    importType: z.literal("ENGINEERING_WORKBOOK"),
    importId: contractIdentifierSchema,
    importVersion: z.number().int().positive(),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    sourceArtifactId: contractIdentifierSchema,
    sourceDocumentId: contractIdentifierSchema,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    workbookChecksum: z.string().regex(/^[a-f0-9]{64}$/),
    sheets: z.array(workbookSheetImportV1Schema).length(18),
    status: workbookImportStatusSchema,
    issues: z.array(contractValidationIssueSchema).max(100_000),
    deterministic: z.literal(true),
    importedAt: contractIsoDateTimeSchema,
    importedBy: contractIdentifierSchema,
  })
  .strict()
  .superRefine((workbook, context) => {
    if (workbook.sourceSha256 !== workbook.workbookChecksum) {
      context.addIssue({
        code: "custom",
        message: "Workbook checksum must match the source artifact",
        path: ["workbookChecksum"],
      });
    }

    if (new Set(workbook.sheets.map((sheet) => sheet.sheetName)).size !== 18) {
      context.addIssue({
        code: "custom",
        message: "Workbook import requires 18 unique canonical sheets",
        path: ["sheets"],
      });
    }

    const hasError = [...workbook.issues, ...workbook.sheets.flatMap((sheet) => sheet.issues)].some(
      (issue) => issue.severity === "ERROR",
    );
    if ((workbook.status === "INVALID") !== hasError) {
      context.addIssue({
        code: "custom",
        message: "Workbook status must reflect its validation errors",
        path: ["status"],
      });
    }
  });

export const drawingScaleSourceTypeSchema = z.enum([
  "VECTOR_DIMENSION",
  "TITLE_BLOCK",
  "ENGINEER_KNOWN_DISTANCE",
  "APPROVED_MANUAL_CALIBRATION",
]);

export const drawingScaleCandidateStatusSchema = z.enum(["UNKNOWN", "CANDIDATE", "REJECTED"]);

export const drawingScaleCandidateV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    candidateType: z.literal("DRAWING_SCALE"),
    candidateId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    revisionId: contractIdentifierSchema,
    pageId: contractIdentifierSchema,
    sourceType: drawingScaleSourceTypeSchema,
    sourcePriority: z.number().int().min(1).max(4),
    status: drawingScaleCandidateStatusSchema,
    drawingUnits: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/)
      .nullable(),
    drawingUnit: drawingSourceUnitSchema.nullable(),
    realWorldUnits: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/)
      .nullable(),
    realWorldUnit: z.literal("m"),
    displayScale: z.string().trim().min(1).max(100).nullable(),
    confidence: z.number().finite().min(0).max(1),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
    extractionVersion: z.string().trim().min(1).max(200),
    issues: z.array(contractValidationIssueSchema).max(100),
    createdAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    const hasRatio =
      candidate.drawingUnits !== null &&
      candidate.drawingUnit !== null &&
      candidate.realWorldUnits !== null;
    if ((candidate.status === "CANDIDATE") !== hasRatio) {
      context.addIssue({
        code: "custom",
        message: "Only a scale candidate may contain a complete ratio",
        path: ["status"],
      });
    }
  });

export const drawingRevisionRegistrationV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    registrationType: z.literal("DRAWING_REVISION_REGISTRATION"),
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    documentId: contractIdentifierSchema,
    revision: drawingRevisionV1Schema.nullable(),
    conflictRevisionIds: z.array(contractIdentifierSchema).max(10_000),
    requiresHumanReview: z.boolean(),
    issues: z.array(contractValidationIssueSchema).max(1_000),
    registeredAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((registration, context) => {
    if (registration.conflictRevisionIds.length > 0 && !registration.requiresHumanReview) {
      context.addIssue({
        code: "custom",
        message: "Revision conflicts must enter human review",
        path: ["requiresHumanReview"],
      });
    }

    if (registration.revision === null && !registration.requiresHumanReview) {
      context.addIssue({
        code: "custom",
        message: "Missing revision metadata must enter human review",
        path: ["requiresHumanReview"],
      });
    }

    if (
      registration.revision !== null &&
      (registration.revision.tenantId !== registration.tenantId ||
        registration.revision.projectId !== registration.projectId ||
        registration.revision.documentId !== registration.documentId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Registered revision must match the registration scope",
        path: ["revision"],
      });
    }
  });

export const designExtractionBatchV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    extractionType: z.literal("VECTOR_ARCHITECTURE"),
    extractionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    revisionId: contractIdentifierSchema,
    sourceArtifactId: contractIdentifierSchema,
    scaleCandidates: z.array(drawingScaleCandidateV1Schema).max(100),
    verifiedScales: z.array(verifiedDrawingScaleV1Schema).max(100),
    elementCandidates: z.array(designElementCandidateV1Schema).max(100_000),
    issues: z.array(contractValidationIssueSchema).max(10_000),
    deterministic: z.literal(true),
    extractionVersion: z.string().trim().min(1).max(200),
    extractedAt: contractIsoDateTimeSchema,
  })
  .strict();

export const designReviewOperationSchema = z.enum([
  "ACCEPT",
  "EDIT",
  "REJECT",
  "MERGE",
  "SPLIT",
  "SCALE_VERIFY",
  "SCALE_REJECT",
]);

export const designReviewAuditV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    auditType: z.literal("DESIGN_REVIEW_AUDIT"),
    auditId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    operation: designReviewOperationSchema,
    sourceIds: z.array(contractIdentifierSchema).min(1).max(10_000),
    resultIds: z.array(contractIdentifierSchema).max(10_000),
    beforeHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
    afterHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
    reason: z.string().trim().min(1).max(2_000),
    actorId: contractIdentifierSchema,
    actorRole: z.literal("ENGINEER"),
    reviewDecision: buildWatchReviewDecisionSchema,
    occurredAt: contractIsoDateTimeSchema,
  })
  .strict();

export type PdfPageProfileV1 = z.infer<typeof pdfPageProfileV1Schema>;
export type DesignFileIntakeResultV1 = z.infer<typeof designFileIntakeResultV1Schema>;
export type EngineeringWorkbookImportV1 = z.infer<typeof engineeringWorkbookImportV1Schema>;
export type WorkbookSheetImportV1 = z.infer<typeof workbookSheetImportV1Schema>;
export type DrawingScaleCandidateV1 = z.infer<typeof drawingScaleCandidateV1Schema>;
export type DrawingRevisionRegistrationV1 = z.infer<typeof drawingRevisionRegistrationV1Schema>;
export type DesignExtractionBatchV1 = z.infer<typeof designExtractionBatchV1Schema>;
export type DesignReviewAuditV1 = z.infer<typeof designReviewAuditV1Schema>;
