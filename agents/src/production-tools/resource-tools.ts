import { addWorkingDays } from "../production-analysis/index.js";
import {
  getAttendanceStatsInputSchema,
  getAttendanceStatsOutputSchema,
  getConsumptionVsNormInputSchema,
  getConsumptionVsNormOutputSchema,
  getStockStatusInputSchema,
  getStockStatusOutputSchema,
  type AuthorizationContext,
  type GetAttendanceStatsInput,
  type GetConsumptionVsNormInput,
  type GetStockStatusInput,
} from "./contracts.js";
import {
  buildToolMeta,
  decimalString,
  latestProgressMap,
  resolveAuthorizedSnapshot,
  round,
} from "./helpers.js";
import type { ProductionReadRepository } from "./repository.js";

function stockDelta(
  kind: "RECEIPT" | "ISSUE" | "REVERSAL" | "ADJUSTMENT",
  quantity: number,
): number {
  if (kind === "RECEIPT") {
    return quantity;
  }

  if (kind === "ISSUE") {
    return -quantity;
  }

  return quantity;
}

export async function getStockStatusCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: GetStockStatusInput,
) {
  const startedAt = performance.now();
  const params = getStockStatusInputSchema.parse(input);
  const { snapshot } = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  const selected =
    params.materialIds === undefined
      ? snapshot.materials
      : snapshot.materials.filter((material) => params.materialIds!.includes(material.materialId));
  const recentStart = addWorkingDays(
    snapshot.asOf.slice(0, 10),
    -(params.coverageWindowDays - 1),
    snapshot.activeBaseline.calendar,
  );
  const rows = selected
    .map((material) => {
      const movements = snapshot.stockMovements.filter(
        (movement) => movement.materialId === material.materialId,
      );
      const balance = movements.reduce(
        (sum, movement) => sum + stockDelta(movement.kind, Number(movement.quantity)),
        0,
      );
      const recentIssues = movements.filter(
        (movement) => movement.kind === "ISSUE" && movement.occurredAt.slice(0, 10) >= recentStart,
      );
      const recentConsumption = recentIssues.reduce(
        (sum, movement) => sum + Number(movement.quantity),
        0,
      );
      const averageDailyConsumption = recentConsumption / params.coverageWindowDays;
      const coverage =
        averageDailyConsumption > 0 ? Math.max(0, balance / averageDailyConsumption) : null;
      const status =
        coverage === null || coverage >= 14 ? "HEALTHY" : coverage < 7 ? "CRITICAL" : "WATCH";

      return {
        materialId: material.materialId,
        code: material.code,
        name: material.name,
        unit: material.unit,
        balance: decimalString(balance),
        recentConsumption: decimalString(recentConsumption),
        averageDailyConsumption: decimalString(averageDailyConsumption),
        coverageWorkingDays: coverage === null ? null : round(coverage),
        status,
        sourceIds: movements.map((movement) => movement.stockMovementId),
      } as const;
    })
    .sort(
      (left, right) =>
        ["CRITICAL", "WATCH", "HEALTHY"].indexOf(left.status) -
          ["CRITICAL", "WATCH", "HEALTHY"].indexOf(right.status) ||
        left.code.localeCompare(right.code),
    );
  const sample = rows.slice(0, params.limit);

  return getStockStatusOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "getStockStatus",
      snapshot,
      rowCount: rows.length,
      returnedRowCount: sample.length,
      startedAt,
      sourceIds: rows.flatMap((row) => row.sourceIds),
    }),
    summary: {
      criticalCount: rows.filter((row) => row.status === "CRITICAL").length,
      watchCount: rows.filter((row) => row.status === "WATCH").length,
      healthyCount: rows.filter((row) => row.status === "HEALTHY").length,
    },
    items: sample.map(({ sourceIds: _sourceIds, ...row }) => row),
  });
}

