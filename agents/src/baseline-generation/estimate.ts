import type { ContractValidationIssue } from "../contracts/common.js";
import type { BuildWatchReviewDecision } from "../contracts/buildwatch-v2-common.js";
import {
  approvedEstimateCommandV1Schema,
  approvedEstimateVersionV1Schema,
  estimateDraftV1Schema,
  materialRequirementLineSchema,
  type ApprovedEstimateCommandV1,
  type ApprovedEstimateVersionV1,
  type EstimateDraftV1,
} from "../contracts/estimate/index.js";
import {
  approvedQuantityTakeoffVersionV1Schema,
  type ApprovedQuantityTakeoffVersionV1,
} from "../contracts/quantity/index.js";
import {
  approvedMaterialNormV1Schema,
  approvedPriceV1Schema,
  approvedProductivityRateV1Schema,
  estimateCalculationPolicyV1Schema,
  type ApprovedMaterialNormV1,
  type ApprovedPriceV1,
  type ApprovedProductivityRateV1,
  type EstimateCalculationPolicyV1,
} from "./contracts.js";
import {
  applyRatio,
  calculateMoney,
  calculateRateAmount,
  formatExactDecimal,
  multiplyExactDecimals,
  parseExactDecimal,
  roundExactDecimal,
  sumMoney,
} from "./decimal.js";
import {
  catalogIsEffective,
  catalogMatchesScope,
  cloneJson,
  createApprovedQuantitySource,
  createCalculationSource,
  deepFreeze,
  phase7Hash,
  phase7Id,
  uniqueSources,
  validationIssue,
} from "./deterministic.js";

type MaterialRequirementLine = EstimateDraftV1["content"]["materialRequirements"][number];
type EstimateLine = EstimateDraftV1["content"]["lines"][number];
type Phase7CostType = NonNullable<EstimateLine["costType"]>;

const canonicalQuantityDecimalPlaces = {
  m: 3,
  m2: 2,
  m3: 3,
  kg: 2,
  pcs: 0,
  h: 2,
  working_day: 2,
  percent: 2,
} as const;

function schemaIssues(code: string, prefix: string, error: unknown): ContractValidationIssue[] {
  if (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues.map((issue, index) => {
      const record = issue as { path?: PropertyKey[]; message?: string };
      return validationIssue(
        code,
        [`${prefix}.${record.path?.map(String).join(".") || index}`],
        record.message ?? "Commercial catalog validation failed",
      );
    });
  }
  return [validationIssue(code, [prefix], error instanceof Error ? error.message : String(error))];
}

function selectLatest<
  T extends Readonly<{
    version: ApprovedMaterialNormV1["version"];
  }>,
>(
  records: readonly T[],
  identity: (record: T) => string,
): Readonly<{ record: T | null; ambiguous: boolean }> {
  const sorted = [...records].sort((left, right) => {
    const effective = right.version.effectiveFrom.localeCompare(left.version.effectiveFrom);
    if (effective !== 0) return effective;
    const version = right.version.version - left.version.version;
    if (version !== 0) return version;
    return identity(left).localeCompare(identity(right));
  });
  const first = sorted[0];
  const second = sorted[1];
  if (first === undefined) {
    return { record: null, ambiguous: false };
  }
  const ambiguous =
    second !== undefined &&
    first.version.effectiveFrom === second.version.effectiveFrom &&
    first.version.version === second.version.version &&
    first.version.versionId !== second.version.versionId;
  return { record: ambiguous ? null : first, ambiguous };
}

function validNorms(
  input: Readonly<{
    norms: readonly ApprovedMaterialNormV1[];
    tenantId: string;
    projectId: string;
    asOf: string;
    issues: ContractValidationIssue[];
  }>,
): ApprovedMaterialNormV1[] {
  const valid: ApprovedMaterialNormV1[] = [];
  input.norms.forEach((candidate, index) => {
    const parsed = approvedMaterialNormV1Schema.safeParse(candidate);
    if (!parsed.success) {
      input.issues.push(...schemaIssues("INVALID_MATERIAL_NORM", `norms.${index}`, parsed.error));
      return;
    }
    if (!catalogMatchesScope(parsed.data.version, input.tenantId, input.projectId)) {
      input.issues.push(
        validationIssue(
          "MATERIAL_NORM_SCOPE_MISMATCH",
          [`norms.${index}.version`],
          "Material norm is outside the approved quantity scope",
        ),
      );
      return;
    }
    if (catalogIsEffective(parsed.data.version, input.asOf)) {
      valid.push(parsed.data);
    }
  });
  return valid;
}

