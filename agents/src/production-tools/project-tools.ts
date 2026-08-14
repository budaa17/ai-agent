import {
  centsToMoney,
  moneyToCents,
  quantityTimesUnitCostCents,
  calculateScheduleForecast,
} from "../production-analysis/index.js";
import {
  getProgressHistoryInputSchema,
  getProgressHistoryOutputSchema,
  getProjectSummaryInputSchema,
  getProjectSummaryOutputSchema,
  getWorkItemsInputSchema,
  getWorkItemsOutputSchema,
  type AuthorizationContext,
  type GetProgressHistoryInput,
  type GetProjectSummaryInput,
  type GetWorkItemsInput,
} from "./contracts.js";
import { buildToolMeta, latestProgressMap, resolveAuthorizedSnapshot, round } from "./helpers.js";
import type { ProductionReadRepository } from "./repository.js";
import { requireProductionPermission } from "./context.js";

export async function getProjectSummaryCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: GetProjectSummaryInput,
) {
  const startedAt = performance.now();
  const params = getProjectSummaryInputSchema.parse(input);
  const resolved = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  requireProductionPermission(resolved.context, "COST_READ");
  const { snapshot } = resolved;
  const latest = latestProgressMap(snapshot);
  const byStatus = {
    PLANNED: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };
  let totalProgress = 0;
  let criticalWorkItemCount = 0;

  for (const workItem of snapshot.workItems) {
    byStatus[workItem.status] += 1;
    totalProgress +=
      latest.get(workItem.workItemId)?.progressPercent ??
      (workItem.status === "COMPLETED" ? 100 : 0);
    criticalWorkItemCount += workItem.isCritical ? 1 : 0;
  }

  const plannedBudget = snapshot.workItems.reduce(
    (sum, workItem) =>
      sum + quantityTimesUnitCostCents(workItem.plannedQuantity, workItem.unitCostMnt),
    0n,
  );
  const actualCost = snapshot.costEntries.reduce(
    (sum, entry) => sum + moneyToCents(entry.amountMnt),
    0n,
  );
  const forecast = calculateScheduleForecast(snapshot);
  const sourceIds = [
    snapshot.activeBaseline.baselineVersionId,
    ...snapshot.workItems.map((workItem) => workItem.workItemId),
    ...[...latest.values()].map((entry) => entry.progressEntryId),
    ...snapshot.costEntries.map((entry) => entry.costEntryId),
    ...snapshot.alerts.map((alert) => alert.alertId),
  ];

  return getProjectSummaryOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "getProjectSummary",
      snapshot,
      rowCount: 1,
      returnedRowCount: 1,
      startedAt,
      sourceIds,
    }),
    summary: {
      projectCode: snapshot.projectCode,
      projectName: snapshot.projectName,
      projectStatus: snapshot.projectStatus,
      baselineVersion: snapshot.activeBaseline.version,
      plannedStart: snapshot.activeBaseline.plannedStart,
      plannedEnd: snapshot.activeBaseline.plannedEnd,
      workItemCount: snapshot.workItems.length,
      criticalWorkItemCount,
      byStatus,
      averageProgressPercent:
        snapshot.workItems.length === 0 ? 0 : round(totalProgress / snapshot.workItems.length),
      plannedBudgetMnt: centsToMoney(plannedBudget),
      actualCostMnt: centsToMoney(actualCost),
      openAlertCount: snapshot.alerts.filter((alert) => alert.status !== "CLOSED").length,
      projectedEndDate: forecast.projectedEndDate,
      projectedDelayWorkingDays: forecast.delayWorkingDays,
      forecastConfidence: forecast.confidence,
    },
  });
}

