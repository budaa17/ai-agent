import { z } from "zod";
import {
  contractDecimalSchema,
  contractIdentifierSchema,
  contractImageRegionSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
} from "./common.js";

export const buildWatchCanonicalUnitSchema = z.enum([
  "m",
  "m2",
  "m3",
  "kg",
  "pcs",
  "h",
  "working_day",
  "percent",
]);

export const buildWatchSourceTypeSchema = z.enum([
  "APPROVED_ENGINEER_QUANTITY",
  "VERIFIED_VECTOR_GEOMETRY",
  "APPROVED_EXCEL",
  "EXCEL_IMPORT_ROW",
  "DRAWING_REGION",
  "DAILY_REPORT",
  "PHOTO_EVIDENCE",
  "MATERIAL_LEDGER",
  "CATALOG_VERSION",
  "SCHEDULE_VERSION",
  "CALENDAR_VERSION",
  "RESOURCE_AVAILABILITY",
  "WEATHER_LOGISTICS",
  "INSPECTION",
  "BLOCKER",
  "SYSTEM_CALCULATION",
  "HUMAN_DECISION",
]);

export const buildWatchSourceReferenceSchema = z
  .object({
    sourceRefId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    sourceType: buildWatchSourceTypeSchema,
    sourceId: contractIdentifierSchema,
    sourceVersionId: contractIdentifierSchema.nullable(),
    artifactId: contractIdentifierSchema.nullable(),
    pageNumber: z.number().int().positive().max(100_000).nullable(),
    sheetName: z.string().trim().min(1).max(200).nullable(),
    rowNumber: z.number().int().positive().max(10_000_000).nullable(),
    fieldPath: z.string().trim().min(1).max(500).nullable(),
    region: contractImageRegionSchema.nullable(),
    asOf: contractIsoDateTimeSchema.nullable(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.region !== null && source.artifactId === null) {
      context.addIssue({
        code: "custom",
        message: "A source region requires an artifact reference",
        path: ["artifactId"],
      });
    }

    if (source.pageNumber !== null && source.artifactId === null) {
      context.addIssue({
        code: "custom",
        message: "A source page requires an artifact reference",
        path: ["artifactId"],
      });
    }

    if (source.rowNumber !== null && source.sheetName === null) {
      context.addIssue({
        code: "custom",
        message: "A source row requires a sheet name",
        path: ["sheetName"],
      });
    }
  });

export const buildWatchNonnegativeDecimalSchema = contractDecimalSchema.refine((value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0;
}, "Decimal must be nonnegative");

export const buildWatchPositiveDecimalSchema = contractDecimalSchema.refine((value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}, "Decimal must be positive");

export const buildWatchRatioDecimalSchema = contractDecimalSchema.refine((value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1;
}, "Ratio must be between 0 and 1");

export const buildWatchSignedPercentageDecimalSchema = contractDecimalSchema.refine((value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= -100 && numeric <= 100;
}, "Percentage must be between -100 and 100");

export const buildWatchCanonicalQuantitySchema = z
  .object({
    value: contractDecimalSchema,
    unit: buildWatchCanonicalUnitSchema,
  })
  .strict();

