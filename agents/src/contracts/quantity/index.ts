import { z } from "zod";
import {
  contractIdentifierSchema,
  contractIsoDateTimeSchema,
  contractValidationIssueSchema,
} from "../common.js";
import {
  buildWatchCanonicalUnitSchema,
  buildWatchDraftStatusSchema,
  buildWatchImmutableVersionMetadataSchema,
  buildWatchRatioDecimalSchema,
  buildWatchReviewDecisionSchema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  hasUniqueContractIds,
  sourceReferenceMatchesScope,
} from "../buildwatch-v2-common.js";
import { designDimensionKindSchema } from "../design/index.js";

export const quantityDimensionInputSchema = z
  .object({
    dimensionId: contractIdentifierSchema,
    kind: designDimensionKindSchema,
    quantity: buildWatchSourceBackedQuantitySchema,
  })
  .strict();

export const quantityFormulaSchema = z
  .object({
    formulaId: contractIdentifierSchema,
    expression: z.string().trim().min(1).max(2_000),
    resultUnit: buildWatchCanonicalUnitSchema,
    dimensionInputIds: z.array(contractIdentifierSchema).min(1).max(100),
    ruleVersion: z.string().trim().min(1).max(100),
    roundingMode: z.literal("ROUND_HALF_UP").optional(),
    decimalPlaces: z.number().int().min(0).max(6).optional(),
    unitConversionVersion: z.string().trim().min(1).max(100).optional(),
    reviewedBy: contractIdentifierSchema.optional(),
    reviewedAt: contractIsoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((formula, context) => {
    if (!hasUniqueContractIds(formula.dimensionInputIds)) {
      context.addIssue({
        code: "custom",
        message: "Quantity formula dimension references must be unique",
        path: ["dimensionInputIds"],
      });
    }
  });

export const takeoffAdjustmentKindSchema = z.enum(["ADD", "SUBTRACT", "OVERRIDE"]);

export const takeoffAdjustmentSchema = z
  .object({
    adjustmentId: contractIdentifierSchema,
    kind: takeoffAdjustmentKindSchema,
    quantity: buildWatchSourceBackedQuantitySchema,
    reason: z.string().trim().min(1).max(2_000),
    adjustedBy: contractIdentifierSchema,
    adjustedAt: contractIsoDateTimeSchema,
  })
  .strict();

export const quantityTakeoffItemSchema = z
  .object({
    itemId: contractIdentifierSchema,
    elementCandidateId: contractIdentifierSchema,
    workCode: z.string().trim().min(1).max(200),
    formula: quantityFormulaSchema,
    dimensions: z.array(quantityDimensionInputSchema).min(1).max(100),
    baseQuantity: buildWatchSourceBackedQuantitySchema,
    wasteFactor: buildWatchRatioDecimalSchema,
    adjustment: takeoffAdjustmentSchema.nullable(),
    finalQuantity: buildWatchSourceBackedQuantitySchema,
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((item, context) => {
    if (!hasUniqueContractIds(item.dimensions.map((dimension) => dimension.dimensionId))) {
      context.addIssue({
        code: "custom",
        message: "Quantity dimension identifiers must be unique",
        path: ["dimensions"],
      });
    }

    const dimensionIds = new Set(item.dimensions.map((dimension) => dimension.dimensionId));
    item.formula.dimensionInputIds.forEach((dimensionId, index) => {
      if (!dimensionIds.has(dimensionId)) {
        context.addIssue({
          code: "custom",
          message: "Quantity formula references an unknown dimension",
          path: ["formula", "dimensionInputIds", index],
        });
      }
    });

    if (
      item.formula.resultUnit !== item.baseQuantity.unit ||
      item.baseQuantity.unit !== item.finalQuantity.unit
    ) {
      context.addIssue({
        code: "custom",
        message: "Formula, base quantity, and final quantity units must match",
        path: ["finalQuantity", "unit"],
      });
    }

    if (item.adjustment !== null && item.adjustment.quantity.unit !== item.finalQuantity.unit) {
      context.addIssue({
        code: "custom",
        message: "Manual adjustment unit must match the takeoff unit",
        path: ["adjustment", "quantity", "unit"],
      });
    }
  });

export const quantityTakeoffContentSchema = z
  .object({
    drawingRevisionId: contractIdentifierSchema,
    verifiedScaleId: contractIdentifierSchema,
    scaleStatus: z.literal("VERIFIED"),
    items: z.array(quantityTakeoffItemSchema).min(1).max(100_000),
  })
  .strict()
  .superRefine((content, context) => {
    if (!hasUniqueContractIds(content.items.map((item) => item.itemId))) {
      context.addIssue({
        code: "custom",
        message: "Quantity takeoff item identifiers must be unique",
        path: ["items"],
      });
    }
  });

function quantityContentSources(content: z.infer<typeof quantityTakeoffContentSchema>) {
  return content.items.flatMap((item) => [
    ...item.sourceRefs,
    ...item.baseQuantity.sourceRefs,
    ...item.finalQuantity.sourceRefs,
    ...item.dimensions.flatMap((dimension) => dimension.quantity.sourceRefs),
    ...(item.adjustment?.quantity.sourceRefs ?? []),
  ]);
}

export const quantityTakeoffDraftV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    draftType: z.literal("QUANTITY_TAKEOFF"),
    draftId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: buildWatchDraftStatusSchema,
    content: quantityTakeoffContentSchema,
    validationIssues: z.array(contractValidationIssueSchema).max(1_000),
    requiresHumanReview: z.literal(true),
    createdAt: contractIsoDateTimeSchema,
    createdBy: contractIdentifierSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    quantityContentSources(draft.content).forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, draft.tenantId, draft.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Quantity source is outside the draft scope",
          path: ["content", "items", index],
        });
      }
    });

    const hasErrors = draft.validationIssues.some((issue) => issue.severity === "ERROR");
    if (hasErrors && draft.status !== "NEEDS_CORRECTION") {
      context.addIssue({
        code: "custom",
        message: "Quantity drafts with validation errors require correction",
        path: ["status"],
      });
    }
  });

export const approvedQuantityTakeoffVersionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    versionType: z.literal("APPROVED_QUANTITY_TAKEOFF"),
    quantityTakeoffVersionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: z.literal("APPROVED"),
    content: quantityTakeoffContentSchema,
    metadata: buildWatchImmutableVersionMetadataSchema,
  })
  .strict()
  .superRefine((version, context) => {
    quantityContentSources(version.content).forEach((source, index) => {
      if (!sourceReferenceMatchesScope(source, version.tenantId, version.projectId)) {
        context.addIssue({
          code: "custom",
          message: "Approved quantity source is outside the version scope",
          path: ["content", "items", index],
        });
      }
    });
  });

export const approvedQuantityTakeoffCommandV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    commandType: z.literal("APPROVE_QUANTITY_TAKEOFF"),
    commandId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    draftId: contractIdentifierSchema,
    approvedVersion: approvedQuantityTakeoffVersionV1Schema,
    decision: buildWatchReviewDecisionSchema,
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.approvedVersion.tenantId !== command.tenantId ||
      command.approvedVersion.projectId !== command.projectId
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved quantity version scope must match command scope",
        path: ["approvedVersion"],
      });
    }

    if (command.decision.action !== "APPROVE" || command.decision.reviewerRole !== "ESTIMATOR") {
      context.addIssue({
        code: "custom",
        message: "Quantity takeoff approval requires an estimator approval decision",
        path: ["decision"],
      });
    }
  });

export type QuantityTakeoffDraftV1 = z.infer<typeof quantityTakeoffDraftV1Schema>;
export type ApprovedQuantityTakeoffVersionV1 = z.infer<
  typeof approvedQuantityTakeoffVersionV1Schema
>;
export type ApprovedQuantityTakeoffCommandV1 = z.infer<
  typeof approvedQuantityTakeoffCommandV1Schema
>;
export type QuantityTakeoffItem = z.infer<typeof quantityTakeoffItemSchema>;