export async function getProductionWorkItemsCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: GetWorkItemsInput,
) {
  const startedAt = performance.now();
  const params = getWorkItemsInputSchema.parse(input);
  const { snapshot } = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  const latest = latestProgressMap(snapshot);
  const filtered = snapshot.workItems
    .filter(
      (workItem) =>
        (params.statuses === undefined || params.statuses.includes(workItem.status)) &&
        (params.priorities === undefined || params.priorities.includes(workItem.priority)) &&
        (params.includeCompleted || !["COMPLETED", "CANCELLED"].includes(workItem.status)) &&
        (params.stage === undefined ||
          workItem.stage?.toLocaleLowerCase().includes(params.stage.toLocaleLowerCase()) === true),
    )
    .sort(
      (left, right) =>
        left.displayOrder - right.displayOrder || left.code.localeCompare(right.code),
    );
  const sample = filtered.slice(0, params.limit);
  const byStatus = {
    PLANNED: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };
  let totalProgress = 0;
  let criticalCount = 0;

  for (const workItem of filtered) {
    byStatus[workItem.status] += 1;
    totalProgress +=
      latest.get(workItem.workItemId)?.progressPercent ??
      (workItem.status === "COMPLETED" ? 100 : 0);
    criticalCount += workItem.isCritical ? 1 : 0;
  }

  return getWorkItemsOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "getWorkItems",
      snapshot,
      rowCount: filtered.length,
      returnedRowCount: sample.length,
      startedAt,
      sourceIds: filtered.flatMap((workItem) => {
        const progress = latest.get(workItem.workItemId);
        return progress === undefined
          ? [workItem.workItemId]
          : [workItem.workItemId, progress.progressEntryId];
      }),
    }),
    summary: {
      byStatus,
      averageProgressPercent: filtered.length === 0 ? 0 : round(totalProgress / filtered.length),
      criticalCount,
    },
    items: sample.map((workItem) => ({
      workItemId: workItem.workItemId,
      parentWorkItemId: workItem.parentWorkItemId,
      code: workItem.code,
      name: workItem.name,
      stage: workItem.stage,
      location: workItem.location,
      status: workItem.status,
      priority: workItem.priority,
      plannedStart: workItem.plannedStart,
      plannedEnd: workItem.plannedEnd,
      progressPercent:
        latest.get(workItem.workItemId)?.progressPercent ??
        (workItem.status === "COMPLETED" ? 100 : 0),
      plannedQuantity: workItem.plannedQuantity,
      unit: workItem.unit,
      plannedCostMnt: centsToMoney(
        quantityTimesUnitCostCents(workItem.plannedQuantity, workItem.unitCostMnt),
      ),
      isCritical: workItem.isCritical,
      subcontractorId: workItem.subcontractorId,
    })),
  });
}

export async function getProductionProgressHistoryCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: GetProgressHistoryInput,
) {
  const startedAt = performance.now();
  const params = getProgressHistoryInputSchema.parse(input);
  const { snapshot } = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  const allowedWorkItems = params.workItemIds === undefined ? null : new Set(params.workItemIds);
  const filtered = snapshot.progressEntries
    .filter((entry) => {
      const date = entry.capturedAt.slice(0, 10);
      return (
        (allowedWorkItems === null || allowedWorkItems.has(entry.workItemId)) &&
        (params.dateFrom === undefined || date >= params.dateFrom) &&
        (params.dateTo === undefined || date <= params.dateTo)
      );
    })
    .sort(
      (left, right) =>
        Date.parse(right.capturedAt) - Date.parse(left.capturedAt) ||
        left.progressEntryId.localeCompare(right.progressEntryId),
    );
  const sample = filtered.slice(0, params.limit);
  const latestPerWorkItem = new Map<string, (typeof filtered)[number]>();

  for (const entry of filtered) {
    if (!latestPerWorkItem.has(entry.workItemId)) {
      latestPerWorkItem.set(entry.workItemId, entry);
    }
  }

  const chronological = [...filtered].sort(
    (left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt),
  );
  const latestValues = [...latestPerWorkItem.values()];

  return getProgressHistoryOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "getProgressHistory",
      snapshot,
      rowCount: filtered.length,
      returnedRowCount: sample.length,
      startedAt,
      sourceIds: filtered.map((entry) => entry.progressEntryId),
    }),
    summary: {
      workItemCount: latestPerWorkItem.size,
      firstCapturedAt: chronological[0]?.capturedAt ?? null,
      latestCapturedAt: chronological.at(-1)?.capturedAt ?? null,
      averageProgressPercent:
        latestValues.length === 0
          ? 0
          : round(
              latestValues.reduce((sum, entry) => sum + entry.progressPercent, 0) /
                latestValues.length,
            ),
    },
    items: sample.map((entry) => ({
      progressEntryId: entry.progressEntryId,
      dailyReportId: entry.dailyReportId,
      workItemId: entry.workItemId,
      capturedAt: entry.capturedAt,
      quantityDoneIncrement: entry.quantityDoneIncrement,
      cumulativeQuantityDone: entry.cumulativeQuantityDone,
      progressPercent: entry.progressPercent,
      status: entry.status,
      blockerPresent: entry.blockerReason !== null,
      humanEdited: entry.humanEdited,
    })),
  });
}
