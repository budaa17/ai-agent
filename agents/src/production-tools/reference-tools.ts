import {
  centsToMoney,
  compareIsoDates,
  moneyToCents,
  workingDaysBetween,
} from "../production-analysis/index.js";
import {
  getSubcontractorPerformanceInputSchema,
  getSubcontractorPerformanceOutputSchema,
  searchDailyReportsInputSchema,
  searchDailyReportsOutputSchema,
  type AuthorizationContext,
  type GetSubcontractorPerformanceInput,
  type SearchDailyReportsInput,
} from "./contracts.js";
import { requireProductionPermission } from "./context.js";
import { buildToolMeta, latestProgressMap, resolveAuthorizedSnapshot, round } from "./helpers.js";
import type { ProductionReadRepository } from "./repository.js";

function plannedProgress(
  plannedStart: string,
  plannedEnd: string,
  asOfDate: string,
  calendar: {
    workingWeekdays: number[];
    holidays: string[];
  },
): number {
  if (compareIsoDates(asOfDate, plannedStart) < 0) {
    return 0;
  }

  if (compareIsoDates(asOfDate, plannedEnd) >= 0) {
    return 100;
  }

  const duration = workingDaysBetween(plannedStart, plannedEnd, calendar, true);
  const elapsed = workingDaysBetween(plannedStart, asOfDate, calendar, true);
  return Math.min(100, (elapsed / duration) * 100);
}

export async function getSubcontractorPerformanceCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: GetSubcontractorPerformanceInput,
) {
  const startedAt = performance.now();
  const params = getSubcontractorPerformanceInputSchema.parse(input);
  const resolved = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  requireProductionPermission(resolved.context, "COST_READ");
  const { snapshot } = resolved;
  const latest = latestProgressMap(snapshot);
  const selected = snapshot.subcontractors.filter(
    (subcontractor) =>
      params.subcontractorIds === undefined ||
      params.subcontractorIds.includes(subcontractor.subcontractorId),
  );
  const asOfDate = snapshot.asOf.slice(0, 10);
  const rows = selected
    .map((subcontractor) => {
      const workItems = snapshot.workItems.filter(
        (workItem) => workItem.subcontractorId === subcontractor.subcontractorId,
      );
      const workItemIds = new Set(workItems.map((workItem) => workItem.workItemId));
      const planned =
        workItems.length === 0
          ? 0
          : workItems.reduce(
              (sum, workItem) =>
                sum +
                plannedProgress(
                  workItem.plannedStart,
                  workItem.plannedEnd,
                  asOfDate,
                  snapshot.activeBaseline.calendar,
                ),
              0,
            ) / workItems.length;
      const actual =
        workItems.length === 0
          ? 0
          : workItems.reduce(
              (sum, workItem) =>
                sum +
                (latest.get(workItem.workItemId)?.progressPercent ??
                  (workItem.status === "COMPLETED" ? 100 : 0)),
              0,
            ) / workItems.length;
      const deviation = planned - actual;
      const maximumWorkItemDeviation = workItems.reduce((maximum, workItem) => {
        const itemPlanned = plannedProgress(
          workItem.plannedStart,
          workItem.plannedEnd,
          asOfDate,
          snapshot.activeBaseline.calendar,
        );
        const itemActual =
          latest.get(workItem.workItemId)?.progressPercent ??
          (workItem.status === "COMPLETED" ? 100 : 0);
        return Math.max(maximum, itemPlanned - itemActual);
      }, 0);
      const attendance = snapshot.attendanceEntries.filter(
        (entry) => entry.subcontractorId === subcontractor.subcontractorId,
      );
      const costs = snapshot.costEntries.filter(
        (entry) => entry.workItemId !== null && workItemIds.has(entry.workItemId),
      );
      const blockers = snapshot.blockers.filter(
        (blocker) => workItemIds.has(blocker.workItemId) && blocker.resolvedAt === null,
      );
      const performanceStatus =
        maximumWorkItemDeviation <= 10
          ? "ON_TRACK"
          : maximumWorkItemDeviation <= 20
            ? "WATCH"
            : "DELAYED";

      return {
        subcontractorId: subcontractor.subcontractorId,
        code: subcontractor.code,
        name: subcontractor.name,
        assignedWorkItemCount: workItems.length,
        completedWorkItemCount: workItems.filter((workItem) => workItem.status === "COMPLETED")
          .length,
        plannedProgressPercent: round(planned),
        actualProgressPercent: round(actual),
        scheduleDeviationPercentagePoints: round(deviation),
        attendanceHours: round(attendance.reduce((sum, entry) => sum + entry.totalHours, 0)),
        actualCostMnt: centsToMoney(
          costs.reduce((sum, entry) => sum + moneyToCents(entry.amountMnt), 0n),
        ),
        openBlockerCount: blockers.length,
        performanceStatus,
        sourceIds: [
          subcontractor.subcontractorId,
          ...workItems.map((workItem) => workItem.workItemId),
          ...attendance.map((entry) => entry.attendanceEntryId),
          ...costs.map((entry) => entry.costEntryId),
          ...blockers.map((blocker) => blocker.blockerId),
        ],
      } as const;
    })
    .sort(
      (left, right) =>
        ["DELAYED", "WATCH", "ON_TRACK"].indexOf(left.performanceStatus) -
          ["DELAYED", "WATCH", "ON_TRACK"].indexOf(right.performanceStatus) ||
        left.code.localeCompare(right.code),
    );
  const sample = rows.slice(0, params.limit);

  return getSubcontractorPerformanceOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "getSubcontractorPerformance",
      snapshot,
      rowCount: rows.length,
      returnedRowCount: sample.length,
      startedAt,
      sourceIds: rows.flatMap((row) => row.sourceIds),
    }),
    summary: {
      onTrackCount: rows.filter((row) => row.performanceStatus === "ON_TRACK").length,
      watchCount: rows.filter((row) => row.performanceStatus === "WATCH").length,
      delayedCount: rows.filter((row) => row.performanceStatus === "DELAYED").length,
    },
    items: sample.map(({ sourceIds: _sourceIds, ...row }) => row),
  });
}

