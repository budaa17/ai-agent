import { z } from "zod";
import {
  confidenceLevelFromScore,
  contractConfidenceLevelSchema,
  contractFieldConfidenceSchema,
  contractIdentifierSchema,
  contractImageRegionSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  contractValidationIssueSchema,
} from "../common.js";
import {
  buildWatchDraftStatusSchema,
  buildWatchPositiveDecimalSchema,
  buildWatchReviewDecisionSchema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  hasUniqueContractIds,
  sourceReferenceMatchesScope,
} from "../buildwatch-v2-common.js";

export const designDocumentMediaTypeSchema = z.enum([
  "PDF",
  "XLSX",
  "PNG",
  "JPEG",
  "WEBP",
  "CSV",
  "DOCX",
  "IFC",
]);

export const designDocumentClassificationSchema = z.enum([
  "ARCHITECTURAL_DRAWING",
  "STRUCTURAL_DRAWING",
  "MEP_DRAWING",
  "PROJECT_WORKBOOK",
  "TECHNICAL_DESCRIPTION",
  "CATALOG",
  "PHOTO",
  "UNKNOWN",
]);

export const designDocumentDisciplineSchema = z.enum([
  "ARCHITECTURE",
  "STRUCTURE",
  "MECHANICAL",
  "ELECTRICAL",
  "PLUMBING",
  "FIRE_SAFETY",
  "GENERAL",
  "UNKNOWN",
]);

export const designExtractionModeSchema = z.enum(["VECTOR", "RASTER", "TABULAR", "TEXT", "BIM"]);

export const designDocumentStatusSchema = z.enum([
  "UPLOADED",
  "CLASSIFIED",
  "REVIEW_REQUIRED",
  "ACCEPTED",
  "REJECTED",
]);

export const designDocumentEntrySchema = z
  .object({
    documentId: contractIdentifierSchema,
    artifactId: contractIdentifierSchema,
    originalFileName: z.string().trim().min(1).max(500),
    mediaType: designDocumentMediaTypeSchema,
    mediaTypeValue: z.string().trim().min(1).max(200),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive(),
    classification: designDocumentClassificationSchema,
    discipline: designDocumentDisciplineSchema,
    extractionMode: designExtractionModeSchema,
    pageCount: z.number().int().positive().max(100_000).nullable(),
    duplicateOfDocumentId: contractIdentifierSchema.nullable(),
    status: designDocumentStatusSchema,
  })
  .strict()
  .superRefine((document, context) => {
    if (document.status === "ACCEPTED" && document.classification === "UNKNOWN") {
      context.addIssue({
        code: "custom",
        message: "Accepted design documents require a classification",
        path: ["classification"],
      });
    }

    if (document.mediaType === "PDF" && document.pageCount === null) {
      context.addIssue({
        code: "custom",
        message: "PDF documents require a page count",
        path: ["pageCount"],
      });
    }
  });

export const designDocumentManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    manifestType: z.literal("DESIGN_INTAKE"),
    manifestId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    createdAt: contractIsoDateTimeSchema,
    createdBy: contractIdentifierSchema,
    documents: z.array(designDocumentEntrySchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (!hasUniqueContractIds(manifest.documents.map((document) => document.documentId))) {
      context.addIssue({
        code: "custom",
        message: "Design document identifiers must be unique",
        path: ["documents"],
      });
    }

    const documentIds = new Set(manifest.documents.map((document) => document.documentId));
    const documentsByHash = new Map<string, string[]>();

    manifest.documents.forEach((document, index) => {
      if (
        document.duplicateOfDocumentId !== null &&
        (!documentIds.has(document.duplicateOfDocumentId) ||
          document.duplicateOfDocumentId === document.documentId)
      ) {
        context.addIssue({
          code: "custom",
          message: "Duplicate design document must reference another document in the manifest",
          path: ["documents", index, "duplicateOfDocumentId"],
        });
      }

      const matchingIds = documentsByHash.get(document.sha256) ?? [];
      matchingIds.push(document.documentId);
      documentsByHash.set(document.sha256, matchingIds);
    });

    for (const matchingIds of documentsByHash.values()) {
      if (matchingIds.length < 2) {
        continue;
      }

      for (const documentId of matchingIds.slice(1)) {
        const index = manifest.documents.findIndex(
          (document) => document.documentId === documentId,
        );
        if (index >= 0 && manifest.documents[index]?.duplicateOfDocumentId === null) {
          context.addIssue({
            code: "custom",
            message: "Documents with an identical checksum require duplicate lineage",
            path: ["documents", index, "duplicateOfDocumentId"],
          });
        }
      }
    }
  });

export const drawingScaleStatusSchema = z.enum(["UNKNOWN", "CANDIDATE", "VERIFIED", "REJECTED"]);

export const drawingRevisionStatusSchema = z.enum([
  "CANDIDATE",
  "ACTIVE",
  "SUPERSEDED",
  "REJECTED",
]);

