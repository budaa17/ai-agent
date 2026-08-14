import type { AgentSourceRefV1 } from "../contracts/deterministic-analysis.js";
import type { ProjectAnalysisSnapshotV1 } from "../contracts/project-analysis-snapshot.js";

type Catalog = AgentSourceRefV1["catalog"];

export function buildSourceCatalog(snapshot: ProjectAnalysisSnapshotV1): AgentSourceRefV1[] {
  const sources = new Map<string, AgentSourceRefV1>();
  const add = (sourceId: string, catalog: Catalog, observedAt: string, fieldPaths: string[]) => {
    sources.set(sourceId, {
      sourceId,
      catalog,
      entityId: sourceId,
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      observedAt,
      fieldPaths,
    });
  };

  add(snapshot.activeBaseline.baselineVersionId, "BASELINE", snapshot.activeBaseline.approvedAt, [
    "activeBaseline.plannedStart",
    "activeBaseline.plannedEnd",
    "activeBaseline.budgetMnt",
    "activeBaseline.calendar",
  ]);

  for (const workItem of snapshot.workItems) {
    add(workItem.workItemId, "WORK_ITEM", snapshot.asOf, [
      "workItems.code",
      "workItems.name",
      "workItems.plannedStart",
      "workItems.plannedEnd",
      "workItems.plannedQuantity",
      "workItems.unitCostMnt",
      "workItems.status",
    ]);
  }

  for (const dependency of snapshot.dependencies) {
    add(dependency.dependencyId, "DEPENDENCY", snapshot.asOf, [
      "dependencies.predecessorWorkItemId",
      "dependencies.successorWorkItemId",
      "dependencies.type",
      "dependencies.lagDays",
    ]);
  }

  for (const subcontractor of snapshot.subcontractors) {
    add(subcontractor.subcontractorId, "SUBCONTRACTOR", snapshot.asOf, [
      "subcontractors.code",
      "subcontractors.name",
      "subcontractors.contractStart",
      "subcontractors.contractEnd",
      "subcontractors.contractValueMnt",
    ]);
  }

  for (const report of snapshot.dailyReports) {
    add(
      report.dailyReportId,
      "DAILY_REPORT",
      report.approvedAt ?? report.submittedAt ?? snapshot.asOf,
      ["dailyReports.date", "dailyReports.status", "dailyReports.rawText"],
    );
  }

  for (const progress of snapshot.progressEntries) {
    add(progress.progressEntryId, "PROGRESS", progress.capturedAt, [
      "progressEntries.quantityDoneIncrement",
      "progressEntries.cumulativeQuantityDone",
      "progressEntries.progressPercent",
      "progressEntries.status",
    ]);
  }

  for (const attendance of snapshot.attendanceEntries) {
    const report = snapshot.dailyReports.find(
      (candidate) => candidate.dailyReportId === attendance.dailyReportId,
    );
    add(
      attendance.attendanceEntryId,
      "ATTENDANCE",
      report?.approvedAt ?? report?.submittedAt ?? snapshot.asOf,
      [
        "attendanceEntries.headcount",
        "attendanceEntries.hoursPerPerson",
        "attendanceEntries.totalHours",
      ],
    );
  }

  for (const movement of snapshot.stockMovements) {
    add(movement.stockMovementId, "STOCK", movement.occurredAt, [
      "stockMovements.kind",
      "stockMovements.quantity",
      "stockMovements.unitPriceMnt",
      "stockMovements.materialId",
    ]);
  }

  for (const cost of snapshot.costEntries) {
    add(cost.costEntryId, "COST", cost.occurredAt, [
      "costEntries.category",
      "costEntries.amountMnt",
      "costEntries.sourceType",
      "costEntries.sourceId",
    ]);
  }

  for (const blocker of snapshot.blockers) {
    add(blocker.blockerId, "BLOCKER", blocker.openedAt, [
      "blockers.category",
      "blockers.description",
      "blockers.supplierName",
      "blockers.resolvedAt",
    ]);
  }

  for (const alert of snapshot.alerts) {
    add(alert.alertId, "ALERT", alert.createdAt, [
      "alerts.ruleId",
      "alerts.severity",
      "alerts.status",
      "alerts.explanation",
    ]);
  }

  for (const forecast of snapshot.forecasts) {
    add(forecast.forecastId, "FORECAST", forecast.calculatedAt, [
      "forecasts.projectedEndDate",
      "forecasts.delayDays",
      "forecasts.confidence",
    ]);
  }

  for (const recommendation of snapshot.recommendationDecisions) {
    add(recommendation.recommendationId, "RECOMMENDATION", recommendation.generatedAt, [
      "recommendationDecisions.status",
      "recommendationDecisions.action",
      "recommendationDecisions.estimatedImpactDays",
    ]);
  }

  return [...sources.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}