export const buildWatchSourceBackedQuantitySchema = z
  .object({
    value: contractDecimalSchema,
    unit: buildWatchCanonicalUnitSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const buildWatchCatalogTypeSchema = z.enum([
  "MATERIAL_NORM",
  "PRICE",
  "PRODUCTIVITY",
  "WORK_TEMPLATE",
  "CALENDAR",
  "POLICY",
]);

export const buildWatchCatalogVersionReferenceSchema = z
  .object({
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    catalogType: buildWatchCatalogTypeSchema,
    versionId: contractIdentifierSchema,
    version: z.number().int().positive(),
    effectiveFrom: contractIsoDateSchema,
    effectiveTo: contractIsoDateSchema.nullable(),
    approvedBy: contractIdentifierSchema,
    approvedAt: contractIsoDateTimeSchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((version, context) => {
    if (version.effectiveTo !== null && version.effectiveTo < version.effectiveFrom) {
      context.addIssue({
        code: "custom",
        message: "Catalog effective end cannot precede its start",
        path: ["effectiveTo"],
      });
    }
  });

export const buildWatchReviewActionSchema = z.enum(["APPROVE", "REJECT", "REQUEST_CHANGES"]);

export const buildWatchReviewerRoleSchema = z.enum([
  "ENGINEER",
  "ESTIMATOR",
  "SITE_ENGINEER",
  "PROJECT_MANAGER",
  "SYSTEM_ADMIN",
]);

export const buildWatchReviewDecisionSchema = z
  .object({
    decisionId: contractIdentifierSchema,
    action: buildWatchReviewActionSchema,
    reviewerId: contractIdentifierSchema,
    reviewerRole: buildWatchReviewerRoleSchema,
    decidedAt: contractIsoDateTimeSchema,
    reason: z.string().trim().min(1).max(2_000).nullable(),
    correctedFieldPaths: z.array(z.string().trim().min(1).max(500)).max(500),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.action !== "APPROVE" && decision.reason === null) {
      context.addIssue({
        code: "custom",
        message: "Reject and request-changes decisions require a reason",
        path: ["reason"],
      });
    }
  });

export const buildWatchReviewLifecycleStatusSchema = z.enum([
  "DRAFT",
  "REVIEW_REQUIRED",
  "REJECTED",
  "APPROVED",
  "APPLIED",
  "SUPERSEDED",
  "CANCELLED",
]);

export const buildWatchReviewTargetTypeSchema = z.enum([
  "DESIGN_CANDIDATE",
  "QUANTITY_TAKEOFF",
  "ESTIMATE",
  "SCHEDULE",
  "BASELINE",
  "PROGRESS_VERIFICATION",
]);

const allowedReviewLifecycleTransitions: Readonly<
  Record<
    z.infer<typeof buildWatchReviewLifecycleStatusSchema>,
    readonly z.infer<typeof buildWatchReviewLifecycleStatusSchema>[]
  >
> = {
  DRAFT: ["REVIEW_REQUIRED", "CANCELLED"],
  REVIEW_REQUIRED: ["DRAFT", "REJECTED", "APPROVED", "CANCELLED"],
  REJECTED: ["DRAFT"],
  APPROVED: ["APPLIED", "SUPERSEDED"],
  APPLIED: ["SUPERSEDED"],
  SUPERSEDED: [],
  CANCELLED: [],
};

export const buildWatchReviewStateTransitionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    transitionType: z.literal("REVIEW_LIFECYCLE"),
    transitionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    targetType: buildWatchReviewTargetTypeSchema,
    targetId: contractIdentifierSchema,
    fromStatus: buildWatchReviewLifecycleStatusSchema,
    toStatus: buildWatchReviewLifecycleStatusSchema,
    actorId: contractIdentifierSchema,
    actorRole: buildWatchReviewerRoleSchema,
    reason: z.string().trim().min(1).max(2_000).nullable(),
    transitionedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((transition, context) => {
    if (!allowedReviewLifecycleTransitions[transition.fromStatus].includes(transition.toStatus)) {
      context.addIssue({
        code: "custom",
        message: "Review lifecycle transition is not allowed",
        path: ["toStatus"],
      });
    }

    if (
      ["REJECTED", "CANCELLED", "SUPERSEDED"].includes(transition.toStatus) &&
      transition.reason === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Rejection, cancellation, and supersession require a reason",
        path: ["reason"],
      });
    }

    if (transition.toStatus !== "APPROVED") {
      return;
    }

    const requiredRoleByTarget: Readonly<
      Record<
        z.infer<typeof buildWatchReviewTargetTypeSchema>,
        z.infer<typeof buildWatchReviewerRoleSchema>
      >
    > = {
      DESIGN_CANDIDATE: "ENGINEER",
      QUANTITY_TAKEOFF: "ESTIMATOR",
      ESTIMATE: "PROJECT_MANAGER",
      SCHEDULE: "PROJECT_MANAGER",
      BASELINE: "PROJECT_MANAGER",
      PROGRESS_VERIFICATION: "PROJECT_MANAGER",
    };

    if (transition.actorRole !== requiredRoleByTarget[transition.targetType]) {
      context.addIssue({
        code: "custom",
        message: "Review approval actor role does not match the target approval matrix",
        path: ["actorRole"],
      });
    }
  });

export const buildWatchDraftStatusSchema = z.enum(["DRAFT", "REVIEW_REQUIRED", "NEEDS_CORRECTION"]);

export const buildWatchImmutableVersionMetadataSchema = z
  .object({
    version: z.number().int().positive(),
    approvedBy: contractIdentifierSchema,
    approvedAt: contractIsoDateTimeSchema,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    supersedesVersionId: contractIdentifierSchema.nullable(),
  })
  .strict();

export const buildWatchPolicyVersionSchema = z
  .object({
    policyVersionId: contractIdentifierSchema,
    version: z.number().int().positive(),
    effectiveFrom: contractIsoDateSchema,
  })
  .strict();

export function hasUniqueContractIds(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function sourceReferenceMatchesScope(
  source: z.infer<typeof buildWatchSourceReferenceSchema>,
  tenantId: string,
  projectId: string,
): boolean {
  return source.tenantId === tenantId && source.projectId === projectId;
}

export function catalogReferenceMatchesScope(
  version: z.infer<typeof buildWatchCatalogVersionReferenceSchema>,
  tenantId: string,
  projectId: string,
): boolean {
  return (
    version.tenantId === tenantId &&
    version.projectId === projectId &&
    version.sourceRefs.every((source) => sourceReferenceMatchesScope(source, tenantId, projectId))
  );
}

export type BuildWatchCanonicalUnit = z.infer<typeof buildWatchCanonicalUnitSchema>;
export type BuildWatchSourceReference = z.infer<typeof buildWatchSourceReferenceSchema>;
export type BuildWatchCatalogVersionReference = z.infer<
  typeof buildWatchCatalogVersionReferenceSchema
>;
export type BuildWatchReviewDecision = z.infer<typeof buildWatchReviewDecisionSchema>;
export type BuildWatchReviewStateTransitionV1 = z.infer<
  typeof buildWatchReviewStateTransitionV1Schema
>;