export type MaterialRequirementResult = Readonly<{
  schemaVersion: 1;
  resultType: "MATERIAL_REQUIREMENTS";
  deterministic: true;
  complete: boolean;
  lines: readonly MaterialRequirementLine[];
  issues: readonly ContractValidationIssue[];
}>;

export function calculateMaterialRequirements(
  input: Readonly<{
    approvedQuantity: ApprovedQuantityTakeoffVersionV1;
    norms: readonly ApprovedMaterialNormV1[];
    asOf: string;
    calculatedAt: string;
  }>,
): MaterialRequirementResult {
  const quantity = approvedQuantityTakeoffVersionV1Schema.parse(input.approvedQuantity);
  if (quantity.metadata.sourceHash !== phase7Hash(quantity.content)) {
    throw new Error("Approved quantity source hash does not match its content");
  }
  const issues: ContractValidationIssue[] = [];
  const norms = validNorms({
    norms: input.norms,
    tenantId: quantity.tenantId,
    projectId: quantity.projectId,
    asOf: input.asOf,
    issues,
  });
  const lines: MaterialRequirementLine[] = [];

  for (const item of [...quantity.content.items].sort((left, right) =>
    left.itemId.localeCompare(right.itemId),
  )) {
    const matching = norms.filter(
      (norm) => norm.workCode === item.workCode && norm.workUnit === item.finalQuantity.unit,
    );
    const materialCodes = [...new Set(matching.map((norm) => norm.materialCode))].sort();
    if (materialCodes.length === 0) {
      issues.push(
        validationIssue(
          "MATERIAL_NORM_MISSING",
          [`quantity.items.${item.itemId}`],
          `No effective approved material norm exists for ${item.workCode}`,
        ),
      );
      continue;
    }
    for (const materialCode of materialCodes) {
      const selected = selectLatest(
        matching.filter((norm) => norm.materialCode === materialCode),
        (norm) => norm.normId,
      );
      if (selected.ambiguous || selected.record === null) {
        issues.push(
          validationIssue(
            "MATERIAL_NORM_AMBIGUOUS",
            [`quantity.items.${item.itemId}`],
            `Approved material norm is ambiguous for ${materialCode}`,
          ),
        );
        continue;
      }
      const norm = selected.record;
      const quantitySource = createApprovedQuantitySource({
        tenantId: quantity.tenantId,
        projectId: quantity.projectId,
        sourceRefId: phase7Id(
          "source-approved-quantity",
          quantity.quantityTakeoffVersionId,
          item.itemId,
        ),
        quantityVersionId: quantity.quantityTakeoffVersionId,
        itemId: item.itemId,
        asOf: input.calculatedAt,
      });
      const calculationSource = createCalculationSource({
        tenantId: quantity.tenantId,
        projectId: quantity.projectId,
        sourceRefId: phase7Id(
          "source-material-calculation",
          quantity.quantityTakeoffVersionId,
          item.itemId,
          materialCode,
        ),
        sourceId: norm.normId,
        fieldPath: `materialRequirements.${item.itemId}.${materialCode}`,
        asOf: input.calculatedAt,
      });
      const required = applyRatio(
        multiplyExactDecimals(
          parseExactDecimal(item.finalQuantity.value),
          parseExactDecimal(norm.quantityPerWorkUnit),
        ),
        norm.wasteFactor,
      );
      const requiredValue = formatExactDecimal(
        roundExactDecimal(required, canonicalQuantityDecimalPlaces[norm.materialUnit]),
      );
      const sourceRefs = uniqueSources([
        quantitySource,
        ...norm.version.sourceRefs,
        calculationSource,
      ]);
      lines.push(
        materialRequirementLineSchema.parse({
          requirementId: phase7Id(
            "material-requirement",
            quantity.quantityTakeoffVersionId,
            item.itemId,
            materialCode,
          ),
          takeoffItemId: item.itemId,
          materialCode,
          requiredQuantity: {
            value: requiredValue,
            unit: norm.materialUnit,
            sourceRefs,
          },
          wasteFactor: norm.wasteFactor,
          normVersion: norm.version,
        }),
      );
    }
  }
  return {
    schemaVersion: 1,
    resultType: "MATERIAL_REQUIREMENTS",
    deterministic: true,
    complete: !issues.some((issue) => issue.severity === "ERROR"),
    lines,
    issues,
  };
}

