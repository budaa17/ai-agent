import type { OperationalPlanningSnapshotV1 } from "../contracts/index.js";
import {
  a5WorkItemDecisionSchema,
  type A5DailyPlanRequestV1,
  type A5WorkItemDecision,
} from "./contracts.js";
import { calculateDailyTarget } from "./daily-target.js";
import { dedupeSourceRefs } from "./deterministic.js";
import { evaluateWorkItemEligibility } from "./eligibility.js";
import { buildPriorityResult } from "./priority.js";

type WorkItem = OperationalPlanningSnapshotV1["workItems"][number];

export function evaluateWorkItemFeasibility(
  request: A5DailyPlanRequestV1,
  workItem: WorkItem,
): A5WorkItemDecision {
  const eligibility = evaluateWorkItemEligibility(request, workItem);
  const dailyTarget = calculateDailyTarget(request, workItem, eligibility);
  return a5WorkItemDecisionSchema.parse({
    workItemId: workItem.workItemId,
    selected: false,
    eligibility,
    priority: buildPriorityResult(request, workItem),
    dailyTarget,
    diagnosticCodes: [...new Set([...eligibility.reasonCodes, ...dailyTarget.reasonCodes])],
    sourceRefs: dedupeSourceRefs([
      ...workItem.sourceRefs,
      ...eligibility.checks.flatMap((check) => check.sourceRefs),
      ...(dailyTarget.targetQuantity?.sourceRefs ?? []),
    ]),
  });
}
