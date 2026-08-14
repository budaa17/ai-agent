import type { ContractValidationIssue } from "../contracts/common.js";
import type { BuildWatchReviewDecision } from "../contracts/buildwatch-v2-common.js";
import type { DesignElementCandidateV1 } from "../contracts/design/index.js";
import {
  approvedQuantityTakeoffCommandV1Schema,
  quantityTakeoffDraftV1Schema,
  type ApprovedQuantityTakeoffCommandV1,
  type ApprovedQuantityTakeoffVersionV1,
  type QuantityTakeoffDraftV1,
  type QuantityTakeoffItem,
} from "../contracts/quantity/index.js";
import {
  quantityCalculationTraceV1Schema,
  quantityEngineerReviewV1Schema,
  quantityFormulaDefinitionV1Schema,
  quantityGenerationRequestV1Schema,
  quantityVersionComparisonV1Schema,
  type QuantityCalculationTraceV1,
  type QuantityEngineerReviewV1,
  type QuantityFormulaDefinitionV1,
  type QuantityGenerationRequestV1,
  type QuantityVersionComparisonV1,
} from "./contracts.js";
import {
  addExactDecimals,
  compareExactDecimals,
  formulaOutput,
  multiplyExactDecimals,
  parseExactDecimal,
  roundExactDecimal,
  subtractExactDecimals,
  formatExactDecimal,
  type ExactDecimal,
} from "./decimal.js";
import {
  cloneJson,
  createCalculationSource,
  createHumanDecisionSource,
  deepFreeze,
  phase7Hash,
  phase7Id,
  sourceMatchesScope,
  uniqueSources,
  validationIssue,
} from "./deterministic.js";

const formulaDefinitions = [
  {
    schemaVersion: 1,
    definitionType: "QUANTITY_FORMULA",
    formulaId: "qty-length-v1",
    formulaKind: "LENGTH",
    expression: "length",
    ruleVersion: "quantity-length-1.0.0",
    resultUnit: "m",
    minimumInputCount: 1,
    maximumInputCount: 1,
    decimalPlaces: 3,
    roundingMode: "ROUND_HALF_UP",
    unitConversionVersion: "canonical-si-v1",
  },
  {
    schemaVersion: 1,
    definitionType: "QUANTITY_FORMULA",
    formulaId: "qty-area-rectangle-v1",
    formulaKind: "AREA_RECTANGLE",
    expression: "side_1 * side_2",
    ruleVersion: "quantity-area-rectangle-1.0.0",
    resultUnit: "m2",
    minimumInputCount: 2,
    maximumInputCount: 2,
    decimalPlaces: 2,
    roundingMode: "ROUND_HALF_UP",
    unitConversionVersion: "canonical-si-v1",
  },
  {
    schemaVersion: 1,
    definitionType: "QUANTITY_FORMULA",
    formulaId: "qty-area-net-openings-v1",
    formulaKind: "AREA_NET_OPENINGS",
    expression: "gross_side_1 * gross_side_2 - sum(opening_area)",
    ruleVersion: "quantity-area-net-openings-1.0.0",
    resultUnit: "m2",
    minimumInputCount: 3,
    maximumInputCount: 100,
    decimalPlaces: 2,
    roundingMode: "ROUND_HALF_UP",
    unitConversionVersion: "canonical-si-v1",
  },
  {
    schemaVersion: 1,
    definitionType: "QUANTITY_FORMULA",
    formulaId: "qty-volume-rectangular-v1",
    formulaKind: "VOLUME_RECTANGULAR",
    expression: "side_1 * side_2 * side_3",
    ruleVersion: "quantity-volume-rectangular-1.0.0",
    resultUnit: "m3",
    minimumInputCount: 3,
    maximumInputCount: 3,
    decimalPlaces: 3,
    roundingMode: "ROUND_HALF_UP",
    unitConversionVersion: "canonical-si-v1",
  },
  {
    schemaVersion: 1,
    definitionType: "QUANTITY_FORMULA",
    formulaId: "qty-count-v1",
    formulaKind: "COUNT",
    expression: "count",
    ruleVersion: "quantity-count-1.0.0",
    resultUnit: "pcs",
    minimumInputCount: 1,
    maximumInputCount: 1,
    decimalPlaces: 0,
    roundingMode: "ROUND_HALF_UP",
    unitConversionVersion: "canonical-si-v1",
  },
] as const;