function validatePrices(
  input: Readonly<{
    prices: readonly ApprovedPriceV1[];
    tenantId: string;
    projectId: string;
    pricingDate: string;
    issues: ContractValidationIssue[];
  }>,
): ApprovedPriceV1[] {
  const prices: ApprovedPriceV1[] = [];
  input.prices.forEach((candidate, index) => {
    const parsed = approvedPriceV1Schema.safeParse(candidate);
    if (!parsed.success) {
      input.issues.push(...schemaIssues("INVALID_APPROVED_PRICE", `prices.${index}`, parsed.error));
      return;
    }
    if (!catalogMatchesScope(parsed.data.version, input.tenantId, input.projectId)) {
      input.issues.push(
        validationIssue(
          "PRICE_SCOPE_MISMATCH",
          [`prices.${index}.version`],
          "Price is outside the estimate scope",
        ),
      );
      return;
    }
    if (catalogIsEffective(parsed.data.version, input.pricingDate)) {
      prices.push(parsed.data);
    }
  });
  return prices;
}

function validateProductivity(
  input: Readonly<{
    rates: readonly ApprovedProductivityRateV1[];
    tenantId: string;
    projectId: string;
    pricingDate: string;
    issues: ContractValidationIssue[];
  }>,
): ApprovedProductivityRateV1[] {
  const rates: ApprovedProductivityRateV1[] = [];
  input.rates.forEach((candidate, index) => {
    const parsed = approvedProductivityRateV1Schema.safeParse(candidate);
    if (!parsed.success) {
      input.issues.push(
        ...schemaIssues("INVALID_PRODUCTIVITY_RATE", `productivityRates.${index}`, parsed.error),
      );
      return;
    }
    if (!catalogMatchesScope(parsed.data.version, input.tenantId, input.projectId)) {
      input.issues.push(
        validationIssue(
          "PRODUCTIVITY_SCOPE_MISMATCH",
          [`productivityRates.${index}.version`],
          "Productivity rate is outside the estimate scope",
        ),
      );
      return;
    }
    if (catalogIsEffective(parsed.data.version, input.pricingDate)) {
      rates.push(parsed.data);
    }
  });
  return rates;
}

function resolvePrice(
  prices: readonly ApprovedPriceV1[],
  query: Readonly<{
    itemCode: string;
    costType: ApprovedPriceV1["costType"];
    unit: ApprovedPriceV1["unit"];
  }>,
): Readonly<{ price: ApprovedPriceV1 | null; ambiguous: boolean }> {
  const selected = selectLatest(
    prices.filter(
      (price) =>
        price.itemCode === query.itemCode &&
        price.costType === query.costType &&
        price.unit === query.unit,
    ),
    (price) => price.priceId,
  );
  return { price: selected.record, ambiguous: selected.ambiguous };
}

function resolveProductivity(
  rates: readonly ApprovedProductivityRateV1[],
  workCode: string,
  workUnit: ApprovedProductivityRateV1["workUnit"],
): Readonly<{ rate: ApprovedProductivityRateV1 | null; ambiguous: boolean }> {
  const selected = selectLatest(
    rates.filter((rate) => rate.workCode === workCode && rate.workUnit === workUnit),
    (rate) => rate.productivityId,
  );
  return { rate: selected.record, ambiguous: selected.ambiguous };
}

