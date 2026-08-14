import { z } from "zod";
import {
  contractArtifactReferenceSchema,
  contractConfidenceLevelSchema,
  contractIdentifierSchema,
  contractIsoDateTimeSchema,
  contractMoneySchema,
  contractValidationIssueSchema,
} from "./common.js";
import {
  agentSourceRefV1Schema,
  deterministicSeveritySchema,
  recoveryScenarioTypeSchema,
} from "./deterministic-analysis.js";

export const recommendationActionV1Schema = z
  .object({
    actionId: contractIdentifierSchema,
    actionType: z.enum([
      "PARALLELIZE",
      "ADD_RESOURCE",
      "RESEQUENCE",
      "SUBCONTRACT",
      "INVESTIGATE",
      "MONITOR",
    ]),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(2_000),
    scenarioType: recoveryScenarioTypeSchema.nullable(),
    scenarioId: contractIdentifierSchema.nullable(),
    estimatedImpactWorkingDays: z.number().int().min(-10_000).max(10_000).nullable(),
    estimatedCostMnt: contractMoneySchema.nullable(),
    ownerRef: contractIdentifierSchema.nullable(),
    requiredResources: z
      .array(
        z
          .object({
            resourceType: z.enum([
              "LABOR",
              "MATERIAL",
              "EQUIPMENT",
              "SUBCONTRACTOR",
              "APPROVAL",
              "OTHER",
            ]),
            description: z.string().trim().min(1).max(500),
            quantity: z.string().trim().min(1).max(100).nullable(),
          })
          .strict(),
      )
      .max(20),
    optionRisks: z.array(z.string().trim().min(1).max(500)).max(20),
    dependencyConflicts: z.array(contractIdentifierSchema).max(100),
    feasibilityStatus: z.enum(["FEASIBLE", "CONDITIONAL", "NOT_FEASIBLE", "INSUFFICIENT_DATA"]),
    dataSufficient: z.boolean(),
  })
  .strict()
  .superRefine((action, context) => {
    const hasScenario = action.scenarioType !== null || action.scenarioId !== null;

    if (hasScenario && (action.scenarioType === null || action.scenarioId === null)) {
      context.addIssue({
        code: "custom",
        message: "Scenario type and scenario ID must be supplied together",
        path: ["scenarioId"],
      });
    }

    if (action.estimatedImpactWorkingDays !== null && action.scenarioId === null) {
      context.addIssue({
        code: "custom",
        message: "Estimated schedule impact requires a deterministic scenario reference",
        path: ["estimatedImpactWorkingDays"],
      });
    }

    if (action.estimatedImpactWorkingDays !== null && !action.dataSufficient) {
      context.addIssue({
        code: "custom",
        message: "Estimated schedule impact requires sufficient deterministic data",
        path: ["dataSufficient"],
      });
    }

    if (action.feasibilityStatus === "FEASIBLE" && !action.dataSufficient) {
      context.addIssue({
        code: "custom",
        message: "A feasible action requires sufficient data",
        path: ["feasibilityStatus"],
      });
    }
  });

export const recommendationDraftV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    artifactType: z.literal("RECOMMENDATION_DRAFT"),
    recommendationId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    snapshotId: contractIdentifierSchema,
    analysisId: contractIdentifierSchema,
    generatedAt: contractIsoDateTimeSchema,
    observationKind: z.enum(["DEVIATION", "PATTERN", "ROOT_CAUSE", "TREND"]),
    priority: deterministicSeveritySchema,
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(3_000),
    rootCause: z.string().trim().min(1).max(2_000).nullable(),
    rootCauseGroupId: contractIdentifierSchema.nullable(),
    workItemIds: z.array(contractIdentifierSchema).max(100),
    actions: z.array(recommendationActionV1Schema).min(1).max(20),
    sourceRefs: z.array(agentSourceRefV1Schema).min(1).max(100),
    contextMemoryRefs: z.array(contractIdentifierSchema).max(100),
    dataFreshnessAt: contractIsoDateTimeSchema,
    confidenceScore: z.number().finite().min(0).max(1),
    confidenceLevel: contractConfidenceLevelSchema,
    validationIssues: z.array(contractValidationIssueSchema).max(100),
    status: z.enum(["PENDING_REVIEW", "NEEDS_CORRECTION"]),
    requiresHumanReview: z.literal(true),
  })
  .strict()
  .superRefine((draft, context) => {
    const sourceIds = new Set(draft.sourceRefs.map((source) => source.sourceId));

    if (sourceIds.size !== draft.sourceRefs.length) {
      context.addIssue({
        code: "custom",
        message: "Recommendation source references must be unique",
        path: ["sourceRefs"],
      });
    }

    const hasErrors = draft.validationIssues.some((issue) => issue.severity === "ERROR");
    const expectedStatus = hasErrors ? "NEEDS_CORRECTION" : "PENDING_REVIEW";

    if (draft.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        message: `Recommendation status must be ${expectedStatus}`,
        path: ["status"],
      });
    }
  });

