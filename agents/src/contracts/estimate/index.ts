import { z } from "zod";
import {
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
  contractMoneySchema,
  contractValidationIssueSchema,
} from "../common.js";
import {
  buildWatchCanonicalUnitSchema,
  buildWatchCatalogVersionReferenceSchema,
  buildWatchDraftStatusSchema,
  buildWatchImmutableVersionMetadataSchema,
  buildWatchReviewDecisionSchema,
  buildWatchSourceBackedQuantitySchema,
  buildWatchSourceReferenceSchema,
  catalogReferenceMatchesScope,
  hasUniqueContractIds,
  sourceReferenceMatchesScope,
} from "../buildwatch-v2-common.js";

const nonnegativeMoneySchema = contractMoneySchema.refine(
  (value) => !value.startsWith("-"),
  "Money must be nonnegative",
);

export const sourceBackedMoneyMntSchema = z
  .object({
    value: nonnegativeMoneySchema,
    currency: z.literal("MNT"),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const materialRequirementLineSchema = z
  .object({
    requirementId: contractIdentifierSchema,
    takeoffItemId: contractIdentifierSchema,
    materialCode: z.string().trim().min(1).max(200),
    requiredQuantity: buildWatchSourceBackedQuantitySchema,
    wasteFactor: z.string().regex(/^(?:0|0\.\d{1,6}|1(?:\.0{1,6})?)$/),
    normVersion: buildWatchCatalogVersionReferenceSchema,
  })
  .strict()
  .superRefine((line, context) => {
    if (line.normVersion.catalogType !== "MATERIAL_NORM") {
      context.addIssue({
        code: "custom",
        message: "Material requirement requires a material-norm version",
        path: ["normVersion", "catalogType"],
      });
    }
  });

export const estimateLineSchema = z
  .object({
    lineId: contractIdentifierSchema,
    takeoffItemId: contractIdentifierSchema,
    workCode: z.string().trim().min(1).max(200),
    pricedItemCode: z.string().trim().min(1).max(200).optional(),
    costType: z.enum(["MATERIAL", "LABOR", "EQUIPMENT"]).optional(),
    description: z.string().trim().min(1).max(1_000),
    quantity: buildWatchSourceBackedQuantitySchema,
    unit: buildWatchCanonicalUnitSchema,
    unitPriceMnt: sourceBackedMoneyMntSchema,
    lineCostMnt: sourceBackedMoneyMntSchema,
    priceVersion: buildWatchCatalogVersionReferenceSchema,
    normVersion: buildWatchCatalogVersionReferenceSchema.nullable(),
    productivityVersion: buildWatchCatalogVersionReferenceSchema.nullable(),
    supplierQuotationId: contractIdentifierSchema.nullable().optional(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict()
  .superRefine((line, context) => {
    if (line.unit !== line.quantity.unit) {
      context.addIssue({
        code: "custom",
        message: "Estimate line unit must match its quantity unit",
        path: ["unit"],
      });
    }

    if (line.priceVersion.catalogType !== "PRICE") {
      context.addIssue({
        code: "custom",
        message: "Estimate line requires a price catalog version",
        path: ["priceVersion", "catalogType"],
      });
    }

    if (line.normVersion !== null && line.normVersion.catalogType !== "MATERIAL_NORM") {
      context.addIssue({
        code: "custom",
        message: "Estimate norm reference has the wrong catalog type",
        path: ["normVersion", "catalogType"],
      });
    }

    if (
      line.productivityVersion !== null &&
      line.productivityVersion.catalogType !== "PRODUCTIVITY"
    ) {
      context.addIssue({
        code: "custom",
        message: "Estimate productivity reference has the wrong catalog type",
        path: ["productivityVersion", "catalogType"],
      });
    }

    if (
      line.costType === "MATERIAL" &&
      (line.normVersion === null || line.supplierQuotationId === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Material estimate lines require a norm and supplier quotation",
        path: ["costType"],
      });
    }

    if (
      line.costType !== undefined &&
      line.costType !== "MATERIAL" &&
      line.productivityVersion === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Labor and equipment lines require a productivity version",
        path: ["productivityVersion"],
      });
    }
  });

export const estimateAssumptionSchema = z
  .object({
    assumptionId: contractIdentifierSchema,
    code: z.string().trim().min(1).max(100),
    statement: z.string().trim().min(1).max(2_000),
    approved: z.boolean(),
    sourceRefs: z.array(buildWatchSourceReferenceSchema).min(1).max(100),
  })
  .strict();

export const estimateContentSchema = z
  .object({
    quantityTakeoffVersionId: contractIdentifierSchema,
    pricingDate: contractIsoDateSchema.optional(),
    policyVersion: buildWatchCatalogVersionReferenceSchema.optional(),
    materialRequirements: z.array(materialRequirementLineSchema).max(100_000),
    lines: z.array(estimateLineSchema).max(100_000),
    assumptions: z.array(estimateAssumptionSchema).max(10_000),
    subtotalMnt: sourceBackedMoneyMntSchema,
    taxMnt: sourceBackedMoneyMntSchema,
    contingencyMnt: sourceBackedMoneyMntSchema,
    totalMnt: sourceBackedMoneyMntSchema,
    costBreakdownMnt: z
      .object({
        material: sourceBackedMoneyMntSchema,
        labor: sourceBackedMoneyMntSchema,
        equipment: sourceBackedMoneyMntSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((content, context) => {
    if (!hasUniqueContractIds(content.materialRequirements.map((line) => line.requirementId))) {
      context.addIssue({
        code: "custom",
        message: "Material requirement identifiers must be unique",
        path: ["materialRequirements"],
      });
    }

    if (!hasUniqueContractIds(content.lines.map((line) => line.lineId))) {
      context.addIssue({
        code: "custom",
        message: "Estimate line identifiers must be unique",
        path: ["lines"],
      });
    }

    if (!hasUniqueContractIds(content.assumptions.map((assumption) => assumption.assumptionId))) {
      context.addIssue({
        code: "custom",
        message: "Estimate assumption identifiers must be unique",
        path: ["assumptions"],
      });
    }

    const toCents = (value: string) => {
      const [whole, fraction = "00"] = value.split(".");
      return BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
    };

    const lineTotal = content.lines.reduce(
      (sum, line) => sum + toCents(line.lineCostMnt.value),
      0n,
    );
    const subtotal = toCents(content.subtotalMnt.value);
    if (lineTotal !== subtotal) {
      context.addIssue({
        code: "custom",
        message: "Estimate subtotal must equal the sum of its lines",
        path: ["subtotalMnt", "value"],
      });
    }

    const expectedTotal =
      subtotal + toCents(content.taxMnt.value) + toCents(content.contingencyMnt.value);
    if (toCents(content.totalMnt.value) !== expectedTotal) {
      context.addIssue({
        code: "custom",
        message: "Estimate total must equal subtotal, tax, and contingency",
        path: ["totalMnt", "value"],
      });
    }

    if (content.policyVersion !== undefined && content.policyVersion.catalogType !== "POLICY") {
      context.addIssue({
        code: "custom",
        message: "Estimate requires an approved policy version",
        path: ["policyVersion", "catalogType"],
      });
    }

    const costByType = (costType: "MATERIAL" | "LABOR" | "EQUIPMENT") =>
      content.lines
        .filter((line) => line.costType === costType)
        .reduce((sum, line) => sum + toCents(line.lineCostMnt.value), 0n);
    const breakdown = content.costBreakdownMnt;
    if (breakdown !== undefined) {
      if (
        costByType("MATERIAL") !== toCents(breakdown.material.value) ||
        costByType("LABOR") !== toCents(breakdown.labor.value) ||
        costByType("EQUIPMENT") !== toCents(breakdown.equipment.value)
      ) {
        context.addIssue({
          code: "custom",
          message: "Estimate cost breakdown must equal categorized line totals",
          path: ["costBreakdownMnt"],
        });
      }
    }
  });

function estimateSources(content: z.infer<typeof estimateContentSchema>) {
  return [
    ...(content.policyVersion?.sourceRefs ?? []),
    ...content.materialRequirements.flatMap((line) => [
      ...line.requiredQuantity.sourceRefs,
      ...line.normVersion.sourceRefs,
    ]),
    ...content.lines.flatMap((line) => [
      ...line.quantity.sourceRefs,
      ...line.unitPriceMnt.sourceRefs,
      ...line.lineCostMnt.sourceRefs,
      ...line.priceVersion.sourceRefs,
      ...(line.normVersion?.sourceRefs ?? []),
      ...(line.productivityVersion?.sourceRefs ?? []),
      ...line.sourceRefs,
    ]),
    ...content.assumptions.flatMap((assumption) => assumption.sourceRefs),
    ...content.subtotalMnt.sourceRefs,
    ...content.taxMnt.sourceRefs,
    ...content.contingencyMnt.sourceRefs,
    ...content.totalMnt.sourceRefs,
    ...(content.costBreakdownMnt?.material.sourceRefs ?? []),
    ...(content.costBreakdownMnt?.labor.sourceRefs ?? []),
    ...(content.costBreakdownMnt?.equipment.sourceRefs ?? []),
  ];
}

function estimateCatalogVersions(content: z.infer<typeof estimateContentSchema>) {
  return [
    ...(content.policyVersion === undefined ? [] : [content.policyVersion]),
    ...content.materialRequirements.map((line) => line.normVersion),
    ...content.lines.flatMap((line) => [
      line.priceVersion,
      ...(line.normVersion === null ? [] : [line.normVersion]),
      ...(line.productivityVersion === null ? [] : [line.productivityVersion]),
    ]),
  ];
}

function addEstimateScopeIssues(
  content: z.infer<typeof estimateContentSchema>,
  tenantId: string,
  projectId: string,
  context: z.RefinementCtx,
) {
  estimateSources(content).forEach((source, index) => {
    if (!sourceReferenceMatchesScope(source, tenantId, projectId)) {
      context.addIssue({
        code: "custom",
        message: "Estimate source is outside the aggregate scope",
        path: ["content", "sources", index],
      });
    }
  });

  estimateCatalogVersions(content).forEach((version, index) => {
    if (!catalogReferenceMatchesScope(version, tenantId, projectId)) {
      context.addIssue({
        code: "custom",
        message: "Estimate catalog version is outside the aggregate scope",
        path: ["content", "catalogVersions", index],
      });
    }
  });
}

export const estimateDraftV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    draftType: z.literal("ESTIMATE"),
    draftId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: buildWatchDraftStatusSchema,
    content: estimateContentSchema,
    validationIssues: z.array(contractValidationIssueSchema).max(1_000),
    requiresHumanReview: z.literal(true),
    createdAt: contractIsoDateTimeSchema,
    createdBy: contractIdentifierSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    addEstimateScopeIssues(draft.content, draft.tenantId, draft.projectId, context);

    if (
      draft.validationIssues.some((issue) => issue.severity === "ERROR") &&
      draft.status !== "NEEDS_CORRECTION"
    ) {
      context.addIssue({
        code: "custom",
        message: "Estimate drafts with validation errors require correction",
        path: ["status"],
      });
    }
  });

export const approvedEstimateVersionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    versionType: z.literal("APPROVED_ESTIMATE"),
    estimateVersionId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    status: z.literal("APPROVED"),
    content: estimateContentSchema,
    metadata: buildWatchImmutableVersionMetadataSchema,
  })
  .strict()
  .superRefine((version, context) => {
    addEstimateScopeIssues(version.content, version.tenantId, version.projectId, context);
    if (version.content.lines.length === 0) {
      context.addIssue({
        code: "custom",
        message: "An approved estimate requires at least one priced line",
        path: ["content", "lines"],
      });
    }
  });

export const approvedEstimateCommandV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    commandType: z.literal("APPROVE_ESTIMATE"),
    commandId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    draftId: contractIdentifierSchema,
    approvedVersion: approvedEstimateVersionV1Schema,
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
        message: "Approved estimate scope must match command scope",
        path: ["approvedVersion"],
      });
    }

    if (
      command.decision.action !== "APPROVE" ||
      command.decision.reviewerRole !== "PROJECT_MANAGER"
    ) {
      context.addIssue({
        code: "custom",
        message: "Estimate approval requires a project-manager approval decision",
        path: ["decision"],
      });
    }
  });

export type EstimateDraftV1 = z.infer<typeof estimateDraftV1Schema>;
export type ApprovedEstimateVersionV1 = z.infer<typeof approvedEstimateVersionV1Schema>;
export type ApprovedEstimateCommandV1 = z.infer<typeof approvedEstimateCommandV1Schema>;