function estimateLine(
  input: Readonly<{
    takeoffItemId: string;
    workCode: string;
    pricedItemCode: string;
    costType: Phase7CostType;
    description: string;
    quantityValue: string;
    quantityUnit: EstimateLine["unit"];
    quantitySources: EstimateLine["sourceRefs"];
    price: ApprovedPriceV1;
    normVersion: EstimateLine["normVersion"];
    productivityVersion: EstimateLine["productivityVersion"];
    calculationSource: EstimateLine["sourceRefs"][number];
  }>,
): EstimateLine {
  const lineCost = calculateMoney(input.quantityValue, input.price.unitPriceMnt.value);
  const sourceRefs = uniqueSources([
    ...input.quantitySources,
    ...input.price.unitPriceMnt.sourceRefs,
    ...input.price.version.sourceRefs,
    ...(input.normVersion?.sourceRefs ?? []),
    ...(input.productivityVersion?.sourceRefs ?? []),
    input.calculationSource,
  ]);
  return {
    lineId: phase7Id("estimate-line", input.takeoffItemId, input.costType, input.pricedItemCode),
    takeoffItemId: input.takeoffItemId,
    workCode: input.workCode,
    pricedItemCode: input.pricedItemCode,
    costType: input.costType,
    description: input.description,
    quantity: {
      value: input.quantityValue,
      unit: input.quantityUnit,
      sourceRefs: sourceRefs,
    },
    unit: input.quantityUnit,
    unitPriceMnt: cloneJson(input.price.unitPriceMnt),
    lineCostMnt: {
      value: lineCost,
      currency: "MNT",
      sourceRefs,
    },
    priceVersion: cloneJson(input.price.version),
    normVersion: cloneJson(input.normVersion),
    productivityVersion: cloneJson(input.productivityVersion),
    supplierQuotationId: input.price.supplierQuotationId,
    sourceRefs,
  };
}

export type EstimateGenerationResult = Readonly<{
  schemaVersion: 1;
  resultType: "ESTIMATE_GENERATION";
  deterministic: true;
  complete: boolean;
  draft: EstimateDraftV1;
  issues: readonly ContractValidationIssue[];
}>;

