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
import {
  approveQuantityTakeoff,
  generateQuantityTakeoffDraft,
  reviewQuantityDraft,
} from "./quantity.js";
import {
  approveBaseline,
  approveSchedule,
  composeBaselineDraft,
  generateScheduleDraft,
} from "./schedule.js";

export function runPhase7GoldenPipeline() {
  const quantityResult = generateQuantityTakeoffDraft(buildPhase7QuantityRequest());
  if (quantityResult.draft === null) {
    throw new Error("Golden quantity draft was not generated");
  }
  const quantityEngineerReview = reviewQuantityDraft({
    reviewId: "quantity-engineer-review-phase7",
    draft: quantityResult.draft,
    decision: buildPhase7Decision("ENGINEER_REVIEW"),
  });
  const quantityCommand = approveQuantityTakeoff({
    commandId: "approve-quantity-command-phase7",
    idempotencyKey: "approve-quantity-phase7",
    quantityTakeoffVersionId: "quantity-version-phase7",
    draft: quantityResult.draft,
    engineerReview: quantityEngineerReview,
    decision: buildPhase7Decision("QUANTITY_APPROVAL"),
  });
  const materialResult = calculateMaterialRequirements({
    approvedQuantity: quantityCommand.approvedVersion,
    norms: buildPhase7MaterialNorms(),
    asOf: "2026-08-03",
    calculatedAt: phase7FixtureTimes.estimateCreated,
  });
  const estimateResult = generateEstimateDraft({
    draftId: "estimate-draft-phase7",
    approvedQuantity: quantityCommand.approvedVersion,
    materialRequirements: materialResult,
    prices: buildPhase7Prices(),
    productivityRates: buildPhase7ProductivityRates(),
    policy: buildPhase7EstimatePolicy(),
    createdAt: phase7FixtureTimes.estimateCreated,
    createdBy: "A0",
  });
  const estimateCommand = approveEstimate({
    commandId: "approve-estimate-command-phase7",
    idempotencyKey: "approve-estimate-phase7",
    estimateVersionId: "estimate-version-phase7",
    draft: estimateResult.draft,
    decision: buildPhase7Decision("ESTIMATE_APPROVAL"),
  });
  const scheduleResult = generateScheduleDraft({
    request: buildPhase7ScheduleRequest({
      approvedQuantity: quantityCommand.approvedVersion,
      approvedEstimate: estimateCommand.approvedVersion,
    }),
    approvedQuantity: quantityCommand.approvedVersion,
    approvedEstimate: estimateCommand.approvedVersion,
  });
  if (scheduleResult.draft === null) {
    throw new Error("Golden schedule draft was not generated");
  }
  const approvedSchedule = approveSchedule({
    draft: scheduleResult.draft,
    decision: buildPhase7Decision("SCHEDULE_APPROVAL"),
  });
  const baselineDraft = composeBaselineDraft({
    draftId: "baseline-draft-phase7",
    approvedQuantity: quantityCommand.approvedVersion,
    approvedEstimate: estimateCommand.approvedVersion,
    approvedSchedule,
    createdAt: phase7FixtureTimes.baselineCreated,
    createdBy: "A0",
  });
  const baselineCommand = approveBaseline({
    commandId: "approve-baseline-command-phase7",
    idempotencyKey: "approve-baseline-phase7",
    baselineVersionId: "baseline-version-phase7",
    draft: baselineDraft,
    decision: buildPhase7Decision("BASELINE_APPROVAL"),
  });
  return {
    quantityResult,
    quantityEngineerReview,
    quantityCommand,
    materialResult,
    estimateResult,
    estimateCommand,
    scheduleResult,
    approvedSchedule,
    baselineDraft,
    baselineCommand,
  };
}
