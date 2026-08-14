import { z } from "zod";
import {
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  contractValidationIssueSchema,
} from "../contracts/common.js";
import {
  buildWatchCanonicalUnitSchema,
  buildWatchCatalogVersionReferenceSchema,
  buildWatchImmutableVersionMetadataSchema,
  buildWatchPositiveDecimalSchema,
  buildWatchRatioDecimalSchema,
  buildWatchReviewDecisionSchema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  hasUniqueContractIds,
} from "../contracts/buildwatch-v2-common.js";
import {
  designElementCandidateV1Schema,
  verifiedDrawingScaleV1Schema,
} from "../contracts/design/index.js";
import {
  baselineContentSchema,
  operationalCalendarVersionSchema,
} from "../contracts/schedule/index.js";
import { sourceBackedMoneyMntSchema } from "../contracts/estimate/index.js";
import { snapshotDependencyTypeSchema } from "../contracts/project-analysis-snapshot.js";

export const phase7RoundingModeSchema = z.literal("ROUND_HALF_UP");

export const phase7MeasurementUnitSchema = z.enum([
  "mm",
  "cm",
  "m",
  "mm2",
  "cm2",
  "m2",
  "mm3",
  "cm3",
  "m3",
  "pcs",
]);

export const quantityFormulaKindSchema = z.enum([
  "LENGTH",
  "AREA_RECTANGLE",
  "AREA_NET_OPENINGS",
  "VOLUME_RECTANGULAR",
  "COUNT",
]);

export const quantityFormulaDefinitionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    definitionType: z.literal("QUANTITY_FORMULA"),
    formulaId: contractIdentifierSchema,
    formulaKind: quantityFormulaKindSchema,
    expression: z.string().trim().min(1).max(2_000),
    ruleVersion: z.string().trim().min(1).max(100),
    resultUnit: buildWatchCanonicalUnitSchema,
    minimumInputCount: z.number().int().positive().max(100),
    maximumInputCount: z.number().int().positive().max(100),
    decimalPlaces: z.number().int().min(0).max(6),
    roundingMode: phase7RoundingModeSchema,
    unitConversionVersion: z.string().trim().min(1).max(100),
  })
  .strict()
  .superRefine((formula, context) => {
    if (formula.maximumInputCount < formula.minimumInputCount) {
      context.addIssue({
        code: "custom",
        message: "Formula maximum input count cannot be below its minimum",
        path: ["maximumInputCount"],
      });
    }
  });

export const approvedQuantityAdjustmentV1Schema = z
  .object({
    adjustmentId: contractIdentifierSchema,
    kind: z.enum(["ADD", "SUBTRACT", "OVERRIDE"]),
    quantity: buildWatchSourceBackedQuantitySchema,
    reason: z.string().trim().min(1).max(2_000),
    decision: buildWatchReviewDecisionSchema,
  })
  .strict()
  .superRefine((adjustment, context) => {
    if (
      adjustment.decision.action !== "APPROVE" ||
      adjustment.decision.reviewerRole !== "ENGINEER"
    ) {
      context.addIssue({
        code: "custom",
        message: "A quantity adjustment requires engineer approval",
        path: ["decision"],
      });
    }
  });

export const quantityGenerationItemRequestV1Schema = z
  .object({
    itemId: contractIdentifierSchema,
    elementCandidateId: contractIdentifierSchema,
    workCode: z.string().trim().min(1).max(200),
    formulaId: contractIdentifierSchema,
    dimensionInputIds: z.array(contractIdentifierSchema).min(1).max(100),
    adjustment: approvedQuantityAdjustmentV1Schema.nullable(),
  })
  .strict();

