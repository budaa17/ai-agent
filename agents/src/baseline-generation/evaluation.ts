import {
  approveEstimate,
  calculateMaterialRequirements,
  generateEstimateDraft,
} from "./estimate.js";
import {
  buildPhase7Decision,
  buildPhase7EstimatePolicy,
  buildPhase7MaterialNorms,
  buildPhase7Prices,
  buildPhase7ProductivityRates,
  buildPhase7QuantityRequest,
  buildPhase7ScheduleRequest,
  phase7FixtureTimes,
} from "./fixtures.js";
import { runPhase7GoldenPipeline } from "./pipeline.js";
import {
  approveQuantityTakeoff,
  generateQuantityTakeoffDraft,
  reviewQuantityDraft,
} from "./quantity.js";
import { approveBaseline, calculateCpmSchedule, generateScheduleDraft } from "./schedule.js";
import { phase7Hash } from "./deterministic.js";
import type { QuantityGenerationRequestV1 } from "./contracts.js";

export type BaselineGenerationEvaluationReport = Readonly<{
  schemaVersion: 1;
  evaluationType: "BUILDWATCH_V22_BASELINE_GENERATION";
  evaluatedAt: string;
  metrics: Readonly<{
    formulaCaseCount: number;
    formulaAccuracy: number;
    quantitySourceCoverage: number;
    materialSourceCoverage: number;
    estimateSourceCoverage: number;
    sourceLessFinalRowCount: number;
    unverifiedScaleFinalRowCount: number;
    missingNormFinalRowCount: number;
    missingPriceFinalRowCount: number;
    zeroPriceFinalRowCount: number;
    approvedEstimateLineCount: number;
    cpmPassed: boolean;
    baselineMutationCount: number;
    supersessionReasonPassed: boolean;
    deterministicReplayPassed: boolean;
    reviewerChainPassed: boolean;
    adversarialPassCount: number;
    adversarialCaseCount: number;
  }>;
  thresholds: Readonly<{
    minimumFormulaAccuracy: number;
    minimumSourceCoverage: number;
    maximumFabricatedFinalRows: number;
    minimumAdversarialAccuracy: number;
  }>;
  passed: boolean;
}>;

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function catches(action: () => unknown): boolean {
  try {
    action();
    return false;
  } catch {
    return true;
  }
}

