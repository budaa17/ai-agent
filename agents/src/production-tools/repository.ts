import {
  projectAnalysisSnapshotV1Schema,
  type ProjectAnalysisSnapshotV1,
} from "../contracts/project-analysis-snapshot.js";
import { compareIsoDates } from "../production-analysis/calendar.js";
import type { AuthorizationContext } from "./contracts.js";

export interface ProductionReadRepository {
  findProjectSnapshot(
    context: AuthorizationContext,
    projectId: string,
    asOf?: string,
  ): Promise<ProjectAnalysisSnapshotV1 | null>;
}

function updateStatuses(
  snapshot: ProjectAnalysisSnapshotV1,
): ProjectAnalysisSnapshotV1["workItems"] {
  const latestByWorkItem = new Map<string, ProjectAnalysisSnapshotV1["progressEntries"][number]>();

  for (const entry of snapshot.progressEntries) {
    const current = latestByWorkItem.get(entry.workItemId);

    if (current === undefined || Date.parse(entry.capturedAt) > Date.parse(current.capturedAt)) {
      latestByWorkItem.set(entry.workItemId, entry);
    }
  }

  const childrenByParent = new Map<string, ProjectAnalysisSnapshotV1["workItems"]>();

  for (const workItem of snapshot.workItems) {
    if (workItem.parentWorkItemId === null) {
      continue;
    }

    const children = childrenByParent.get(workItem.parentWorkItemId) ?? [];
    children.push(workItem);
    childrenByParent.set(workItem.parentWorkItemId, children);
  }

  const leafStatus = new Map<string, ProjectAnalysisSnapshotV1["workItems"][number]["status"]>();

  for (const workItem of snapshot.workItems) {
    if (childrenByParent.has(workItem.workItemId)) {
      continue;
    }

    const latest = latestByWorkItem.get(workItem.workItemId);
    leafStatus.set(
      workItem.workItemId,
      latest === undefined
        ? "PLANNED"
        : latest.progressPercent >= 100
          ? "COMPLETED"
          : latest.status === "BLOCKED"
            ? "IN_PROGRESS"
            : latest.status,
    );
  }

  return snapshot.workItems.map((workItem) => {
    const children = childrenByParent.get(workItem.workItemId);

    if (children === undefined) {
      return {
        ...workItem,
        status: leafStatus.get(workItem.workItemId) ?? "PLANNED",
      };
    }

    const statuses = children.map((child) => leafStatus.get(child.workItemId) ?? "PLANNED");
    return {
      ...workItem,
      status: statuses.every((status) => status === "COMPLETED")
        ? "COMPLETED"
        : statuses.some((status) => status !== "PLANNED")
          ? "IN_PROGRESS"
          : "PLANNED",
    };
  });
}

export function sliceSnapshotAsOf(
  input: ProjectAnalysisSnapshotV1,
  asOf: string,
): ProjectAnalysisSnapshotV1 {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(input);

  if (Date.parse(asOf) > Date.parse(snapshot.asOf)) {
    throw new Error(`Requested as-of ${asOf} is newer than snapshot ${snapshot.asOf}`);
  }

  if (asOf === snapshot.asOf) {
    return snapshot;
  }

  const asOfDate = asOf.slice(0, 10);
  const dailyReports = snapshot.dailyReports.filter(
    (report) =>
      compareIsoDates(report.date, asOfDate) <= 0 &&
      (report.submittedAt === null || Date.parse(report.submittedAt) <= Date.parse(asOf)),
  );
  const reportIds = new Set(dailyReports.map((report) => report.dailyReportId));
  const progressEntries = snapshot.progressEntries.filter(
    (entry) =>
      reportIds.has(entry.dailyReportId) && Date.parse(entry.capturedAt) <= Date.parse(asOf),
  );
  const sliced: ProjectAnalysisSnapshotV1 = {
    ...snapshot,
    snapshotId: `${snapshot.snapshotId}-as-of-${asOf.replaceAll(/[^0-9A-Za-z_.-]/g, "-")}`,
    asOf,
    dailyReports,
    progressEntries,
    attendanceEntries: snapshot.attendanceEntries.filter((entry) =>
      reportIds.has(entry.dailyReportId),
    ),
    stockMovements: snapshot.stockMovements.filter(
      (movement) => Date.parse(movement.occurredAt) <= Date.parse(asOf),
    ),
    costEntries: snapshot.costEntries.filter(
      (entry) =>
        Date.parse(entry.occurredAt) <= Date.parse(asOf) &&
        (entry.dailyReportId === null || reportIds.has(entry.dailyReportId)),
    ),
    blockers: snapshot.blockers.filter(
      (blocker) =>
        reportIds.has(blocker.dailyReportId) && Date.parse(blocker.openedAt) <= Date.parse(asOf),
    ),
    alerts: snapshot.alerts.filter((alert) => Date.parse(alert.createdAt) <= Date.parse(asOf)),
    forecasts: snapshot.forecasts.filter(
      (forecast) => Date.parse(forecast.calculatedAt) <= Date.parse(asOf),
    ),
    recommendationDecisions: snapshot.recommendationDecisions.filter(
      (recommendation) => Date.parse(recommendation.generatedAt) <= Date.parse(asOf),
    ),
  };
  sliced.workItems = updateStatuses(sliced);

  return projectAnalysisSnapshotV1Schema.parse(sliced);
}

export class InMemoryProductionReadRepository implements ProductionReadRepository {
  readonly #snapshots: ProjectAnalysisSnapshotV1[];

  constructor(snapshots: readonly ProjectAnalysisSnapshotV1[]) {
    this.#snapshots = snapshots.map((snapshot) => projectAnalysisSnapshotV1Schema.parse(snapshot));
  }

  async findProjectSnapshot(
    context: AuthorizationContext,
    projectId: string,
    asOf?: string,
  ): Promise<ProjectAnalysisSnapshotV1 | null> {
    const snapshot = this.#snapshots.find(
      (candidate) => candidate.tenantId === context.tenantId && candidate.projectId === projectId,
    );

    if (snapshot === undefined) {
      return null;
    }

    return asOf === undefined ? snapshot : sliceSnapshotAsOf(snapshot, asOf);
  }
}