export const quantityGenerationRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestType: z.literal("GENERATE_QUANTITY_TAKEOFF"),
    requestId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    draftId: contractIdentifierSchema,
    verifiedScale: verifiedDrawingScaleV1Schema,
    candidates: z.array(designElementCandidateV1Schema).min(1).max(100_000),
    items: z.array(quantityGenerationItemRequestV1Schema).min(1).max(100_000),
    createdAt: contractIsoDateTimeSchema,
    createdBy: contractIdentifierSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (!hasUniqueContractIds(request.candidates.map((item) => item.candidateId))) {
      context.addIssue({
        code: "custom",
        message: "Quantity candidate identifiers must be unique",
        path: ["candidates"],
      });
    }
    if (!hasUniqueContractIds(request.items.map((item) => item.itemId))) {
      context.addIssue({
        code: "custom",
        message: "Quantity item identifiers must be unique",
        path: ["items"],
      });
    }
    request.items.forEach((item, index) => {
      if (!hasUniqueContractIds(item.dimensionInputIds)) {
        context.addIssue({
          code: "custom",
          message: "Quantity formula input identifiers must be unique",
          path: ["items", index, "dimensionInputIds"],
        });
      }
    });
  });

export const quantityCalculationTraceV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    traceType: z.literal("QUANTITY_CALCULATION"),
    traceId: contractIdentifierSchema,
    itemId: contractIdentifierSchema,
    formulaId: contractIdentifierSchema,
    ruleVersion: z.string().trim().min(1).max(100),
    expression: z.string().trim().min(1).max(2_000),
    orderedDimensionInputIds: z.array(contractIdentifierSchema).min(1).max(100),
    unroundedValue: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,24})?$/),
    roundedValue: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/),
    resultUnit: buildWatchCanonicalUnitSchema,
    decimalPlaces: z.number().int().min(0).max(6),
    roundingMode: phase7RoundingModeSchema,
    unitConversionVersion: z.string().trim().min(1).max(100),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(500),
    reviewedBy: contractIdentifierSchema,
    reviewedAt: contractIsoDateTimeSchema,
  })
  .strict();

export const quantityEngineerReviewV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    reviewType: z.literal("QUANTITY_ENGINEER_REVIEW"),
    reviewId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    draftId: contractIdentifierSchema,
    reviewedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    decision: buildWatchReviewDecisionSchema,
    adjustmentIds: z.array(contractIdentifierSchema).max(100_000),
    reviewedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((review, context) => {
    if (review.decision.reviewerRole !== "ENGINEER") {
      context.addIssue({
        code: "custom",
        message: "Quantity engineering review requires the engineer role",
        path: ["decision", "reviewerRole"],
      });
    }
  });

export const quantityVersionItemChangeV1Schema = z
  .object({
    itemId: contractIdentifierSchema,
    changeType: z.enum(["ADDED", "REMOVED", "CHANGED", "UNCHANGED"]),
    previousValue: z.string().nullable(),
    currentValue: z.string().nullable(),
    unit: buildWatchCanonicalUnitSchema,
    reason: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

export const quantityVersionComparisonV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    comparisonType: z.literal("QUANTITY_VERSION_COMPARISON"),
    previousVersionId: contractIdentifierSchema,
    currentVersionId: contractIdentifierSchema,
    changes: z.array(quantityVersionItemChangeV1Schema).max(100_000),
  })
  .strict();

export const approvedMaterialNormV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("APPROVED_MATERIAL_NORM"),
    normId: contractIdentifierSchema,
    workCode: z.string().trim().min(1).max(200),
    workUnit: buildWatchCanonicalUnitSchema,
    materialCode: z.string().trim().min(1).max(200),
    materialUnit: buildWatchCanonicalUnitSchema,
    quantityPerWorkUnit: buildWatchPositiveDecimalSchema,
    wasteFactor: buildWatchRatioDecimalSchema,
    version: buildWatchCatalogVersionReferenceSchema,
  })
  .strict()
  .superRefine((norm, context) => {
    if (norm.version.catalogType !== "MATERIAL_NORM") {
      context.addIssue({
        code: "custom",
        message: "Material norm requires a MATERIAL_NORM catalog version",
        path: ["version", "catalogType"],
      });
    }
  });