export async function getConsumptionVsNormCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: GetConsumptionVsNormInput,
) {
  const startedAt = performance.now();
  const params = getConsumptionVsNormInputSchema.parse(input);
  const { snapshot } = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  const latest = latestProgressMap(snapshot);
  const norms = snapshot.materialNorms.filter(
    (norm) =>
      (params.workItemIds === undefined || params.workItemIds.includes(norm.workItemId)) &&
      (params.materialIds === undefined || params.materialIds.includes(norm.materialId)),
  );
  const rows = norms
    .map((norm) => {
      const progress = latest.get(norm.workItemId);
      const cumulative = progress === undefined ? 0 : Number(progress.cumulativeQuantityDone);
      const expected =
        cumulative * Number(norm.quantityPerWorkUnit) * (1 + norm.wastePercent / 100);
      const movements = snapshot.stockMovements.filter(
        (movement) =>
          movement.kind === "ISSUE" &&
          movement.workItemId === norm.workItemId &&
          movement.materialId === norm.materialId,
      );
      const actual = movements.reduce((sum, movement) => sum + Number(movement.quantity), 0);
      const ratio = expected > 0 ? (actual / expected) * 100 : null;
      const status =
        expected <= 0 || movements.length === 0
          ? "NO_DATA"
          : ratio! > 110
            ? "OVER_NORM"
            : "WITHIN_NORM";

      return {
        materialNormId: norm.materialNormId,
        workItemId: norm.workItemId,
        materialId: norm.materialId,
        cumulativeWorkQuantity: decimalString(cumulative),
        expectedConsumption: decimalString(expected),
        actualConsumption: decimalString(actual),
        variance: decimalString(actual - expected),
        consumptionRatioPercent: ratio === null ? null : round(ratio),
        status,
        sourceIds: [
          norm.workItemId,
          ...(progress === undefined ? [] : [progress.progressEntryId]),
          ...movements.map((movement) => movement.stockMovementId),
        ],
      } as const;
    })
    .sort(
      (left, right) =>
        ["OVER_NORM", "WITHIN_NORM", "NO_DATA"].indexOf(left.status) -
          ["OVER_NORM", "WITHIN_NORM", "NO_DATA"].indexOf(right.status) ||
        left.workItemId.localeCompare(right.workItemId),
    );
  const sample = rows.slice(0, params.limit);

  return getConsumptionVsNormOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "getConsumptionVsNorm",
      snapshot,
      rowCount: rows.length,
      returnedRowCount: sample.length,
      startedAt,
      sourceIds: rows.flatMap((row) => row.sourceIds),
    }),
    summary: {
      overNormCount: rows.filter((row) => row.status === "OVER_NORM").length,
      withinNormCount: rows.filter((row) => row.status === "WITHIN_NORM").length,
      noDataCount: rows.filter((row) => row.status === "NO_DATA").length,
    },
    items: sample.map(({ sourceIds: _sourceIds, ...row }) => row),
  });
}

export async function getAttendanceStatsCore(
  repository: ProductionReadRepository,
  context: AuthorizationContext,
  input: GetAttendanceStatsInput,
) {
  const startedAt = performance.now();
  const params = getAttendanceStatsInputSchema.parse(input);
  const { snapshot } = await resolveAuthorizedSnapshot(
    repository,
    context,
    params.projectId,
    params.asOf,
  );
  const reportDateById = new Map(
    snapshot.dailyReports.map((report) => [report.dailyReportId, report.date]),
  );
  const entries = snapshot.attendanceEntries.filter((entry) => {
    const date = reportDateById.get(entry.dailyReportId);
    return (
      date !== undefined &&
      (params.workItemIds === undefined ||
        (entry.workItemId !== null && params.workItemIds.includes(entry.workItemId))) &&
      (params.subcontractorIds === undefined ||
        (entry.subcontractorId !== null &&
          params.subcontractorIds.includes(entry.subcontractorId))) &&
      (params.dateFrom === undefined || date >= params.dateFrom) &&
      (params.dateTo === undefined || date <= params.dateTo)
    );
  });
  const groups = new Map<
    string,
    {
      workItemId: string | null;
      subcontractorId: string | null;
      teamName: string;
      reportIds: Set<string>;
      personDays: number;
      totalHours: number;
      sourceIds: string[];
    }
  >();

  for (const entry of entries) {
    const groupKey = [
      entry.workItemId ?? "none",
      entry.subcontractorId ?? "own",
      entry.teamName,
    ].join("|");
    const group = groups.get(groupKey) ?? {
      workItemId: entry.workItemId,
      subcontractorId: entry.subcontractorId,
      teamName: entry.teamName,
      reportIds: new Set<string>(),
      personDays: 0,
      totalHours: 0,
      sourceIds: [],
    };
    group.reportIds.add(entry.dailyReportId);
    group.personDays += entry.headcount;
    group.totalHours += entry.totalHours;
    group.sourceIds.push(entry.attendanceEntryId);
    groups.set(groupKey, group);
  }

  const rows = [...groups.entries()]
    .map(([groupKey, group]) => ({
      groupKey,
      workItemId: group.workItemId,
      subcontractorId: group.subcontractorId,
      teamName: group.teamName,
      reportDays: group.reportIds.size,
      personDays: group.personDays,
      totalHours: round(group.totalHours),
      averageHeadcount:
        group.reportIds.size === 0 ? 0 : round(group.personDays / group.reportIds.size),
      sourceIds: group.sourceIds,
    }))
    .sort(
      (left, right) =>
        right.totalHours - left.totalHours || left.groupKey.localeCompare(right.groupKey),
    );
  const sample = rows.slice(0, params.limit);
  const distinctReportDays = new Set(entries.map((entry) => entry.dailyReportId)).size;
  const totalPersonDays = entries.reduce((sum, entry) => sum + entry.headcount, 0);
  const totalHours = entries.reduce((sum, entry) => sum + entry.totalHours, 0);

  return getAttendanceStatsOutputSchema.parse({
    meta: buildToolMeta({
      toolName: "getAttendanceStats",
      snapshot,
      rowCount: rows.length,
      returnedRowCount: sample.length,
      startedAt,
      sourceIds: entries.map((entry) => entry.attendanceEntryId),
    }),
    summary: {
      totalPersonDays,
      totalHours: round(totalHours),
      averageDailyHeadcount:
        distinctReportDays === 0 ? 0 : round(totalPersonDays / distinctReportDays),
    },
    items: sample.map(({ sourceIds: _sourceIds, ...row }) => row),
  });
}