export const phase7QuantityFormulaRegistry = new Map<string, QuantityFormulaDefinitionV1>(
  formulaDefinitions.map((definition) => {
    const parsed = quantityFormulaDefinitionV1Schema.parse(definition);
    return [parsed.formulaId, parsed];
  }),
);

type QuantityDimension = QuantityTakeoffItem["dimensions"][number];

const linearDimensionKinds = new Set(["LENGTH", "WIDTH", "HEIGHT", "THICKNESS"]);

function validateNonnegativeDimensions(dimensions: readonly QuantityDimension[]): void {
  for (const dimension of dimensions) {
    if (parseExactDecimal(dimension.quantity.value).coefficient < 0n) {
      throw new Error(`Dimension ${dimension.dimensionId} cannot be negative`);
    }
  }
}

function linearValue(dimension: QuantityDimension): ExactDecimal {
  if (!linearDimensionKinds.has(dimension.kind) || dimension.quantity.unit !== "m") {
    throw new Error(`Dimension ${dimension.dimensionId} must be a canonical linear metre input`);
  }
  return parseExactDecimal(dimension.quantity.value);
}

function evaluateFormula(
  formula: QuantityFormulaDefinitionV1,
  dimensions: readonly QuantityDimension[],
): ExactDecimal {
  if (
    dimensions.length < formula.minimumInputCount ||
    dimensions.length > formula.maximumInputCount
  ) {
    throw new Error(
      `Formula ${formula.formulaId} expects ${formula.minimumInputCount}-${formula.maximumInputCount} inputs`,
    );
  }
  validateNonnegativeDimensions(dimensions);

  if (formula.formulaKind === "LENGTH") {
    return linearValue(dimensions[0]!);
  }
  if (formula.formulaKind === "AREA_RECTANGLE") {
    return multiplyExactDecimals(linearValue(dimensions[0]!), linearValue(dimensions[1]!));
  }
  if (formula.formulaKind === "AREA_NET_OPENINGS") {
    const gross = multiplyExactDecimals(linearValue(dimensions[0]!), linearValue(dimensions[1]!));
    const openingTotal = dimensions.slice(2).reduce((sum, dimension) => {
      if (dimension.kind !== "AREA" || dimension.quantity.unit !== "m2") {
        throw new Error(`Opening ${dimension.dimensionId} must be a canonical area input`);
      }
      return addExactDecimals(sum, parseExactDecimal(dimension.quantity.value));
    }, parseExactDecimal("0"));
    const net = subtractExactDecimals(gross, openingTotal);
    if (net.coefficient < 0n) {
      throw new Error("Opening deductions cannot exceed gross area");
    }
    return net;
  }
  if (formula.formulaKind === "VOLUME_RECTANGULAR") {
    return multiplyExactDecimals(
      multiplyExactDecimals(linearValue(dimensions[0]!), linearValue(dimensions[1]!)),
      linearValue(dimensions[2]!),
    );
  }

  const count = dimensions[0]!;
  const parsedCount = parseExactDecimal(count.quantity.value);
  if (count.kind !== "COUNT" || count.quantity.unit !== "pcs" || parsedCount.scale !== 0) {
    throw new Error(`Dimension ${count.dimensionId} must be an integer count`);
  }
  return parsedCount;
}

function applyAdjustment(
  base: ExactDecimal,
  adjustment: QuantityTakeoffItem["adjustment"],
  decimalPlaces: number,
): ExactDecimal {
  if (adjustment === null) {
    return roundExactDecimal(base, decimalPlaces);
  }
  const adjustmentValue = parseExactDecimal(adjustment.quantity.value);
  const adjusted =
    adjustment.kind === "ADD"
      ? addExactDecimals(base, adjustmentValue)
      : adjustment.kind === "SUBTRACT"
        ? subtractExactDecimals(base, adjustmentValue)
        : adjustmentValue;
  if (adjusted.coefficient < 0n) {
    throw new Error("A quantity adjustment cannot produce a negative result");
  }
  return roundExactDecimal(adjusted, decimalPlaces);
}