export const approvedPriceV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("APPROVED_PRICE"),
    priceId: contractIdentifierSchema,
    itemCode: z.string().trim().min(1).max(200),
    costType: z.enum(["MATERIAL", "LABOR", "EQUIPMENT"]),
    unit: buildWatchCanonicalUnitSchema,
    unitPriceMnt: sourceBackedMoneyMntSchema,
    supplierQuotationId: contractIdentifierSchema.nullable(),
    version: buildWatchCatalogVersionReferenceSchema,
  })
  .strict()
  .superRefine((price, context) => {
    if (price.version.catalogType !== "PRICE") {
      context.addIssue({
        code: "custom",
        message: "Approved price requires a PRICE catalog version",
        path: ["version", "catalogType"],
      });
    }
    if (price.unitPriceMnt.value === "0.00") {
      context.addIssue({
        code: "custom",
        message: "An approved effective price must be greater than zero",
        path: ["unitPriceMnt", "value"],
      });
    }
    if (price.costType === "MATERIAL" && price.supplierQuotationId === null) {
      context.addIssue({
        code: "custom",
        message: "Material prices require a supplier quotation",
        path: ["supplierQuotationId"],
      });
    }
  });

export const productivityEquipmentRequirementV1Schema = z
  .object({
    equipmentClassCode: z.string().trim().min(1).max(200),
    count: z.number().int().positive().max(100_000),
    hoursPerWorkUnit: buildWatchPositiveDecimalSchema,
  })
  .strict();

export const approvedProductivityRateV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("APPROVED_PRODUCTIVITY"),
    productivityId: contractIdentifierSchema,
    workCode: z.string().trim().min(1).max(200),
    workUnit: buildWatchCanonicalUnitSchema,
    quantityPerWorkingDay: buildWatchPositiveDecimalSchema,
    laborClassCode: z.string().trim().min(1).max(200),
    crewCount: z.number().int().positive().max(100_000),
    laborHoursPerWorkUnit: buildWatchPositiveDecimalSchema,
    equipment: z.array(productivityEquipmentRequirementV1Schema).max(1_000),
    version: buildWatchCatalogVersionReferenceSchema,
  })
  .strict()
  .superRefine((productivity, context) => {
    if (productivity.version.catalogType !== "PRODUCTIVITY") {
      context.addIssue({
        code: "custom",
        message: "Productivity requires a PRODUCTIVITY catalog version",
        path: ["version", "catalogType"],
      });
    }
  });

export const workTemplateDependencyV1Schema = z
  .object({
    predecessorWorkCode: z.string().trim().min(1).max(200),
    type: snapshotDependencyTypeSchema,
    lagWorkingDays: z.number().int().min(-10_000).max(10_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const approvedWorkTemplateV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("APPROVED_WORK_TEMPLATE"),
    templateId: contractIdentifierSchema,
    workCode: z.string().trim().min(1).max(200),
    wbsCode: z.string().trim().min(1).max(200),
    parentWbsCode: z.string().trim().min(1).max(200).nullable(),
    name: z.string().trim().min(1).max(500),
    zoneCode: z.string().trim().min(1).max(200).nullable(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    contractMilestone: z.boolean(),
    predecessors: z.array(workTemplateDependencyV1Schema).max(10_000),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
    version: buildWatchCatalogVersionReferenceSchema,
  })
  .strict()
  .superRefine((template, context) => {
    if (template.version.catalogType !== "WORK_TEMPLATE") {
      context.addIssue({
        code: "custom",
        message: "Work template requires a WORK_TEMPLATE catalog version",
        path: ["version", "catalogType"],
      });
    }
  });

export const estimateCalculationPolicyV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    policyType: z.literal("ESTIMATE_CALCULATION"),
    pricingDate: contractIsoDateSchema,
    taxRate: buildWatchRatioDecimalSchema,
    contingencyRate: buildWatchRatioDecimalSchema,
    roundingMode: phase7RoundingModeSchema,
    moneyDecimalPlaces: z.literal(2),
    version: buildWatchCatalogVersionReferenceSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.version.catalogType !== "POLICY") {
      context.addIssue({
        code: "custom",
        message: "Estimate policy requires a POLICY catalog version",
        path: ["version", "catalogType"],
      });
    }
  });