function reportExcerpt(text: string, terms: readonly string[]): string {
  const lower = text.toLocaleLowerCase();
  const positions = terms.map((term) => lower.indexOf(term)).filter((position) => position >= 0);
  const first = positions.length === 0 ? 0 : Math.min(...positions);
  const start = Math.max(0, first - 80);
  const excerpt = text.slice(start, start + 500);
  return `${start > 0 ? "…" : ""}${excerpt}${start + 500 < text.length ? "…" : ""}`;
}

export async function searchDailyReportsCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: SearchDailyReportsInput,
) {
  const startedAt = performance.now();
  const params = searchDailyReportsInputSchema.parse(input);
  const resolved = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  requireProductionPermission(resolved.context, "REPORT_TEXT_READ");
  const { snapshot } = resolved;
  const terms = [
    ...new Set(
      params.query
        .toLocaleLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  ].slice(0, 20);
  const matches = snapshot.dailyReports
    .filter(
      (report) =>
        report.rawText !== null &&
        (params.dateFrom === undefined || report.date >= params.dateFrom) &&
        (params.dateTo === undefined || report.date <= params.dateTo),
    )
    .map((report) => {
      const lower = report.rawText!.toLocaleLowerCase();
      const matchedTerms = terms.filter((term) => lower.includes(term));
      return {
        report,
        matchedTerms,
      };
    })
    .filter((match) => match.matchedTerms.length > 0)
    .sort(
      (left, right) =>
        right.matchedTerms.length - left.matchedTerms.length ||
        right.report.date.localeCompare(left.report.date),
    );
  const sample = matches.slice(0, params.limit);

  return searchDailyReportsOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "searchDailyReports",
      snapshot,
      rowCount: matches.length,
      returnedRowCount: sample.length,
      startedAt,
      sourceIds: matches.map((match) => match.report.dailyReportId),
    }),
    summary: {
      query: params.query,
      matchedReportCount: matches.length,
    },
    items: sample.map(({ report, matchedTerms }) => ({
      dailyReportId: report.dailyReportId,
      date: report.date,
      status: report.status,
      excerpt: reportExcerpt(report.rawText!, terms),
      matchedTerms,
    })),
  });
}