export const drawingPageSchema = z
  .object({
    pageId: contractIdentifierSchema,
    pageNumber: z.number().int().positive().max(100_000),
    sheetCode: z.string().trim().min(1).max(200).nullable(),
    title: z.string().trim().min(1).max(500).nullable(),
    discipline: designDocumentDisciplineSchema,
    scaleStatus: drawingScaleStatusSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const drawingRevisionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    revisionType: z.literal("DRAWING_REVISION"),
    revisionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    documentId: contractIdentifierSchema,
    revisionCode: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(500),
    discipline: designDocumentDisciplineSchema,
    issuedOn: contractIsoDateSchema,
    status: drawingRevisionStatusSchema,
    supersedesRevisionId: contractIdentifierSchema.nullable(),
    pages: z.array(drawingPageSchema).min(1).max(10_000),
    createdAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((revision, context) => {
    if (
      revision.supersedesRevisionId !== null &&
      revision.supersedesRevisionId === revision.revisionId
    ) {
      context.addIssue({
        code: "custom",
        message: "A drawing revision cannot supersede itself",
        path: ["supersedesRevisionId"],
      });
    }

    if (
      !hasUniqueContractIds(revision.pages.map((page) => page.pageId)) ||
      !hasUniqueContractIds(revision.pages.map((page) => String(page.pageNumber)))
    ) {
      context.addIssue({
        code: "custom",
        message: "Drawing page identifiers and numbers must be unique",
        path: ["pages"],
      });
    }

    revision.pages.forEach((page, pageIndex) => {
      page.sourceRefs.forEach((source, sourceIndex) => {
        if (!sourceReferenceMatchesScope(source, revision.tenantId, revision.projectId)) {
          context.addIssue({
            code: "custom",
            message: "Drawing page source is outside the revision scope",
            path: ["pages", pageIndex, "sourceRefs", sourceIndex],
          });
        }
      });
    });
  });

export const drawingSourceUnitSchema = z.enum(["mm", "cm", "m", "pt", "px"]);

export const verifiedDrawingScaleV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    scaleType: z.literal("VERIFIED_DRAWING_SCALE"),
    scaleId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    revisionId: contractIdentifierSchema,
    pageId: contractIdentifierSchema,
    status: z.literal("VERIFIED"),
    drawingUnits: buildWatchPositiveDecimalSchema,
    drawingUnit: drawingSourceUnitSchema,
    realWorldUnits: buildWatchPositiveDecimalSchema,
    realWorldUnit: z.literal("m"),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
    reviewedBy: contractIdentifierSchema,
    reviewedAt: contractIsoDateTimeSchema,
    reviewDecision: buildWatchReviewDecisionSchema,
  })
  .strict()
  .superRefine((scale, context) => {
    if (scale.reviewDecision.action !== "APPROVE") {
      context.addIssue({
        code: "custom",
        message: "A verified scale requires an approval decision",
        path: ["reviewDecision", "action"],
      });
    }

    scale.sourceRefs.forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, scale.tenantId, scale.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Drawing scale source is outside the scale scope",
          path: ["sourceRefs", index],
        });
      }
    });
  });

export const designElementTypeSchema = z.enum([
  "FLOOR",
  "ZONE",
  "ROOM",
  "WALL",
  "DOOR",
  "WINDOW",
  "COLUMN",
  "BEAM",
  "SLAB",
  "OTHER",
]);

export const designGeometryTypeSchema = z.enum([
  "POINT",
  "LINE",
  "POLYLINE",
  "POLYGON",
  "RECTANGLE",
  "UNKNOWN",
]);

export const designElementExtractionMethodSchema = z.enum([
  "PDF_VECTOR_LABEL",
  "ENGINEER_EDIT",
  "ENGINEER_MERGE",
  "ENGINEER_SPLIT",
]);

export const designDimensionKindSchema = z.enum([
  "LENGTH",
  "WIDTH",
  "HEIGHT",
  "AREA",
  "VOLUME",
  "COUNT",
  "THICKNESS",
]);

export const designElementDimensionSchema = z
  .object({
    dimensionId: contractIdentifierSchema,
    kind: designDimensionKindSchema,
    quantity: buildWatchSourceBackedQuantitySchema,
  })
  .strict();

export const designMissingInformationIssueSchema = z
  .object({
    issueId: contractIdentifierSchema,
    code: z.string().trim().min(1).max(100),
    fieldPath: z.string().trim().min(1).max(500),
    message: z.string().trim().min(1).max(2_000),
    clarificationQuestion: z.string().trim().min(1).max(2_000),
    blocksQuantity: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).max(100),
  })
  .strict();

export const designElementCandidateStatusSchema = z.enum([
  "CANDIDATE",
  "REVIEW_REQUIRED",
  "ACCEPTED",
  "REJECTED",
]);