export function generateEstimateDraft(
  input: Readonly<{
    draftId: string;
    approvedQuantity: ApprovedQuantityTakeoffVersionV1;
    materialRequirements: MaterialRequirementResult;
    prices: readonly ApprovedPriceV1[];
    productivityRates: readonly ApprovedProductivityRateV1[];
    policy: EstimateCalculationPolicyV1;
    createdAt: string;
    createdBy: string;
  }>,
): EstimateGenerationResult {
  const quantity = approvedQuantityTakeoffVersionV1Schema.parse(input.approvedQuantity);
  if (quantity.metadata.sourceHash !== phase7Hash(quantity.content)) {
    throw new Error("Approved quantity source hash does not match its content");
  }
  const policy = estimateCalculationPolicyV1Schema.parse(input.policy);
  const issues = [...input.materialRequirements.issues];
  if (
    !catalogMatchesScope(policy.version, quantity.tenantId, quantity.projectId) ||
    !catalogIsEffective(policy.version, policy.pricingDate)
  ) {
    issues.push(
      validationIssue(
        "ESTIMATE_POLICY_NOT_EFFECTIVE",
        ["policy.version"],
        "Estimate policy must be approved, in scope, and effective",
      ),
    );
  }
  const prices = validatePrices({
    prices: input.prices,
    tenantId: quantity.tenantId,
    projectId: quantity.projectId,
    pricingDate: policy.pricingDate,
    issues,
  });
  const productivityRates = validateProductivity({
    rates: input.productivityRates,
    tenantId: quantity.tenantId,
    projectId: quantity.projectId,
    pricingDate: policy.pricingDate,
    issues,
  });
  const itemById = new Map(quantity.content.items.map((item) => [item.itemId, item]));
  const lines: EstimateLine[] = [];

  for (const requirement of input.materialRequirements.lines) {
    const item = itemById.get(requirement.takeoffItemId);
    if (item === undefined) {
      issues.push(
        validationIssue(
          "MATERIAL_REQUIREMENT_ITEM_MISSING",
          [`materialRequirements.${requirement.requirementId}`],
          "Material requirement references an unknown approved quantity item",
        ),
      );
      continue;
    }
    const resolved = resolvePrice(prices, {
      itemCode: requirement.materialCode,
      costType: "MATERIAL",
      unit: requirement.requiredQuantity.unit,
    });
    if (resolved.price === null) {
      issues.push(
        validationIssue(
          resolved.ambiguous ? "MATERIAL_PRICE_AMBIGUOUS" : "MATERIAL_PRICE_MISSING",
          [`materialRequirements.${requirement.requirementId}`],
          `No unambiguous effective material price exists for ${requirement.materialCode}`,
        ),
      );
      continue;
    }
    const calculationSource = createCalculationSource({
      tenantId: quantity.tenantId,
      projectId: quantity.projectId,
      sourceRefId: phase7Id("source-estimate-material", requirement.requirementId),
      sourceId: input.draftId,
      fieldPath: `lines.${requirement.requirementId}`,
      asOf: input.createdAt,
    });
    lines.push(
      estimateLine({
        takeoffItemId: item.itemId,
        workCode: item.workCode,
        pricedItemCode: requirement.materialCode,
        costType: "MATERIAL",
        description: `${requirement.materialCode} material`,
        quantityValue: requirement.requiredQuantity.value,
        quantityUnit: requirement.requiredQuantity.unit,
        quantitySources: requirement.requiredQuantity.sourceRefs,
        price: resolved.price,
        normVersion: requirement.normVersion,
        productivityVersion: null,
        calculationSource,
      }),
    );
  }

  for (const item of quantity.content.items) {
    const resolvedRate = resolveProductivity(
      productivityRates,
      item.workCode,
      item.finalQuantity.unit,
    );
    if (resolvedRate.rate === null) {
      issues.push(
        validationIssue(
          resolvedRate.ambiguous ? "PRODUCTIVITY_RATE_AMBIGUOUS" : "PRODUCTIVITY_RATE_MISSING",
          [`quantity.items.${item.itemId}`],
          `No unambiguous effective productivity rate exists for ${item.workCode}`,
        ),
      );
      continue;
    }
    const rate = resolvedRate.rate;
    const approvedQuantitySource = createApprovedQuantitySource({
      tenantId: quantity.tenantId,
      projectId: quantity.projectId,
      sourceRefId: phase7Id(
        "source-estimate-approved-quantity",
        quantity.quantityTakeoffVersionId,
        item.itemId,
      ),
      quantityVersionId: quantity.quantityTakeoffVersionId,
      itemId: item.itemId,
      asOf: input.createdAt,
    });
    const laborQuantity = formatExactDecimal(
      roundExactDecimal(
        multiplyExactDecimals(
          parseExactDecimal(item.finalQuantity.value),
          parseExactDecimal(rate.laborHoursPerWorkUnit),
        ),
        2,
      ),
    );
    const laborPrice = resolvePrice(prices, {
      itemCode: rate.laborClassCode,
      costType: "LABOR",
      unit: "h",
    });
    if (laborPrice.price === null) {
      issues.push(
        validationIssue(
          laborPrice.ambiguous ? "LABOR_PRICE_AMBIGUOUS" : "LABOR_PRICE_MISSING",
          [`quantity.items.${item.itemId}`],
          `No unambiguous effective labor price exists for ${rate.laborClassCode}`,
        ),
      );
    } else {
      const calculationSource = createCalculationSource({
        tenantId: quantity.tenantId,
        projectId: quantity.projectId,
        sourceRefId: phase7Id("source-estimate-labor", item.itemId),
        sourceId: input.draftId,
        fieldPath: `lines.${item.itemId}.labor`,
        asOf: input.createdAt,
      });
      lines.push(
        estimateLine({
          takeoffItemId: item.itemId,
          workCode: item.workCode,
          pricedItemCode: rate.laborClassCode,
          costType: "LABOR",
          description: `${item.workCode} labor`,
          quantityValue: laborQuantity,
          quantityUnit: "h",
          quantitySources: uniqueSources([
            approvedQuantitySource,
            ...rate.version.sourceRefs,
            calculationSource,
          ]),
          price: laborPrice.price,
          normVersion: null,
          productivityVersion: rate.version,
          calculationSource,
        }),
      );
    }

    for (const equipment of rate.equipment) {
      const equipmentQuantity = formatExactDecimal(
        roundExactDecimal(
          multiplyExactDecimals(
            parseExactDecimal(item.finalQuantity.value),
            parseExactDecimal(equipment.hoursPerWorkUnit),
          ),
          2,
        ),
      );
      const equipmentPrice = resolvePrice(prices, {
        itemCode: equipment.equipmentClassCode,
        costType: "EQUIPMENT",
        unit: "h",
      });
      if (equipmentPrice.price === null) {
        issues.push(
          validationIssue(
            equipmentPrice.ambiguous ? "EQUIPMENT_PRICE_AMBIGUOUS" : "EQUIPMENT_PRICE_MISSING",
            [`quantity.items.${item.itemId}`],
            `No unambiguous effective equipment price exists for ${equipment.equipmentClassCode}`,
          ),
        );
        continue;
      }
      const calculationSource = createCalculationSource({
        tenantId: quantity.tenantId,
        projectId: quantity.projectId,
        sourceRefId: phase7Id(
          "source-estimate-equipment",
          item.itemId,
          equipment.equipmentClassCode,
        ),
        sourceId: input.draftId,
        fieldPath: `lines.${item.itemId}.equipment.${equipment.equipmentClassCode}`,
        asOf: input.createdAt,
      });
      lines.push(
        estimateLine({
          takeoffItemId: item.itemId,
          workCode: item.workCode,
          pricedItemCode: equipment.equipmentClassCode,
          costType: "EQUIPMENT",
          description: `${item.workCode} ${equipment.equipmentClassCode} equipment`,
          quantityValue: equipmentQuantity,
          quantityUnit: "h",
          quantitySources: uniqueSources([
            approvedQuantitySource,
            ...rate.version.sourceRefs,
            calculationSource,
          ]),
          price: equipmentPrice.price,
          normVersion: null,
          productivityVersion: rate.version,
          calculationSource,
        }),
      );
    }
  }

  lines.sort((left, right) => left.lineId.localeCompare(right.lineId));
  const calculationSource = createCalculationSource({
    tenantId: quantity.tenantId,
    projectId: quantity.projectId,
    sourceRefId: phase7Id("source-estimate-total", input.draftId),
    sourceId: input.draftId,
    fieldPath: "estimate.totalMnt",
    asOf: input.createdAt,
  });
  const totalSources = uniqueSources([
    calculationSource,
    ...policy.version.sourceRefs,
    ...lines.flatMap((line) => line.lineCostMnt.sourceRefs),
  ]);
  const subtotal = sumMoney(lines.map((line) => line.lineCostMnt.value));
  const tax = calculateRateAmount(subtotal, policy.taxRate);
  const contingency = calculateRateAmount(subtotal, policy.contingencyRate);
  const total = sumMoney([subtotal, tax, contingency]);
  const costTotal = (costType: Phase7CostType) =>
    sumMoney(
      lines.filter((line) => line.costType === costType).map((line) => line.lineCostMnt.value),
    );
  const money = (value: string) => ({
    value,
    currency: "MNT" as const,
    sourceRefs: totalSources,
  });
  const draft = estimateDraftV1Schema.parse({
    schemaVersion: 1,
    draftType: "ESTIMATE",
    draftId: input.draftId,
    tenantId: quantity.tenantId,
    projectId: quantity.projectId,
    status: issues.some((issue) => issue.severity === "ERROR")
      ? "NEEDS_CORRECTION"
      : "REVIEW_REQUIRED",
    content: {
      quantityTakeoffVersionId: quantity.quantityTakeoffVersionId,
      pricingDate: policy.pricingDate,
      policyVersion: policy.version,
      materialRequirements: cloneJson(input.materialRequirements.lines),
      lines,
      assumptions: [],
      subtotalMnt: money(subtotal),
      taxMnt: money(tax),
      contingencyMnt: money(contingency),
      totalMnt: money(total),
      costBreakdownMnt: {
        material: money(costTotal("MATERIAL")),
        labor: money(costTotal("LABOR")),
        equipment: money(costTotal("EQUIPMENT")),
      },
    },
    validationIssues: issues,
    requiresHumanReview: true,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
  });
  return {
    schemaVersion: 1,
    resultType: "ESTIMATE_GENERATION",
    deterministic: true,
    complete: !issues.some((issue) => issue.severity === "ERROR"),
    draft,
    issues,
  };
}