function requestIssues(error: unknown): ContractValidationIssue[] {
  if (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues.map((issue, index) => {
      const record = issue as { path?: PropertyKey[]; message?: string };
      const fieldPath = record.path?.map(String).join(".") || `request.validation.${index}`;
      return validationIssue(
        "INVALID_QUANTITY_REQUEST",
        [fieldPath],
        record.message ?? "Quantity request validation failed",
      );
    });
  }
  return [
    validationIssue(
      "INVALID_QUANTITY_REQUEST",
      ["request"],
      error instanceof Error ? error.message : String(error),
    ),
  ];
}

function validateCandidate(
  candidate: DesignElementCandidateV1,
  request: QuantityGenerationRequestV1,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  if (candidate.tenantId !== request.tenantId || candidate.projectId !== request.projectId) {
    issues.push(
      validationIssue(
        "QUANTITY_CANDIDATE_SCOPE_MISMATCH",
        [`candidates.${candidate.candidateId}`],
        "Quantity candidate is outside the request scope",
      ),
    );
  }
  if (
    candidate.status !== "ACCEPTED" ||
    candidate.reviewDecision?.action !== "APPROVE" ||
    candidate.reviewDecision.reviewerRole !== "ENGINEER"
  ) {
    issues.push(
      validationIssue(
        "QUANTITY_CANDIDATE_NOT_ENGINEER_ACCEPTED",
        [`candidates.${candidate.candidateId}.status`],
        "Quantity requires an engineer-accepted element candidate",
      ),
    );
  }
  if (
    candidate.revisionId !== request.verifiedScale.revisionId ||
    candidate.pageId !== request.verifiedScale.pageId ||
    candidate.scaleId !== request.verifiedScale.scaleId
  ) {
    issues.push(
      validationIssue(
        "QUANTITY_SCALE_MISMATCH",
        [`candidates.${candidate.candidateId}.scaleId`],
        "Metric quantity requires the exact verified revision/page scale",
      ),
    );
  }
  if (
    candidate.sourceRefs.length === 0 ||
    candidate.dimensions.some(
      (dimension) =>
        dimension.quantity.sourceRefs.length === 0 ||
        dimension.quantity.sourceRefs.some(
          (source) => !sourceMatchesScope(source, request.tenantId, request.projectId),
        ),
    )
  ) {
    issues.push(
      validationIssue(
        "QUANTITY_SOURCE_REQUIRED",
        [`candidates.${candidate.candidateId}.sourceRefs`],
        "Every accepted quantity input requires an in-scope source reference",
      ),
    );
  }
  if (candidate.missingInformation.some((item) => item.blocksQuantity)) {
    issues.push(
      validationIssue(
        "QUANTITY_BLOCKED_BY_MISSING_INFORMATION",
        [`candidates.${candidate.candidateId}.missingInformation`],
        "Blocking design information must be resolved before takeoff",
      ),
    );
  }
  return issues;
}

export type QuantityGenerationResult = Readonly<{
  draft: QuantityTakeoffDraftV1 | null;
  traces: readonly QuantityCalculationTraceV1[];
  issues: readonly ContractValidationIssue[];
  deterministic: true;
}>;

