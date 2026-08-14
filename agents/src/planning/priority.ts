import type { OperationalPlanningSnapshotV1 } from "../contracts/index.js";
import type { A5DailyPlanRequestV1, A5PriorityResult } from "./contracts.js";

type WorkItem = OperationalPlanningSnapshotV1["workItems"][number];

export function buildPriorityResult(
  request: A5DailyPlanRequestV1,
  workItem: WorkItem,
): A5PriorityResult {
  return {
    rank: null,
    tuple: {
      criticalPath: workItem.isCritical ? 0 : 1,
      totalFloatWorkingDays: workItem.totalFloatWorkingDays,
      milestoneDependency: workItem.contractMilestone ? 0 : 1,
      downstreamUnlockCount: workItem.downstreamUnlockCount,
      bookedResourceOrMaterial: request.bookedWorkItemIds.includes(workItem.workItemId) ? 0 : 1,
      baselineSequence: request.operationalSnapshot.workItems.findIndex(
        (candidate) => candidate.workItemId === workItem.workItemId,
      ),
      workItemId: workItem.workItemId,
    },
  };
}

export function compareA5Priority(left: A5PriorityResult, right: A5PriorityResult): number {
  const leftTuple = left.tuple;
  const rightTuple = right.tuple;
  return (
    leftTuple.criticalPath - rightTuple.criticalPath ||
    leftTuple.totalFloatWorkingDays - rightTuple.totalFloatWorkingDays ||
    leftTuple.milestoneDependency - rightTuple.milestoneDependency ||
    rightTuple.downstreamUnlockCount - leftTuple.downstreamUnlockCount ||
    leftTuple.bookedResourceOrMaterial - rightTuple.bookedResourceOrMaterial ||
    leftTuple.baselineSequence - rightTuple.baselineSequence ||
    leftTuple.workItemId.localeCompare(rightTuple.workItemId)
  );
}

export function assignStablePriorityRanks<T extends { priority: A5PriorityResult }>(
  values: readonly T[],
): T[] {
  return [...values]
    .sort((left, right) => compareA5Priority(left.priority, right.priority))
    .map((value, index) => ({
      ...value,
      priority: { ...value.priority, rank: index + 1 },
    }));
}