export const documentDraftV1Schema = z
  .object({
    documentId: contractIdentifierSchema,
    documentType: z.enum([
      "WEEKLY_REPORT",
      "MONTHLY_REPORT",
      "DEVIATION_CONCLUSION",
      "SUBCONTRACTOR_REMINDER",
      "SUPPLIER_DEMAND",
      "CLIENT_NOTICE",
    ]),
    title: z.string().trim().min(1).max(500),
    language: z.enum(["mn", "en", "mixed"]),
    periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    markdown: z.string().trim().min(1).max(200_000),
    sourceRefs: z.array(agentSourceRefV1Schema).max(500),
    deterministicFactCount: z.number().int().nonnegative(),
    styleProfileRef: contractIdentifierSchema.nullable(),
    unsupportedClaimCount: z.number().int().nonnegative(),
    outputArtifact: contractArtifactReferenceSchema.nullable(),
    status: z.literal("PENDING_REVIEW"),
  })
  .strict()
  .superRefine((document, context) => {
    if (document.unsupportedClaimCount === 0 && document.sourceRefs.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A grounded document requires at least one source",
        path: ["sourceRefs"],
      });
    }

    if (document.periodFrom > document.periodTo) {
      context.addIssue({
        code: "custom",
        message: "Document period start must not be after period end",
        path: ["periodFrom"],
      });
    }

    if (document.deterministicFactCount > 0 && document.sourceRefs.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Deterministic document facts require sources",
        path: ["sourceRefs"],
      });
    }
  });

export const documentBundleV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    artifactType: z.literal("DOCUMENT_BUNDLE"),
    bundleId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    snapshotId: contractIdentifierSchema,
    analysisId: contractIdentifierSchema.nullable(),
    generatedAt: contractIsoDateTimeSchema,
    documents: z.array(documentDraftV1Schema).min(1).max(20),
    totalUnsupportedClaimCount: z.number().int().nonnegative(),
    status: z.enum(["PENDING_REVIEW", "NEEDS_CORRECTION"]),
    requiresHumanReview: z.literal(true),
  })
  .strict()
  .superRefine((bundle, context) => {
    const total = bundle.documents.reduce(
      (sum, document) => sum + document.unsupportedClaimCount,
      0,
    );

    if (total !== bundle.totalUnsupportedClaimCount) {
      context.addIssue({
        code: "custom",
        message: "Bundle unsupported-claim total does not match documents",
        path: ["totalUnsupportedClaimCount"],
      });
    }

    const expectedStatus = total > 0 ? "NEEDS_CORRECTION" : "PENDING_REVIEW";

    if (bundle.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        message: `Document bundle status must be ${expectedStatus}`,
        path: ["status"],
      });
    }
  });

export const referenceClaimV1Schema = z
  .object({
    claimId: contractIdentifierSchema,
    text: z.string().trim().min(1).max(3_000),
    status: z.literal("SUPPORTED"),
    sourceValue: z
      .union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()])
      .nullable(),
    asOf: contractIsoDateTimeSchema,
    sourceRefs: z.array(agentSourceRefV1Schema).min(1).max(30),
  })
  .strict();

export const referenceAnswerV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    artifactType: z.literal("REFERENCE_ANSWER"),
    answerId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    snapshotId: contractIdentifierSchema,
    generatedAt: contractIsoDateTimeSchema,
    question: z.string().trim().min(1).max(5_000),
    answer: z.string().trim().min(1).max(20_000),
    status: z.enum([
      "ANSWERED",
      "INSUFFICIENT_EVIDENCE",
      "REFUSED_WRITE_ACTION",
      "REDIRECT_REPORT_WORKFLOW",
    ]),
    suggestedRouteCode: z.string().trim().min(1).max(200).nullable(),
    claims: z.array(referenceClaimV1Schema).max(50),
    inspectedTools: z
      .array(
        z.enum([
          "getProjectSummary",
          "getWorkItems",
          "getProgressHistory",
          "getStockStatus",
          "getConsumptionVsNorm",
          "getAttendanceStats",
          "getBlockerHistory",
          "getAlerts",
          "getScheduleForecast",
          "getSubcontractorPerformance",
          "searchDailyReports",
        ]),
      )
      .min(0)
      .max(30),
    insufficientData: z.boolean(),
    readOnly: z.literal(true),
  })
  .strict()
  .superRefine((answer, context) => {
    if (answer.status === "ANSWERED" && !answer.insufficientData && answer.claims.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A factual answer requires at least one grounded claim",
        path: ["claims"],
      });
    }

    if (answer.status !== "ANSWERED" && answer.claims.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Policy/refusal answers cannot contain factual claims",
        path: ["claims"],
      });
    }

    if (answer.status === "ANSWERED" && answer.suggestedRouteCode !== null) {
      context.addIssue({
        code: "custom",
        message: "Answered questions do not require a workflow route",
        path: ["suggestedRouteCode"],
      });
    }
  });

export type RecommendationActionV1 = z.infer<typeof recommendationActionV1Schema>;
export type RecommendationDraftV1 = z.infer<typeof recommendationDraftV1Schema>;
export type DocumentDraftV1 = z.infer<typeof documentDraftV1Schema>;
export type DocumentBundleV1 = z.infer<typeof documentBundleV1Schema>;
export type ReferenceClaimV1 = z.infer<typeof referenceClaimV1Schema>;
export type ReferenceAnswerV1 = z.infer<typeof referenceAnswerV1Schema>;