export function generateQuantityTakeoffDraft(
  input: QuantityGenerationRequestV1,
): QuantityGenerationResult {
  const parsedRequest = quantityGenerationRequestV1Schema.safeParse(input);
  if (!parsedRequest.success) {
    return {
      draft: null,
      traces: [],
      issues: requestIssues(parsedRequest.error),
      deterministic: true,
    };
  }
  const request = parsedRequest.data;
  const issues: ContractValidationIssue[] = [];
  if (
    request.verifiedScale.tenantId !== request.tenantId ||
    request.verifiedScale.projectId !== request.projectId ||
    request.verifiedScale.status !== "VERIFIED"
  ) {
    issues.push(
      validationIssue(
        "QUANTITY_VERIFIED_SCALE_REQUIRED",
        ["verifiedScale"],
        "Quantity generation requires an in-scope verified scale",
      ),
    );
  }

  const candidateById = new Map(
    request.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const dimensionById = new Map<
    string,
    Readonly<{ dimension: QuantityDimension; candidate: DesignElementCandidateV1 }>
  >();
  const invalidCandidateIds = new Set<string>();
  for (const candidate of request.candidates) {
    const candidateIssues = validateCandidate(candidate, request);
    issues.push(...candidateIssues);
    if (candidateIssues.some((issue) => issue.severity === "ERROR")) {
      invalidCandidateIds.add(candidate.candidateId);
    }
    for (const dimension of candidate.dimensions) {
      if (dimensionById.has(dimension.dimensionId)) {
        issues.push(
          validationIssue(
            "DUPLICATE_QUANTITY_DIMENSION_ID",
            [`candidates.${candidate.candidateId}.dimensions`],
            `Dimension ${dimension.dimensionId} is not globally unique`,
          ),
        );
      } else {
        dimensionById.set(dimension.dimensionId, { dimension, candidate });
      }
    }
  }

  const calculationSource = createCalculationSource({
    tenantId: request.tenantId,
    projectId: request.projectId,
    sourceRefId: phase7Id("source-quantity-calculation", request.requestId),
    sourceId: request.requestId,
    fieldPath: "quantityTakeoff.items",
    asOf: request.createdAt,
  });
  const items: QuantityTakeoffItem[] = [];
  const traces: QuantityCalculationTraceV1[] = [];

  for (const itemRequest of [...request.items].sort((left, right) =>
    left.itemId.localeCompare(right.itemId),
  )) {
    const itemIssueCount = issues.length;
    const mainCandidate = candidateById.get(itemRequest.elementCandidateId);
    if (mainCandidate === undefined) {
      issues.push(
        validationIssue(
          "QUANTITY_ELEMENT_NOT_FOUND",
          [`items.${itemRequest.itemId}.elementCandidateId`],
          "Quantity item references an unknown element candidate",
        ),
      );
      continue;
    }
    if (invalidCandidateIds.has(mainCandidate.candidateId)) {
      continue;
    }
    const formula = phase7QuantityFormulaRegistry.get(itemRequest.formulaId);
    if (formula === undefined) {
      issues.push(
        validationIssue(
          "QUANTITY_FORMULA_NOT_FOUND",
          [`items.${itemRequest.itemId}.formulaId`],
          `Formula ${itemRequest.formulaId} is not registered`,
        ),
      );
      continue;
    }
    const dimensions: QuantityDimension[] = [];
    const inputCandidates = new Set<string>();
    for (const dimensionId of itemRequest.dimensionInputIds) {
      const entry = dimensionById.get(dimensionId);
      if (entry === undefined) {
        issues.push(
          validationIssue(
            "QUANTITY_DIMENSION_NOT_FOUND",
            [`items.${itemRequest.itemId}.dimensionInputIds`],
            `Dimension ${dimensionId} is not an accepted reviewed input`,
          ),
        );
      } else {
        if (invalidCandidateIds.has(entry.candidate.candidateId)) {
          issues.push(
            validationIssue(
              "QUANTITY_INPUT_CANDIDATE_INVALID",
              [`items.${itemRequest.itemId}.dimensionInputIds`],
              `Dimension ${dimensionId} belongs to an invalid candidate`,
            ),
          );
        }
        dimensions.push(cloneJson(entry.dimension));
        inputCandidates.add(entry.candidate.candidateId);
      }
    }
    if (!inputCandidates.has(mainCandidate.candidateId)) {
      issues.push(
        validationIssue(
          "QUANTITY_MAIN_ELEMENT_INPUT_REQUIRED",
          [`items.${itemRequest.itemId}.dimensionInputIds`],
          "A quantity item must use at least one dimension from its main element",
        ),
      );
    }
    if (issues.length > itemIssueCount) {
      continue;
    }

    try {
      const evaluated = evaluateFormula(formula, dimensions);
      const output = formulaOutput(evaluated, formula);
      const baseRounded = roundExactDecimal(evaluated, formula.decimalPlaces);
      const adjustment =
        itemRequest.adjustment === null
          ? null
          : {
              adjustmentId: itemRequest.adjustment.adjustmentId,
              kind: itemRequest.adjustment.kind,
              quantity: cloneJson(itemRequest.adjustment.quantity),
              reason: itemRequest.adjustment.reason,
              adjustedBy: itemRequest.adjustment.decision.reviewerId,
              adjustedAt: itemRequest.adjustment.decision.decidedAt,
            };
      if (adjustment !== null && adjustment.quantity.unit !== formula.resultUnit) {
        throw new Error("Adjustment unit must match formula result unit");
      }
      const final = applyAdjustment(baseRounded, adjustment, formula.decimalPlaces);
      const dimensionSources = dimensions.flatMap((dimension) => dimension.quantity.sourceRefs);
      const adjustmentSources =
        itemRequest.adjustment === null
          ? []
          : [
              ...itemRequest.adjustment.quantity.sourceRefs,
              createHumanDecisionSource({
                tenantId: request.tenantId,
                projectId: request.projectId,
                sourceRefId: phase7Id(
                  "source-quantity-adjustment",
                  itemRequest.adjustment.decision.decisionId,
                ),
                decisionId: itemRequest.adjustment.decision.decisionId,
                fieldPath: `items.${itemRequest.itemId}.adjustment`,
                asOf: itemRequest.adjustment.decision.decidedAt,
              }),
            ];
      const sourceRefs = uniqueSources([
        ...dimensionSources,
        ...mainCandidate.sourceRefs,
        ...adjustmentSources,
        calculationSource,
      ]);
      const reviewedBy = mainCandidate.reviewDecision!.reviewerId;
      const reviewedAt = mainCandidate.reviewDecision!.decidedAt;
      const takeoffItem: QuantityTakeoffItem = {
        itemId: itemRequest.itemId,
        elementCandidateId: itemRequest.elementCandidateId,
        workCode: itemRequest.workCode,
        formula: {
          formulaId: formula.formulaId,
          expression: formula.expression,
          resultUnit: formula.resultUnit,
          dimensionInputIds: [...itemRequest.dimensionInputIds],
          ruleVersion: formula.ruleVersion,
          roundingMode: formula.roundingMode,
          decimalPlaces: formula.decimalPlaces,
          unitConversionVersion: formula.unitConversionVersion,
          reviewedBy,
          reviewedAt,
        },
        dimensions,
        baseQuantity: {
          value: formatExactDecimal(baseRounded),
          unit: formula.resultUnit,
          sourceRefs: uniqueSources([...dimensionSources, calculationSource]),
        },
        wasteFactor: "0",
        adjustment,
        finalQuantity: {
          value: formatExactDecimal(final),
          unit: formula.resultUnit,
          sourceRefs,
        },
        sourceRefs,
      };
      items.push(takeoffItem);
      traces.push(
        quantityCalculationTraceV1Schema.parse({
          schemaVersion: 1,
          traceType: "QUANTITY_CALCULATION",
          traceId: phase7Id("quantity-trace", request.requestId, itemRequest.itemId),
          itemId: itemRequest.itemId,
          formulaId: formula.formulaId,
          ruleVersion: formula.ruleVersion,
          expression: formula.expression,
          orderedDimensionInputIds: [...itemRequest.dimensionInputIds],
          unroundedValue: output.unrounded,
          roundedValue: output.rounded,
          resultUnit: formula.resultUnit,
          decimalPlaces: formula.decimalPlaces,
          roundingMode: formula.roundingMode,
          unitConversionVersion: formula.unitConversionVersion,
          sourceRefs,
          reviewedBy,
          reviewedAt,
        }),
      );
    } catch (error) {
      issues.push(
        validationIssue(
          "QUANTITY_FORMULA_EVALUATION_FAILED",
          [`items.${itemRequest.itemId}`],
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  if (items.length === 0) {
    return { draft: null, traces, issues, deterministic: true };
  }
  const draft = quantityTakeoffDraftV1Schema.parse({
    schemaVersion: 1,
    draftType: "QUANTITY_TAKEOFF",
    draftId: request.draftId,
    tenantId: request.tenantId,
    projectId: request.projectId,
    status: issues.some((issue) => issue.severity === "ERROR")
      ? "NEEDS_CORRECTION"
      : "REVIEW_REQUIRED",
    content: {
      drawingRevisionId: request.verifiedScale.revisionId,
      verifiedScaleId: request.verifiedScale.scaleId,
      scaleStatus: "VERIFIED",
      items,
    },
    validationIssues: issues,
    requiresHumanReview: true,
    createdAt: request.createdAt,
    createdBy: request.createdBy,
  });
  return { draft, traces, issues, deterministic: true };
}

export function reviewQuantityDraft(
  input: Readonly<{
    reviewId: string;
    draft: QuantityTakeoffDraftV1;
    decision: BuildWatchReviewDecision;
  }>,
): QuantityEngineerReviewV1 {
  if (input.decision.reviewerRole !== "ENGINEER") {
    throw new Error("Quantity engineering review requires an engineer");
  }
  return quantityEngineerReviewV1Schema.parse({
    schemaVersion: 1,
    reviewType: "QUANTITY_ENGINEER_REVIEW",
    reviewId: input.reviewId,
    tenantId: input.draft.tenantId,
    projectId: input.draft.projectId,
    draftId: input.draft.draftId,
    reviewedContentHash: phase7Hash(input.draft.content),
    decision: input.decision,
    adjustmentIds: input.draft.content.items.flatMap((item) =>
      item.adjustment === null ? [] : [item.adjustment.adjustmentId],
    ),
    reviewedAt: input.decision.decidedAt,
  });
}

function verifyQuantityItem(item: QuantityTakeoffItem): void {
  const formula = phase7QuantityFormulaRegistry.get(item.formula.formulaId);
  if (formula === undefined || formula.ruleVersion !== item.formula.ruleVersion) {
    throw new Error(`Quantity formula ${item.formula.formulaId} is unavailable`);
  }
  if (
    item.formula.roundingMode !== formula.roundingMode ||
    item.formula.decimalPlaces !== formula.decimalPlaces ||
    item.formula.unitConversionVersion !== formula.unitConversionVersion ||
    item.formula.reviewedBy === undefined ||
    item.formula.reviewedAt === undefined
  ) {
    throw new Error(`Quantity item ${item.itemId} lacks Phase 7 formula metadata`);
  }
  if (item.wasteFactor !== "0") {
    throw new Error("Geometric takeoff cannot hide material waste");
  }
  const evaluated = evaluateFormula(formula, item.dimensions);
  const expectedBase = roundExactDecimal(evaluated, formula.decimalPlaces);
  const expectedFinal = applyAdjustment(expectedBase, item.adjustment, formula.decimalPlaces);
  if (
    compareExactDecimals(expectedBase, parseExactDecimal(item.baseQuantity.value)) !== 0 ||
    compareExactDecimals(expectedFinal, parseExactDecimal(item.finalQuantity.value)) !== 0
  ) {
    throw new Error(`Quantity item ${item.itemId} is not reproducible`);
  }
}

export function approveQuantityTakeoff(
  input: Readonly<{
    commandId: string;
    idempotencyKey: string;
    quantityTakeoffVersionId: string;
    draft: QuantityTakeoffDraftV1;
    engineerReview: QuantityEngineerReviewV1;
    decision: BuildWatchReviewDecision;
    previousVersion?: ApprovedQuantityTakeoffVersionV1 | null;
  }>,
): ApprovedQuantityTakeoffCommandV1 {
  const previousVersion = input.previousVersion ?? null;
  if (
    input.draft.status !== "REVIEW_REQUIRED" ||
    input.draft.validationIssues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new Error("Only an error-free reviewed quantity draft can be approved");
  }
  if (
    input.engineerReview.draftId !== input.draft.draftId ||
    input.engineerReview.decision.action !== "APPROVE" ||
    input.engineerReview.reviewedContentHash !== phase7Hash(input.draft.content)
  ) {
    throw new Error("Estimator approval requires a matching engineer approval");
  }
  if (input.decision.action !== "APPROVE" || input.decision.reviewerRole !== "ESTIMATOR") {
    throw new Error("Quantity takeoff approval requires an estimator");
  }
  if (
    previousVersion !== null &&
    (previousVersion.tenantId !== input.draft.tenantId ||
      previousVersion.projectId !== input.draft.projectId)
  ) {
    throw new Error("Previous quantity version is outside the draft scope");
  }
  if (
    previousVersion !== null &&
    (previousVersion.quantityTakeoffVersionId === input.quantityTakeoffVersionId ||
      previousVersion.metadata.sourceHash !== phase7Hash(previousVersion.content))
  ) {
    throw new Error("Previous quantity version ID/hash is not immutable");
  }
  input.draft.content.items.forEach(verifyQuantityItem);
  const content = cloneJson(input.draft.content);
  const command = approvedQuantityTakeoffCommandV1Schema.parse({
    schemaVersion: 1,
    commandType: "APPROVE_QUANTITY_TAKEOFF",
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    tenantId: input.draft.tenantId,
    projectId: input.draft.projectId,
    draftId: input.draft.draftId,
    approvedVersion: {
      schemaVersion: 1,
      versionType: "APPROVED_QUANTITY_TAKEOFF",
      quantityTakeoffVersionId: input.quantityTakeoffVersionId,
      tenantId: input.draft.tenantId,
      projectId: input.draft.projectId,
      status: "APPROVED",
      content,
      metadata: {
        version: (previousVersion?.metadata.version ?? 0) + 1,
        approvedBy: input.decision.reviewerId,
        approvedAt: input.decision.decidedAt,
        sourceHash: phase7Hash(content),
        supersedesVersionId: previousVersion?.quantityTakeoffVersionId ?? null,
      },
    },
    decision: input.decision,
  });
  return deepFreeze(command);
}

export function compareQuantityVersions(
  previous: ApprovedQuantityTakeoffVersionV1,
  current: ApprovedQuantityTakeoffVersionV1,
): QuantityVersionComparisonV1 {
  if (previous.tenantId !== current.tenantId || previous.projectId !== current.projectId) {
    throw new Error("Quantity versions must share a tenant/project scope");
  }
  const previousById = new Map(previous.content.items.map((item) => [item.itemId, item]));
  const currentById = new Map(current.content.items.map((item) => [item.itemId, item]));
  const itemIds = [...new Set([...previousById.keys(), ...currentById.keys()])].sort();
  return quantityVersionComparisonV1Schema.parse({
    schemaVersion: 1,
    comparisonType: "QUANTITY_VERSION_COMPARISON",
    previousVersionId: previous.quantityTakeoffVersionId,
    currentVersionId: current.quantityTakeoffVersionId,
    changes: itemIds.map((itemId) => {
      const before = previousById.get(itemId);
      const after = currentById.get(itemId);
      const changeType =
        before === undefined
          ? "ADDED"
          : after === undefined
            ? "REMOVED"
            : phase7Hash(before) === phase7Hash(after)
              ? "UNCHANGED"
              : "CHANGED";
      return {
        itemId,
        changeType,
        previousValue: before?.finalQuantity.value ?? null,
        currentValue: after?.finalQuantity.value ?? null,
        unit: (after ?? before)!.finalQuantity.unit,
        reason:
          changeType === "CHANGED"
            ? (after?.adjustment?.reason ?? "Formula, dimensions, or sources changed")
            : null,
      };
    }),
  });
}