function verifyEstimateContent(content: EstimateDraftV1["content"]): void {
  if (
    content.pricingDate === undefined ||
    content.policyVersion === undefined ||
    content.costBreakdownMnt === undefined ||
    content.lines.some(
      (line) =>
        line.pricedItemCode === undefined ||
        line.costType === undefined ||
        line.supplierQuotationId === undefined,
    )
  ) {
    throw new Error("Approved Phase 7 estimate metadata is incomplete");
  }
  for (const line of content.lines) {
    const expected = calculateMoney(line.quantity.value, line.unitPriceMnt.value);
    if (expected !== line.lineCostMnt.value) {
      throw new Error(`Estimate line ${line.lineId} is not reproducible`);
    }
  }
  const subtotal = sumMoney(content.lines.map((line) => line.lineCostMnt.value));
  if (subtotal !== content.subtotalMnt.value) {
    throw new Error("Estimate subtotal is not reproducible");
  }
  const breakdown = (costType: Phase7CostType) =>
    sumMoney(
      content.lines
        .filter((line) => line.costType === costType)
        .map((line) => line.lineCostMnt.value),
    );
  const costBreakdown = content.costBreakdownMnt;
  if (
    breakdown("MATERIAL") !== costBreakdown.material.value ||
    breakdown("LABOR") !== costBreakdown.labor.value ||
    breakdown("EQUIPMENT") !== costBreakdown.equipment.value
  ) {
    throw new Error("Estimate cost breakdown is not reproducible");
  }
  const total = sumMoney([
    content.subtotalMnt.value,
    content.taxMnt.value,
    content.contingencyMnt.value,
  ]);
  if (total !== content.totalMnt.value) {
    throw new Error("Estimate total is not reproducible");
  }
}