export const designElementCandidateV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    candidateType: z.literal("DESIGN_ELEMENT"),
    candidateId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    revisionId: contractIdentifierSchema,
    pageId: contractIdentifierSchema,
    scaleId: contractIdentifierSchema.nullable(),
    elementType: designElementTypeSchema,
    elementCode: z.string().trim().min(1).max(200).nullable(),
    name: z.string().trim().min(1).max(500),
    floorCode: z.string().trim().min(1).max(200).nullable(),
    zoneCode: z.string().trim().min(1).max(200).nullable(),
    geometryType: designGeometryTypeSchema,
    boundingRegion: contractImageRegionSchema,
    extractionMethod: designElementExtractionMethodSchema,
    extractionVersion: z.string().trim().min(1).max(200),
    dimensions: z.array(designElementDimensionSchema).max(100),
    properties: z.record(z.string().trim().min(1).max(200), z.string().trim().min(1).max(2_000)),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
    confidence: z.number().finite().min(0).max(1),
    confidenceLevel: contractConfidenceLevelSchema,
    fieldConfidence: z.array(contractFieldConfidenceSchema).max(100),
    status: designElementCandidateStatusSchema,
    reviewDecision: buildWatchReviewDecisionSchema.nullable(),
    missingInformation: z.array(designMissingInformationIssueSchema).max(100),
    validationIssues: z.array(contractValidationIssueSchema).max(100),
    official: z.literal(false),
    createdAt: contractIsoDateTimeSchema,
    createdBy: contractIdentifierSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.confidenceLevel !== confidenceLevelFromScore(candidate.confidence)) {
      context.addIssue({
        code: "custom",
        message: "Candidate confidence level conflicts with its score",
        path: ["confidenceLevel"],
      });
    }

    if (candidate.status === "ACCEPTED" && candidate.reviewDecision?.action !== "APPROVE") {
      context.addIssue({
        code: "custom",
        message: "Accepted element candidates require approval",
        path: ["reviewDecision"],
      });
    }

    if (candidate.dimensions.length > 0 && candidate.scaleId === null) {
      context.addIssue({
        code: "custom",
        message: "Metric element dimensions require a verified scale reference",
        path: ["scaleId"],
      });
    }

    if (
      !candidate.sourceRefs.some(
        (source) =>
          source.pageNumber !== null &&
          source.region !== null &&
          source.region.x === candidate.boundingRegion.x &&
          source.region.y === candidate.boundingRegion.y &&
          source.region.width === candidate.boundingRegion.width &&
          source.region.height === candidate.boundingRegion.height,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Element bounding region must be backed by a page source",
        path: ["boundingRegion"],
      });
    }

    const confidencePaths = new Set(candidate.fieldConfidence.map((field) => field.fieldPath));
    const requiredConfidencePaths = [
      "elementType",
      "name",
      "geometryType",
      "boundingRegion",
      ...(candidate.elementCode === null ? [] : ["elementCode"]),
      ...(candidate.floorCode === null ? [] : ["floorCode"]),
      ...(candidate.zoneCode === null ? [] : ["zoneCode"]),
    ];
    for (const fieldPath of requiredConfidencePaths) {
      if (!confidencePaths.has(fieldPath)) {
        context.addIssue({
          code: "custom",
          message: `Element field ${fieldPath} requires confidence evidence`,
          path: ["fieldConfidence"],
        });
      }
    }

    if (candidate.status === "REJECTED" && candidate.reviewDecision?.action !== "REJECT") {
      context.addIssue({
        code: "custom",
        message: "Rejected element candidates require a rejection decision",
        path: ["reviewDecision"],
      });
    }

    if (
      ["CANDIDATE", "REVIEW_REQUIRED"].includes(candidate.status) &&
      candidate.reviewDecision !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Unreviewed candidates cannot contain a review decision",
        path: ["reviewDecision"],
      });
    }

    if (!hasUniqueContractIds(candidate.dimensions.map((dimension) => dimension.dimensionId))) {
      context.addIssue({
        code: "custom",
        message: "Element dimension identifiers must be unique",
        path: ["dimensions"],
      });
    }

    const allSources = [
      ...candidate.sourceRefs,
      ...candidate.dimensions.flatMap((dimension) => dimension.quantity.sourceRefs),
      ...candidate.missingInformation.flatMap((issue) => issue.sourceRefs),
    ];
    allSources.forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, candidate.tenantId, candidate.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Element candidate source is outside its scope",
          path: ["sourceRefs", index],
        });
      }
    });
  });

export const designReviewEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    reviewType: z.literal("DESIGN_REVIEW"),
    reviewId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    candidateIds: z.array(contractIdentifierSchema).min(1).max(10_000),
    status: buildWatchDraftStatusSchema,
    validationIssues: z.array(contractValidationIssueSchema).max(1_000),
    createdAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((review, context) => {
    if (!hasUniqueContractIds(review.candidateIds)) {
      context.addIssue({
        code: "custom",
        message: "Design review candidate identifiers must be unique",
        path: ["candidateIds"],
      });
    }
  });

export type DesignDocumentManifestV1 = z.infer<typeof designDocumentManifestV1Schema>;
export type DrawingRevisionV1 = z.infer<typeof drawingRevisionV1Schema>;
export type VerifiedDrawingScaleV1 = z.infer<typeof verifiedDrawingScaleV1Schema>;
export type DesignElementCandidateV1 = z.infer<typeof designElementCandidateV1Schema>;
export type DesignMissingInformationIssue = z.infer<typeof designMissingInformationIssueSchema>;
