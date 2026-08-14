import { calculateScheduleForecast } from "../production-analysis/index.js";
import {
  getAlertsInputSchema,
  getAlertsOutputSchema,
  getBlockerHistoryInputSchema,
  getBlockerHistoryOutputSchema,
  getScheduleForecastInputSchema,
  getScheduleForecastOutputSchema,
  type AuthorizationContext,
  type GetAlertsInput,
  type GetBlockerHistoryInput,
  type GetScheduleForecastInput,
} from "./contracts.js";
import { buildToolMeta, resolveAuthorizedSnapshot } from "./helpers.js";
import type { ProductionReadRepository } from "./repository.js";

function calendarDayDifference(start: string, end: string): number {
  return Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 86_400_000));
}

export async function getBlockerHistoryCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: GetBlockerHistoryInput,
) {
  const startedAt = performance.now();
  const params = getBlockerHistoryInputSchema.parse(input);
  const { snapshot } = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  const supplierNeedle = params.supplierName?.toLocaleLowerCase();
  const filtered = snapshot.blockers
    .filter(
      (blocker) =>
        (params.workItemIds === undefined || params.workItemIds.includes(blocker.workItemId)) &&
        (params.categories === undefined || params.categories.includes(blocker.category)) &&
        (!params.unresolvedOnly || blocker.resolvedAt === null) &&
        (supplierNeedle === undefined ||
          blocker.supplierName?.toLocaleLowerCase().includes(supplierNeedle) === true),
    )
    .sort(
      (left, right) =>
        Date.parse(right.openedAt) - Date.parse(left.openedAt) ||
        left.blockerId.localeCompare(right.blockerId),
    );
  const sample = filtered.slice(0, params.limit);
  const supplierCounts = new Map<string, number>();

  for (const blocker of filtered) {
    if (blocker.supplierName !== null) {
      supplierCounts.set(blocker.supplierName, (supplierCounts.get(blocker.supplierName) ?? 0) + 1);
    }
  }

  return getBlockerHistoryOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "getBlockerHistory",
      snapshot,
      rowCount: filtered.length,
      returnedRowCount: sample.length,
      startedAt,
      sourceIds: filtered.map((blocker) => blocker.blockerId),
    }),
    summary: {
      openCount: filtered.filter((blocker) => blocker.resolvedAt === null).length,
      resolvedCount: filtered.filter((blocker) => blocker.resolvedAt !== null).length,
      repeatedSupplierCount: [...supplierCounts.values()].filter((count) => count >= 3).length,
    },
    items: sample.map((blocker) => ({
      blockerId: blocker.blockerId,
      dailyReportId: blocker.dailyReportId,
      workItemId: blocker.workItemId,
      category: blocker.category,
      description: blocker.description,
      responsibleParty: blocker.responsibleParty,
      supplierName: blocker.supplierName,
      openedAt: blocker.openedAt,
      resolvedAt: blocker.resolvedAt,
      openDurationDays: calendarDayDifference(
        blocker.openedAt,
        blocker.resolvedAt ?? snapshot.asOf,
      ),
    })),
  });
}

export async function getAlertsCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: GetAlertsInput,
) {
  const startedAt = performance.now();
  const params = getAlertsInputSchema.parse(input);
  const { snapshot } = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  const filtered = snapshot.alerts
    .filter(
      (alert) =>
        (params.severities === undefined || params.severities.includes(alert.severity)) &&
        (params.statuses === undefined || params.statuses.includes(alert.status)) &&
        (params.ruleIds === undefined || params.ruleIds.includes(alert.ruleId)),
    )
    .sort(
      (left, right) =>
        ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(left.severity) -
          ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(right.severity) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
  const sample = filtered.slice(0, params.limit);
  const bySeverity = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };

  for (const alert of filtered) {
    bySeverity[alert.severity] += 1;
  }

  return getAlertsOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "getAlerts",
      snapshot,
      rowCount: filtered.length,
      returnedRowCount: sample.length,
      startedAt,
      sourceIds: filtered.map((alert) => alert.alertId),
    }),
    summary: {
      bySeverity,
      openCount: filtered.filter((alert) => alert.status !== "CLOSED").length,
    },
    items: sample.map((alert) => ({
      alertId: alert.alertId,
      ruleId: alert.ruleId,
      workItemId: alert.workItemId,
      materialId: alert.materialId,
      severity: alert.severity,
      status: alert.status,
      title: alert.title,
      actual: alert.explanation.actual,
      threshold: alert.explanation.threshold,
      delta: alert.explanation.delta,
      rootCauseGroupId: alert.rootCauseGroupId,
      createdAt: alert.createdAt,
    })),
  });
}

export async function getScheduleForecastCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: GetScheduleForecastInput,
) {
  const startedAt = performance.now();
  const params = getScheduleForecastInputSchema.parse(input);
  const { snapshot } = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  const forecast = calculateScheduleForecast(snapshot);
  const filtered = forecast.workItems.filter(
    (item) => params.includeCompleted || item.currentProgressPercent < 100,
  );
  const sample = filtered.slice(0, params.limit);
  const sourceIds = filtered.flatMap((item) =>
    item.sourceProgressEntryIds.length === 0 ? [item.workItemId] : item.sourceProgressEntryIds,
  );

  return getScheduleForecastOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "getScheduleForecast",
      snapshot,
      rowCount: filtered.length,
      returnedRowCount: sample.length,
      startedAt,
      sourceIds,
    }),
    summary: {
      baselineEndDate: forecast.baselineEndDate,
      projectedEndDate: forecast.projectedEndDate,
      delayWorkingDays: forecast.delayWorkingDays,
      confidence: forecast.confidence,
      criticalWorkItemIds: forecast.criticalPath.criticalWorkItemIds,
      affectedWorkItemCount: forecast.affectedWorkItemIds.length,
    },
    items: sample,
  });
}