export const commercialGenerationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    resultType: z.enum(["MATERIAL_REQUIREMENTS", "ESTIMATE_GENERATION", "SCHEDULE_GENERATION"]),
    deterministic: z.literal(true),
    issues: z.array(contractValidationIssueSchema).max(100_000),
  })
  .strict();

export const scheduleDraftV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    draftType: z.literal("SCHEDULE"),
    draftId: contractIdentifierSchema,
    scheduleVersionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: z.enum(["DRAFT", "REVIEW_REQUIRED", "NEEDS_CORRECTION"]),
    content: baselineContentSchema,
    validationIssues: z.array(contractValidationIssueSchema).max(1_000),
    requiresHumanReview: z.literal(true),
    createdAt: contractIsoDateTimeSchema,
    createdBy: contractIdentifierSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    draft.content.activities.forEach((activity, index) => {
      if (
        activity.wbsCode === undefined ||
        activity.parentWbsCode === undefined ||
        activity.productivityVersion === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "Phase 7 schedule activities require WBS and productivity metadata",
          path: ["content", "activities", index],
        });
      }
    });
  });

export const approvedScheduleVersionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    versionType: z.literal("APPROVED_SCHEDULE"),
    scheduleVersionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: z.literal("APPROVED"),
    content: baselineContentSchema,
    metadata: buildWatchImmutableVersionMetadataSchema,
  })
  .strict()
  .superRefine((version, context) => {
    version.content.activities.forEach((activity, index) => {
      if (
        activity.wbsCode === undefined ||
        activity.parentWbsCode === undefined ||
        activity.productivityVersion === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "Approved Phase 7 schedule requires WBS and productivity metadata",
          path: ["content", "activities", index],
        });
      }
    });
  });

export const scheduleGenerationRequestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestType: z.literal("GENERATE_BASELINE_SCHEDULE"),
    requestId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    draftId: contractIdentifierSchema,
    scheduleVersionId: contractIdentifierSchema,
    approvedQuantityVersionId: contractIdentifierSchema,
    approvedEstimateVersionId: contractIdentifierSchema,
    plannedStart: contractIsoDateSchema,
    calendar: operationalCalendarVersionSchema,
    productivityRates: z.array(approvedProductivityRateV1Schema).max(100_000),
    workTemplates: z.array(approvedWorkTemplateV1Schema).max(100_000),
    createdAt: contractIsoDateTimeSchema,
    createdBy: contractIdentifierSchema,
  })
  .strict();

export type QuantityFormulaDefinitionV1 = z.infer<typeof quantityFormulaDefinitionV1Schema>;
export type QuantityGenerationRequestV1 = z.infer<typeof quantityGenerationRequestV1Schema>;
export type QuantityCalculationTraceV1 = z.infer<typeof quantityCalculationTraceV1Schema>;
export type QuantityEngineerReviewV1 = z.infer<typeof quantityEngineerReviewV1Schema>;
export type QuantityVersionComparisonV1 = z.infer<typeof quantityVersionComparisonV1Schema>;
export type ApprovedMaterialNormV1 = z.infer<typeof approvedMaterialNormV1Schema>;
export type ApprovedPriceV1 = z.infer<typeof approvedPriceV1Schema>;
export type ApprovedProductivityRateV1 = z.infer<typeof approvedProductivityRateV1Schema>;
export type ApprovedWorkTemplateV1 = z.infer<typeof approvedWorkTemplateV1Schema>;
export type EstimateCalculationPolicyV1 = z.infer<typeof estimateCalculationPolicyV1Schema>;
export type ScheduleDraftV1 = z.infer<typeof scheduleDraftV1Schema>;
export type ApprovedScheduleVersionV1 = z.infer<typeof approvedScheduleVersionV1Schema>;
export type ScheduleGenerationRequestV1 = z.infer<typeof scheduleGenerationRequestV1Schema>;