export function evaluateBaselineGenerationV22(): BaselineGenerationEvaluationReport {
  const pipeline = runPhase7GoldenPipeline();
  const expectedQuantity = new Map([
    ["item-beam", "8:m"],
    ["item-door", "1:pcs"],
    ["item-floor", "16.5:m2"],
    ["item-slab", "3:m3"],
    ["item-wall", "28:m2"],
  ]);
  const formulaCorrect = pipeline.quantityCommand.approvedVersion.content.items.filter(
    (item) =>
      expectedQuantity.get(item.itemId) ===
      `${item.finalQuantity.value}:${item.finalQuantity.unit}`,
  ).length;
  const quantityItems = pipeline.quantityCommand.approvedVersion.content.items;
  const quantitySourceBacked = quantityItems.filter(
    (item) =>
      item.sourceRefs.length > 0 &&
      item.dimensions.every((dimension) => dimension.quantity.sourceRefs.length > 0) &&
      item.finalQuantity.sourceRefs.length > 0,
  ).length;
  const materialLines = pipeline.materialResult.lines;
  const materialSourceBacked = materialLines.filter(
    (line) => line.requiredQuantity.sourceRefs.length > 0 && line.normVersion.sourceRefs.length > 0,
  ).length;
  const estimateLines = pipeline.estimateCommand.approvedVersion.content.lines;
  const estimateSourceBacked = estimateLines.filter(
    (line) =>
      line.sourceRefs.length > 0 &&
      line.quantity.sourceRefs.length > 0 &&
      line.unitPriceMnt.sourceRefs.length > 0 &&
      line.lineCostMnt.sourceRefs.length > 0,
  ).length;

  const sourceLess = structuredClone(buildPhase7QuantityRequest());
  sourceLess.candidates[0]!.sourceRefs = [];
  const sourceLessResult = generateQuantityTakeoffDraft(
    sourceLess as unknown as QuantityGenerationRequestV1,
  );
  const sourceLessFinalRowCount = sourceLessResult.draft?.content.items.length ?? 0;

  const wrongScale = buildPhase7QuantityRequest();
  wrongScale.candidates = [
    wrongScale.candidates.find((candidate) => candidate.candidateId === "candidate-floor")!,
  ];
  wrongScale.candidates[0]!.scaleId = "unverified-scale";
  wrongScale.items = [
    {
      itemId: "item-floor",
      elementCandidateId: "candidate-floor",
      workCode: "FLOOR-TILE",
      formulaId: "qty-area-rectangle-v1",
      dimensionInputIds: ["floor-length", "floor-width"],
      adjustment: null,
    },
  ];
  const wrongScaleResult = generateQuantityTakeoffDraft(wrongScale);
  const unverifiedScaleFinalRowCount = wrongScaleResult.draft?.content.items.length ?? 0;

  const missingNorm = calculateMaterialRequirements({
    approvedQuantity: pipeline.quantityCommand.approvedVersion,
    norms: buildPhase7MaterialNorms().filter((norm) => norm.workCode !== "WALL-AAC-200"),
    asOf: "2026-08-03",
    calculatedAt: phase7FixtureTimes.estimateCreated,
  });
  const missingNormFinalRowCount = missingNorm.lines.filter(
    (line) => line.takeoffItemId === "item-wall",
  ).length;

  const missingPrice = generateEstimateDraft({
    draftId: "evaluation-missing-price",
    approvedQuantity: pipeline.quantityCommand.approvedVersion,
    materialRequirements: pipeline.materialResult,
    prices: buildPhase7Prices().filter((price) => price.itemCode !== "AAC-BLOCK"),
    productivityRates: buildPhase7ProductivityRates(),
    policy: buildPhase7EstimatePolicy(),
    createdAt: phase7FixtureTimes.estimateCreated,
    createdBy: "A0-EVALUATOR",
  });
  const missingPriceFinalRowCount = missingPrice.draft.content.lines.filter(
    (line) => line.pricedItemCode === "AAC-BLOCK",
  ).length;
  const zeroPriceFinalRowCount = missingPrice.draft.content.lines.filter(
    (line) => line.unitPriceMnt.value === "0.00",
  ).length;

  const cpmPassed =
    pipeline.scheduleResult.cpm !== null &&
    pipeline.scheduleResult.cpm.projectDurationWorkingDays === 9 &&
    pipeline.baselineCommand.approvedVersion.content.plannedFinish === "2026-08-13";
  const baselineMutationCount =
    Object.isFrozen(pipeline.baselineCommand.approvedVersion) &&
    Object.isFrozen(pipeline.baselineCommand.approvedVersion.content) &&
    Object.isFrozen(pipeline.baselineCommand.approvedVersion.content.activities)
      ? 0
      : 1;

  const changedDraft = structuredClone(pipeline.baselineDraft);
  changedDraft.draftId = "evaluation-baseline-v2";
  changedDraft.content.plannedFinish = "2026-08-14";
  const superseding = approveBaseline({
    commandId: "evaluation-baseline-command-v2",
    idempotencyKey: "evaluation-baseline-v2",
    baselineVersionId: "evaluation-baseline-version-v2",
    draft: changedDraft,
    decision: {
      ...buildPhase7Decision("BASELINE_APPROVAL"),
      decisionId: "evaluation-baseline-decision-v2",
      decidedAt: "2026-08-03T02:00:00.000Z",
    },
    previousVersion: pipeline.baselineCommand.approvedVersion,
    changeReason: "Evaluation calendar change",
  });
  const supersessionReasonPassed =
    superseding.approvedVersion.metadata.version === 2 &&
    superseding.approvedVersion.metadata.supersedesVersionId ===
      pipeline.baselineCommand.approvedVersion.baselineVersionId &&
    superseding.changeReason === "Evaluation calendar change";

  const replay = runPhase7GoldenPipeline();
  const deterministicReplayPassed =
    phase7Hash(pipeline.quantityCommand.approvedVersion.content) ===
      phase7Hash(replay.quantityCommand.approvedVersion.content) &&
    phase7Hash(pipeline.estimateCommand.approvedVersion.content) ===
      phase7Hash(replay.estimateCommand.approvedVersion.content) &&
    phase7Hash(pipeline.baselineCommand.approvedVersion.content) ===
      phase7Hash(replay.baselineCommand.approvedVersion.content);
  const reviewerChainPassed =
    pipeline.quantityEngineerReview.decision.reviewerRole === "ENGINEER" &&
    pipeline.quantityCommand.decision.reviewerRole === "ESTIMATOR" &&
    pipeline.estimateCommand.decision.reviewerRole === "PROJECT_MANAGER" &&
    pipeline.approvedSchedule.metadata.approvedBy === "user-project-manager" &&
    pipeline.baselineCommand.decision.reviewerRole === "PROJECT_MANAGER";

  const adversarialResults: boolean[] = [];
  const negative = buildPhase7QuantityRequest();
  negative.candidates = [
    negative.candidates.find((candidate) => candidate.candidateId === "candidate-beam")!,
  ];
  negative.candidates[0]!.dimensions[0]!.quantity.value = "-1";
  negative.items = [negative.items.find((item) => item.itemId === "item-beam")!];
  adversarialResults.push(generateQuantityTakeoffDraft(negative).draft === null);

  const excessiveOpening = buildPhase7QuantityRequest();
  excessiveOpening.candidates
    .find((candidate) => candidate.candidateId === "candidate-door")!
    .dimensions.find((dimension) => dimension.dimensionId === "door-area")!.quantity.value = "40";
  excessiveOpening.items = [excessiveOpening.items.find((item) => item.itemId === "item-wall")!];
  adversarialResults.push(generateQuantityTakeoffDraft(excessiveOpening).draft === null);

  const quantityDraft = pipeline.quantityResult.draft!;
  const staleReview = reviewQuantityDraft({
    reviewId: "evaluation-stale-review",
    draft: quantityDraft,
    decision: buildPhase7Decision("ENGINEER_REVIEW"),
  });
  const alteredQuantity = structuredClone(quantityDraft);
  alteredQuantity.content.items[0]!.finalQuantity.value = "999";
  adversarialResults.push(
    catches(() =>
      approveQuantityTakeoff({
        commandId: "evaluation-stale-command",
        idempotencyKey: "evaluation-stale-command",
        quantityTakeoffVersionId: "evaluation-stale-version",
        draft: alteredQuantity,
        engineerReview: staleReview,
        decision: buildPhase7Decision("QUANTITY_APPROVAL"),
      }),
    ),
  );

  adversarialResults.push(
    catches(() =>
      approveEstimate({
        commandId: "evaluation-missing-price-command",
        idempotencyKey: "evaluation-missing-price-command",
        estimateVersionId: "evaluation-missing-price-version",
        draft: missingPrice.draft,
        decision: buildPhase7Decision("ESTIMATE_APPROVAL"),
      }),
    ),
  );

  adversarialResults.push(
    catches(() =>
      calculateCpmSchedule(
        [
          { activityId: "A", durationWorkingDays: 1 },
          { activityId: "B", durationWorkingDays: 1 },
        ],
        [
          {
            predecessorActivityId: "A",
            successorActivityId: "B",
            type: "FINISH_TO_START",
            lagWorkingDays: 0,
          },
          {
            predecessorActivityId: "B",
            successorActivityId: "A",
            type: "FINISH_TO_START",
            lagWorkingDays: 0,
          },
        ],
      ),
    ),
  );

  const missingTemplateRequest = buildPhase7ScheduleRequest({
    approvedQuantity: pipeline.quantityCommand.approvedVersion,
    approvedEstimate: pipeline.estimateCommand.approvedVersion,
  });
  missingTemplateRequest.workTemplates = missingTemplateRequest.workTemplates.filter(
    (template) => template.workCode !== "WALL-AAC-200",
  );
  const missingTemplate = generateScheduleDraft({
    request: missingTemplateRequest,
    approvedQuantity: pipeline.quantityCommand.approvedVersion,
    approvedEstimate: pipeline.estimateCommand.approvedVersion,
  });
  adversarialResults.push(
    !missingTemplate.complete &&
      missingTemplate.issues.some(
        (issue) => issue.code === "SCHEDULE_WORK_TEMPLATE_MISSING_OR_AMBIGUOUS",
      ),
  );
  adversarialResults.push(
    catches(() =>
      approveBaseline({
        commandId: "evaluation-unchanged-baseline",
        idempotencyKey: "evaluation-unchanged-baseline",
        baselineVersionId: "evaluation-unchanged-version",
        draft: pipeline.baselineDraft,
        decision: buildPhase7Decision("BASELINE_APPROVAL"),
        previousVersion: pipeline.baselineCommand.approvedVersion,
        changeReason: "No effective change",
      }),
    ),
  );

  const metrics = {
    formulaCaseCount: expectedQuantity.size,
    formulaAccuracy: ratio(formulaCorrect, expectedQuantity.size),
    quantitySourceCoverage: ratio(quantitySourceBacked, quantityItems.length),
    materialSourceCoverage: ratio(materialSourceBacked, materialLines.length),
    estimateSourceCoverage: ratio(estimateSourceBacked, estimateLines.length),
    sourceLessFinalRowCount,
    unverifiedScaleFinalRowCount,
    missingNormFinalRowCount,
    missingPriceFinalRowCount,
    zeroPriceFinalRowCount,
    approvedEstimateLineCount: estimateLines.length,
    cpmPassed,
    baselineMutationCount,
    supersessionReasonPassed,
    deterministicReplayPassed,
    reviewerChainPassed,
    adversarialPassCount: adversarialResults.filter(Boolean).length,
    adversarialCaseCount: adversarialResults.length,
  };
  const thresholds = {
    minimumFormulaAccuracy: 1,
    minimumSourceCoverage: 1,
    maximumFabricatedFinalRows: 0,
    minimumAdversarialAccuracy: 1,
  };
  const passed =
    metrics.formulaAccuracy >= thresholds.minimumFormulaAccuracy &&
    metrics.quantitySourceCoverage >= thresholds.minimumSourceCoverage &&
    metrics.materialSourceCoverage >= thresholds.minimumSourceCoverage &&
    metrics.estimateSourceCoverage >= thresholds.minimumSourceCoverage &&
    metrics.sourceLessFinalRowCount <= thresholds.maximumFabricatedFinalRows &&
    metrics.unverifiedScaleFinalRowCount <= thresholds.maximumFabricatedFinalRows &&
    metrics.missingNormFinalRowCount <= thresholds.maximumFabricatedFinalRows &&
    metrics.missingPriceFinalRowCount <= thresholds.maximumFabricatedFinalRows &&
    metrics.zeroPriceFinalRowCount <= thresholds.maximumFabricatedFinalRows &&
    metrics.cpmPassed &&
    metrics.baselineMutationCount === 0 &&
    metrics.supersessionReasonPassed &&
    metrics.deterministicReplayPassed &&
    metrics.reviewerChainPassed &&
    ratio(metrics.adversarialPassCount, metrics.adversarialCaseCount) >=
      thresholds.minimumAdversarialAccuracy;
  return {
    schemaVersion: 1,
    evaluationType: "BUILDWATCH_V22_BASELINE_GENERATION",
    evaluatedAt: phase7FixtureTimes.baselineApproval,
    metrics,
    thresholds,
    passed,
  };
}