export function approveEstimate(
  input: Readonly<{
    commandId: string;
    idempotencyKey: string;
    estimateVersionId: string;
    draft: EstimateDraftV1;
    decision: BuildWatchReviewDecision;
    previousVersion?: ApprovedEstimateVersionV1 | null;
  }>,
): ApprovedEstimateCommandV1 {
  const previousVersion = input.previousVersion ?? null;
  if (
    input.draft.status !== "REVIEW_REQUIRED" ||
    input.draft.validationIssues.some((issue) => issue.severity === "ERROR") ||
    input.draft.content.lines.length === 0
  ) {
    throw new Error("Only a complete priced estimate draft can be approved");
  }
  if (input.decision.action !== "APPROVE" || input.decision.reviewerRole !== "PROJECT_MANAGER") {
    throw new Error("Estimate approval requires a project manager");
  }
  if (
    previousVersion !== null &&
    (previousVersion.tenantId !== input.draft.tenantId ||
      previousVersion.projectId !== input.draft.projectId)
  ) {
    throw new Error("Previous estimate version is outside the draft scope");
  }
  if (
    previousVersion !== null &&
    (previousVersion.estimateVersionId === input.estimateVersionId ||
      previousVersion.metadata.sourceHash !== phase7Hash(previousVersion.content))
  ) {
    throw new Error("Previous estimate version ID/hash is not immutable");
  }
  verifyEstimateContent(input.draft.content);
  const content = cloneJson(input.draft.content);
  const approvedVersion = approvedEstimateVersionV1Schema.parse({
    schemaVersion: 1,
    versionType: "APPROVED_ESTIMATE",
    estimateVersionId: input.estimateVersionId,
    tenantId: input.draft.tenantId,
    projectId: input.draft.projectId,
    status: "APPROVED",
    content,
    metadata: {
      version: (previousVersion?.metadata.version ?? 0) + 1,
      approvedBy: input.decision.reviewerId,
      approvedAt: input.decision.decidedAt,
      sourceHash: phase7Hash(content),
      supersedesVersionId: previousVersion?.estimateVersionId ?? null,
    },
  });
  const command = approvedEstimateCommandV1Schema.parse({
    schemaVersion: 1,
    commandType: "APPROVE_ESTIMATE",
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    tenantId: input.draft.tenantId,
    projectId: input.draft.projectId,
    draftId: input.draft.draftId,
    approvedVersion,
    decision: input.decision,
  });
  return deepFreeze(command);
}
