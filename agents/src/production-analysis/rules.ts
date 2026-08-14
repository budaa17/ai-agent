import {
  deterministicRuleEvaluationV1Schema,
  type DeterministicDeviationV1,
  type DeterministicRuleEvaluationV1,
} from "../contracts/deterministic-analysis.js";
import type { ProjectAnalysisSnapshotV1 } from "../contracts/project-analysis-snapshot.js";
import {
  addWorkingDays,
  compareIsoDates,
  enumerateWorkingDates,
  workingDaysBetween,
} from "./calendar.js";
import { executableDependencies, executableWorkItems } from "./critical-path.js";
import {
  bigintRatioPercent,
  DECIMAL_SCALE,
  decimalToScaledInteger,
  moneyToCents,
  quantityTimesUnitCostCents,
} from "./decimal.js";
import { PRODUCTION_RULE_THRESHOLDS } from "./rule-thresholds.js";
import { DEFAULT_RULE_GRAPHS, evaluateRuleThreshold, type RuleGraphSet } from "./rule-engine.js";

type SnapshotWorkItem = ProjectAnalysisSnapshotV1["workItems"][number];
type SnapshotProgressEntry = ProjectAnalysisSnapshotV1["progressEntries"][number];
type SnapshotStockMovement = ProjectAnalysisSnapshotV1["stockMovements"][number];

export { PRODUCTION_RULE_THRESHOLDS } from "./rule-thresholds.js";

function latestProgressByWorkItem(
  snapshot: ProjectAnalysisSnapshotV1,
): Map<string, SnapshotProgressEntry> {
  const approvedReports = new Set(
    snapshot.dailyReports
      .filter((report) => report.status === "APPROVED")
      .map((report) => report.dailyReportId),
  );
  const latest = new Map<string, SnapshotProgressEntry>();

  for (const entry of snapshot.progressEntries) {
    if (!approvedReports.has(entry.dailyReportId)) {
      continue;
    }

    const current = latest.get(entry.workItemId);

    if (current === undefined || Date.parse(entry.capturedAt) > Date.parse(current.capturedAt)) {
      latest.set(entry.workItemId, entry);
    }
  }

  return latest;
}

function approvedProgressByWorkItem(
  snapshot: ProjectAnalysisSnapshotV1,
): Map<string, SnapshotProgressEntry[]> {
  const approvedReports = new Set(
    snapshot.dailyReports
      .filter((report) => report.status === "APPROVED")
      .map((report) => report.dailyReportId),
  );
  const output = new Map<string, SnapshotProgressEntry[]>();

  for (const entry of snapshot.progressEntries) {
    if (!approvedReports.has(entry.dailyReportId)) {
      continue;
    }

    const entries = output.get(entry.workItemId) ?? [];
    entries.push(entry);
    output.set(entry.workItemId, entries);
  }

  for (const entries of output.values()) {
    entries.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  }

  return output;
}

function evaluation(
  ruleId: DeterministicDeviationV1["ruleId"],
  snapshot: ProjectAnalysisSnapshotV1,
  evaluatedSubjectCount: number,
  deviations: DeterministicDeviationV1[],
): DeterministicRuleEvaluationV1 {
  return deterministicRuleEvaluationV1Schema.parse({
    evaluationId: `evaluation-${ruleId.toLowerCase()}`,
    ruleId,
    ruleVersion: 1,
    evaluatedAt: snapshot.asOf,
    status:
      deviations.length > 0
        ? "MATCHED"
        : evaluatedSubjectCount === 0
          ? "INSUFFICIENT_DATA"
          : "NO_MATCH",
    evaluatedSubjectCount,
    matchedCount: deviations.length,
    deviations,
  });
}

function currentProgress(
  workItem: SnapshotWorkItem,
  latest: ReadonlyMap<string, SnapshotProgressEntry>,
): number {
  return (
    latest.get(workItem.workItemId)?.progressPercent ?? (workItem.status === "COMPLETED" ? 100 : 0)
  );
}

export function evaluateOverdueRule(
  snapshot: ProjectAnalysisSnapshotV1,
  ruleGraphs: RuleGraphSet = DEFAULT_RULE_GRAPHS,
): DeterministicRuleEvaluationV1 {
  const latest = latestProgressByWorkItem(snapshot);
  const asOfDate = snapshot.asOf.slice(0, 10);
  const workItems = executableWorkItems(snapshot);
  const deviations = workItems.flatMap((workItem) => {
    const progress = currentProgress(workItem, latest);

    if (
      progress >= 100 ||
      ["COMPLETED", "CANCELLED"].includes(workItem.status) ||
      compareIsoDates(workItem.plannedEnd, asOfDate) >= 0
    ) {
      return [];
    }

    const delayWorkingDays = workingDaysBetween(
      workItem.plannedEnd,
      asOfDate,
      snapshot.activeBaseline.calendar,
      false,
    );
    const source = latest.get(workItem.workItemId)?.progressEntryId ?? workItem.workItemId;
    const decision = evaluateRuleThreshold(ruleGraphs.OVERDUE_WORK_ITEM, {
      isCritical: workItem.isCritical,
      delayWorkingDays,
    });
    const severity = (decision?.severity ?? "LOW") as DeterministicDeviationV1["severity"];

    return [
      {
        deviationId: `deviation-overdue-${workItem.workItemId}`,
        ruleId: "OVERDUE_WORK_ITEM" as const,
        ruleVersion: 1,
        severity,
        effectiveDate: addWorkingDays(workItem.plannedEnd, 1, snapshot.activeBaseline.calendar),
        tenantId: snapshot.tenantId,
        projectId: snapshot.projectId,
        workItemId: workItem.workItemId,
        materialId: null,
        subcontractorId: workItem.subcontractorId,
        title: `${workItem.code} ажил хугацаа хэтэрсэн`,
        explanation: `${workItem.name} ажил төлөвлөсөн төгсгөлөөс ${delayWorkingDays} ажлын өдөр хоцорч, ${progress}% гүйцэтгэлтэй байна.`,
        actual: {
          asOfDate,
          progressPercent: progress,
          status: workItem.status,
        },
        threshold: {
          plannedEnd: workItem.plannedEnd,
          requiredProgressPercent: 100,
        },
        delta: {
          delayWorkingDays,
          remainingProgressPercentagePoints: 100 - progress,
        },
        sourceIds: [source],
        dedupeKey: `OVERDUE_WORK_ITEM:${workItem.workItemId}`,
        rootCauseGroupId: null,
      },
    ];
  });

  return evaluation("OVERDUE_WORK_ITEM", snapshot, workItems.length, deviations);
}

function expectedMaterialScaled(
  cumulativeQuantity: string,
  quantityPerWorkUnit: string,
  wastePercent: number,
): bigint {
  const base =
    (decimalToScaledInteger(cumulativeQuantity) * decimalToScaledInteger(quantityPerWorkUnit)) /
    DECIMAL_SCALE;
  const wasteScale = 100_000n;
  const waste = BigInt(Math.round(wastePercent * 1_000));
  return (base * (wasteScale + waste)) / wasteScale;
}

export function evaluateMaterialOveruseRule(
  snapshot: ProjectAnalysisSnapshotV1,
  ruleGraphs: RuleGraphSet = DEFAULT_RULE_GRAPHS,
): DeterministicRuleEvaluationV1 {
  const latest = latestProgressByWorkItem(snapshot);
  let evaluatedSubjects = 0;
  const deviations: DeterministicDeviationV1[] = [];

  for (const norm of snapshot.materialNorms) {
    const progress = latest.get(norm.workItemId);

    if (progress === undefined || Number(progress.cumulativeQuantityDone) <= 0) {
      continue;
    }

    const issues = snapshot.stockMovements.filter(
      (movement) =>
        movement.kind === "ISSUE" &&
        movement.workItemId === norm.workItemId &&
        movement.materialId === norm.materialId &&
        Date.parse(movement.occurredAt) <= Date.parse(snapshot.asOf),
    );

    if (issues.length === 0) {
      continue;
    }

    const expected = expectedMaterialScaled(
      progress.cumulativeQuantityDone,
      norm.quantityPerWorkUnit,
      norm.wastePercent,
    );

    if (expected <= 0n) {
      continue;
    }

    evaluatedSubjects += 1;
    const actual = issues.reduce(
      (sum, movement) => sum + decimalToScaledInteger(movement.quantity),
      0n,
    );
    const ratio = Number(actual) / Number(expected);
    const decision = evaluateRuleThreshold(ruleGraphs.MATERIAL_OVERUSE, { ratio });

    if (decision === null) {
      continue;
    }

    const ratioPercent = Math.round(ratio * 10_000) / 100;
    deviations.push({
      deviationId: `deviation-material-overuse-${norm.workItemId}-${norm.materialId}`,
      ruleId: "MATERIAL_OVERUSE",
      ruleVersion: 1,
      severity: decision.severity as DeterministicDeviationV1["severity"],
      effectiveDate: issues.at(-1)!.occurredAt.slice(0, 10),
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemId: norm.workItemId,
      materialId: norm.materialId,
      subcontractorId: null,
      title: "Материалын зарцуулалт нормоос хэтэрсэн",
      explanation: `Бүртгэгдсэн зарцуулалт зөвшөөрөгдөх нормын ${ratioPercent}% болсон.`,
      actual: {
        consumedScaled: actual.toString(),
        consumptionRatioPercent: ratioPercent,
      },
      threshold: {
        expectedScaled: expected.toString(),
        maximumRatioPercent: PRODUCTION_RULE_THRESHOLDS.materialOveruseRatio * 100,
      },
      delta: {
        excessRatioPercentagePoints:
          ratioPercent - PRODUCTION_RULE_THRESHOLDS.materialOveruseRatio * 100,
      },
      sourceIds: [
        ...issues.map((movement) => movement.stockMovementId),
        progress.progressEntryId,
      ].slice(-500),
      dedupeKey: `MATERIAL_OVERUSE:${norm.workItemId}:${norm.materialId}`,
      rootCauseGroupId: `root-cause-material-${norm.materialId}`,
    });
  }

  return evaluation("MATERIAL_OVERUSE", snapshot, evaluatedSubjects, deviations);
}

function movementBalanceDelta(
  movement: SnapshotStockMovement,
  movementsById: ReadonlyMap<string, SnapshotStockMovement>,
): bigint {
  const quantity = decimalToScaledInteger(movement.quantity);

  if (movement.kind === "RECEIPT") {
    return quantity;
  }

  if (movement.kind === "ISSUE") {
    return -quantity;
  }

  if (movement.kind === "REVERSAL" && movement.reversesMovementId !== null) {
    const source = movementsById.get(movement.reversesMovementId);

    if (source?.kind === "ISSUE") {
      return quantity < 0n ? -quantity : quantity;
    }

    if (source?.kind === "RECEIPT") {
      return quantity > 0n ? -quantity : quantity;
    }
  }

  return quantity;
}

export function evaluateStockShortageRule(
  snapshot: ProjectAnalysisSnapshotV1,
  ruleGraphs: RuleGraphSet = DEFAULT_RULE_GRAPHS,
): DeterministicRuleEvaluationV1 {
  const asOfDate = snapshot.asOf.slice(0, 10);
  const recentStart = addWorkingDays(
    asOfDate,
    -(PRODUCTION_RULE_THRESHOLDS.warningStockCoverageDays - 1),
    snapshot.activeBaseline.calendar,
  );
  const movementsById = new Map(
    snapshot.stockMovements.map((movement) => [movement.stockMovementId, movement]),
  );
  let evaluatedSubjects = 0;
  const deviations: DeterministicDeviationV1[] = [];

  for (const material of snapshot.materials) {
    const movements = snapshot.stockMovements.filter(
      (movement) =>
        movement.materialId === material.materialId &&
        Date.parse(movement.occurredAt) <= Date.parse(snapshot.asOf),
    );
    const recentIssues = movements.filter(
      (movement) =>
        movement.kind === "ISSUE" &&
        compareIsoDates(movement.occurredAt.slice(0, 10), recentStart) >= 0,
    );

    if (recentIssues.length === 0) {
      continue;
    }

    const recentConsumption = recentIssues.reduce(
      (sum, movement) => sum + decimalToScaledInteger(movement.quantity),
      0n,
    );

    if (recentConsumption <= 0n) {
      continue;
    }

    evaluatedSubjects += 1;
    const balance = movements.reduce(
      (sum, movement) => sum + movementBalanceDelta(movement, movementsById),
      0n,
    );
    const averageDailyConsumption =
      Number(recentConsumption) / PRODUCTION_RULE_THRESHOLDS.warningStockCoverageDays;
    const coverageDays =
      averageDailyConsumption <= 0
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Number(balance) / averageDailyConsumption);

    const decision = evaluateRuleThreshold(ruleGraphs.STOCK_SHORTAGE, {
      coverageDays,
    });

    if (decision === null) {
      continue;
    }

    const severity = decision.severity as DeterministicDeviationV1["severity"];
    const sourceIds = movements.slice(-100).map((movement) => movement.stockMovementId);

    deviations.push({
      deviationId: `deviation-stock-shortage-${material.materialId}`,
      ruleId: "STOCK_SHORTAGE",
      ruleVersion: 1,
      severity,
      effectiveDate: asOfDate,
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemId: null,
      materialId: material.materialId,
      subcontractorId: null,
      title: `${material.name} материалын нөөц хүрэлцэхгүй`,
      explanation: `Сүүлийн 14 ажлын өдрийн хэрэглээгээр нөөц ${coverageDays.toFixed(2)} ажлын өдөр хүрнэ.`,
      actual: {
        balanceScaled: balance.toString(),
        coverageWorkingDays: Math.round(coverageDays * 100) / 100,
      },
      threshold: {
        warningCoverageWorkingDays: PRODUCTION_RULE_THRESHOLDS.warningStockCoverageDays,
        criticalCoverageWorkingDays: PRODUCTION_RULE_THRESHOLDS.criticalStockCoverageDays,
      },
      delta: {
        daysBelowWarning:
          Math.round((PRODUCTION_RULE_THRESHOLDS.warningStockCoverageDays - coverageDays) * 100) /
          100,
      },
      sourceIds,
      dedupeKey: `STOCK_SHORTAGE:${material.materialId}`,
      rootCauseGroupId: `root-cause-material-${material.materialId}`,
    });
  }

  return evaluation("STOCK_SHORTAGE", snapshot, evaluatedSubjects, deviations);
}

export function evaluateProductivityDeclineRule(
  snapshot: ProjectAnalysisSnapshotV1,
  ruleGraphs: RuleGraphSet = DEFAULT_RULE_GRAPHS,
): DeterministicRuleEvaluationV1 {
  const entriesByWorkItem = approvedProgressByWorkItem(snapshot);
  let evaluatedSubjects = 0;
  const deviations: DeterministicDeviationV1[] = [];

  for (const workItem of executableWorkItems(snapshot)) {
    const entries = entriesByWorkItem.get(workItem.workItemId) ?? [];

    if (entries.length < 14) {
      continue;
    }

    const sample = entries.slice(-14);
    const previous = sample.slice(0, 7);
    const recent = sample.slice(7);
    const previousAverage =
      previous.reduce((sum, entry) => sum + Number(entry.quantityDoneIncrement), 0) /
      previous.length;
    const recentAverage =
      recent.reduce((sum, entry) => sum + Number(entry.quantityDoneIncrement), 0) / recent.length;

    if (previousAverage <= 0) {
      continue;
    }

    evaluatedSubjects += 1;
    const ratio = recentAverage / previousAverage;
    const decision = evaluateRuleThreshold(ruleGraphs.PRODUCTIVITY_DECLINE, { ratio });

    if (decision === null) {
      continue;
    }

    deviations.push({
      deviationId: `deviation-productivity-${workItem.workItemId}`,
      ruleId: "PRODUCTIVITY_DECLINE",
      ruleVersion: 1,
      severity: decision.severity as DeterministicDeviationV1["severity"],
      effectiveDate: recent[0]!.capturedAt.slice(0, 10),
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemId: workItem.workItemId,
      materialId: null,
      subcontractorId: workItem.subcontractorId,
      title: `${workItem.code} ажлын бүтээмж буурсан`,
      explanation: `Сүүлийн 7 бүртгэлийн дундаж бүтээмж өмнөх 7 бүртгэлийн ${(ratio * 100).toFixed(2)}% байна.`,
      actual: {
        previousAverageQuantity: Number(previousAverage.toFixed(6)),
        recentAverageQuantity: Number(recentAverage.toFixed(6)),
        productivityRatioPercent: Number((ratio * 100).toFixed(2)),
      },
      threshold: {
        minimumRatioPercent: PRODUCTION_RULE_THRESHOLDS.productivityRatio * 100,
      },
      delta: {
        shortfallPercentagePoints: Number(
          (PRODUCTION_RULE_THRESHOLDS.productivityRatio * 100 - ratio * 100).toFixed(2),
        ),
      },
      sourceIds: sample.map((entry) => entry.progressEntryId),
      dedupeKey: `PRODUCTIVITY_DECLINE:${workItem.workItemId}`,
      rootCauseGroupId: null,
    });
  }

  return evaluation("PRODUCTIVITY_DECLINE", snapshot, evaluatedSubjects, deviations);
}

export function evaluateCostAheadRule(
  snapshot: ProjectAnalysisSnapshotV1,
  ruleGraphs: RuleGraphSet = DEFAULT_RULE_GRAPHS,
): DeterministicRuleEvaluationV1 {
  const latest = latestProgressByWorkItem(snapshot);
  let evaluatedSubjects = 0;
  const deviations: DeterministicDeviationV1[] = [];

  for (const workItem of executableWorkItems(snapshot)) {
    const plannedCost = quantityTimesUnitCostCents(workItem.plannedQuantity, workItem.unitCostMnt);

    if (plannedCost <= 0n) {
      continue;
    }

    const costEntries = snapshot.costEntries.filter(
      (entry) =>
        entry.workItemId === workItem.workItemId &&
        Date.parse(entry.occurredAt) <= Date.parse(snapshot.asOf),
    );

    if (costEntries.length === 0) {
      continue;
    }

    evaluatedSubjects += 1;
    const actualCost = costEntries.reduce((sum, entry) => sum + moneyToCents(entry.amountMnt), 0n);
    const costPercent = bigintRatioPercent(actualCost, plannedCost, 2);
    const progressPercent = currentProgress(workItem, latest);
    const lead = costPercent - progressPercent;
    const decision = evaluateRuleThreshold(ruleGraphs.COST_AHEAD_OF_PROGRESS, { lead });

    if (decision === null) {
      continue;
    }

    const progressSource = latest.get(workItem.workItemId)?.progressEntryId ?? workItem.workItemId;

    deviations.push({
      deviationId: `deviation-cost-ahead-${workItem.workItemId}`,
      ruleId: "COST_AHEAD_OF_PROGRESS",
      ruleVersion: 1,
      severity: decision.severity as DeterministicDeviationV1["severity"],
      effectiveDate: costEntries.at(-1)!.occurredAt.slice(0, 10),
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemId: workItem.workItemId,
      materialId: null,
      subcontractorId: workItem.subcontractorId,
      title: `${workItem.code} ажлын зардал биет явцаас түрүүлсэн`,
      explanation: `Зардлын гүйцэтгэл ${costPercent}%, биет гүйцэтгэл ${progressPercent}% байна.`,
      actual: {
        costPercent,
        physicalProgressPercent: progressPercent,
        actualCostCents: actualCost.toString(),
      },
      threshold: {
        maximumLeadPercentagePoints: PRODUCTION_RULE_THRESHOLDS.costLeadPercentagePoints,
        plannedCostCents: plannedCost.toString(),
      },
      delta: {
        leadPercentagePoints: Number(lead.toFixed(2)),
      },
      sourceIds: [...costEntries.map((entry) => entry.costEntryId), progressSource].slice(-500),
      dedupeKey: `COST_AHEAD_OF_PROGRESS:${workItem.workItemId}`,
      rootCauseGroupId: null,
    });
  }

  return evaluation("COST_AHEAD_OF_PROGRESS", snapshot, evaluatedSubjects, deviations);
}

function plannedProgressAt(
  workItem: SnapshotWorkItem,
  asOfDate: string,
  snapshot: ProjectAnalysisSnapshotV1,
): number {
  if (compareIsoDates(asOfDate, workItem.plannedStart) < 0) {
    return 0;
  }

  if (compareIsoDates(asOfDate, workItem.plannedEnd) >= 0) {
    return 100;
  }

  const duration = workingDaysBetween(
    workItem.plannedStart,
    workItem.plannedEnd,
    snapshot.activeBaseline.calendar,
    true,
  );
  const elapsed = workingDaysBetween(
    workItem.plannedStart,
    asOfDate,
    snapshot.activeBaseline.calendar,
    true,
  );
  return Math.min(100, (elapsed / duration) * 100);
}

export function evaluateSubcontractorDeviationRule(
  snapshot: ProjectAnalysisSnapshotV1,
  ruleGraphs: RuleGraphSet = DEFAULT_RULE_GRAPHS,
): DeterministicRuleEvaluationV1 {
  const latest = latestProgressByWorkItem(snapshot);
  const asOfDate = snapshot.asOf.slice(0, 10);
  const workItems = executableWorkItems(snapshot).filter(
    (workItem) => workItem.subcontractorId !== null,
  );
  const deviations: DeterministicDeviationV1[] = [];

  for (const workItem of workItems) {
    const plannedProgress = plannedProgressAt(workItem, asOfDate, snapshot);
    const actualProgress = currentProgress(workItem, latest);
    const lag = plannedProgress - actualProgress;
    const decision = evaluateRuleThreshold(ruleGraphs.SUBCONTRACTOR_DEVIATION, { lag });

    if (decision === null) {
      continue;
    }

    const source = latest.get(workItem.workItemId)?.progressEntryId ?? workItem.workItemId;
    deviations.push({
      deviationId: `deviation-subcontractor-${workItem.workItemId}`,
      ruleId: "SUBCONTRACTOR_DEVIATION",
      ruleVersion: 1,
      severity: decision.severity as DeterministicDeviationV1["severity"],
      effectiveDate: asOfDate,
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemId: workItem.workItemId,
      materialId: null,
      subcontractorId: workItem.subcontractorId,
      title: `${workItem.code} туслан гүйцэтгэгчийн ажил хоцорсон`,
      explanation: `Төлөвлөгөөний гүйцэтгэл ${plannedProgress.toFixed(2)}%, бодит гүйцэтгэл ${actualProgress}% байна.`,
      actual: {
        actualProgressPercent: actualProgress,
        plannedProgressPercent: Number(plannedProgress.toFixed(2)),
      },
      threshold: {
        maximumLagPercentagePoints: PRODUCTION_RULE_THRESHOLDS.subcontractorLagPercentagePoints,
      },
      delta: {
        lagPercentagePoints: Number(lag.toFixed(2)),
      },
      sourceIds: [source],
      dedupeKey: `SUBCONTRACTOR_DEVIATION:${workItem.workItemId}`,
      rootCauseGroupId: null,
    });
  }

  return evaluation("SUBCONTRACTOR_DEVIATION", snapshot, workItems.length, deviations);
}

export function evaluateMissingDailyReportRule(
  snapshot: ProjectAnalysisSnapshotV1,
  ruleGraphs: RuleGraphSet = DEFAULT_RULE_GRAPHS,
): DeterministicRuleEvaluationV1 {
  const asOfDate = snapshot.asOf.slice(0, 10);
  const start = addWorkingDays(
    asOfDate,
    -(PRODUCTION_RULE_THRESHOLDS.missingReportLookbackWorkingDays - 1),
    snapshot.activeBaseline.calendar,
  );
  const expectedDates = enumerateWorkingDates(
    compareIsoDates(start, snapshot.activeBaseline.plannedStart) < 0
      ? snapshot.activeBaseline.plannedStart
      : start,
    asOfDate,
    snapshot.activeBaseline.calendar,
  );
  const approvedReports = snapshot.dailyReports
    .filter((report) => report.status === "APPROVED")
    .sort((left, right) => left.date.localeCompare(right.date));
  const approvedDates = new Set(approvedReports.map((report) => report.date));
  const deviations: DeterministicDeviationV1[] = [];

  for (const date of expectedDates) {
    if (approvedDates.has(date)) {
      continue;
    }

    const before = [...approvedReports]
      .reverse()
      .find((report) => compareIsoDates(report.date, date) < 0);
    const after = approvedReports.find((report) => compareIsoDates(report.date, date) > 0);
    const sourceIds = [before?.dailyReportId, after?.dailyReportId].filter(
      (sourceId): sourceId is string => sourceId !== undefined,
    );
    const decision = evaluateRuleThreshold(ruleGraphs.MISSING_DAILY_REPORT, { date });

    deviations.push({
      deviationId: `deviation-missing-report-${date}`,
      ruleId: "MISSING_DAILY_REPORT",
      ruleVersion: 1,
      severity: (decision?.severity ?? "MEDIUM") as DeterministicDeviationV1["severity"],
      effectiveDate: date,
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemId: null,
      materialId: null,
      subcontractorId: null,
      title: `${date} өдрийн тайлан ирээгүй`,
      explanation: "Төслийн ажлын календарийн өдөрт батлагдсан өдрийн тайлан байхгүй.",
      actual: {
        approvedReportExists: false,
        date,
      },
      threshold: {
        approvedReportRequired: true,
      },
      delta: {
        missingReportCount: 1,
      },
      sourceIds: sourceIds.length > 0 ? sourceIds : [snapshot.activeBaseline.baselineVersionId],
      dedupeKey: `MISSING_DAILY_REPORT:${date}`,
      rootCauseGroupId: null,
    });
  }

  return evaluation("MISSING_DAILY_REPORT", snapshot, expectedDates.length, deviations);
}

export function evaluateStalledProgressRule(
  snapshot: ProjectAnalysisSnapshotV1,
): DeterministicRuleEvaluationV1 {
  const entriesByWorkItem = approvedProgressByWorkItem(snapshot);
  let evaluatedSubjects = 0;
  const deviations: DeterministicDeviationV1[] = [];

  for (const workItem of executableWorkItems(snapshot)) {
    const entries = entriesByWorkItem.get(workItem.workItemId) ?? [];

    if (entries.length < 2) {
      continue;
    }

    evaluatedSubjects += 1;
    const latest = entries.at(-1)!;
    const previous = [...entries]
      .reverse()
      .find((entry) => entry.progressPercent !== latest.progressPercent);

    if (previous === undefined) {
      continue;
    }

    const stalledDays = workingDaysBetween(
      previous.capturedAt.slice(0, 10),
      latest.capturedAt.slice(0, 10),
      snapshot.activeBaseline.calendar,
      false,
    );

    if (stalledDays < PRODUCTION_RULE_THRESHOLDS.stalledWorkingDays) {
      continue;
    }

    deviations.push({
      deviationId: `deviation-stalled-${workItem.workItemId}`,
      ruleId: "STALLED_PROGRESS",
      ruleVersion: 1,
      severity: workItem.isCritical ? "HIGH" : "MEDIUM",
      effectiveDate: addWorkingDays(
        previous.capturedAt.slice(0, 10),
        PRODUCTION_RULE_THRESHOLDS.stalledWorkingDays,
        snapshot.activeBaseline.calendar,
      ),
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemId: workItem.workItemId,
      materialId: null,
      subcontractorId: workItem.subcontractorId,
      title: `${workItem.code} ажлын ахиц зогссон`,
      explanation: `Ахиц ${stalledDays} ажлын өдөр өөрчлөгдөөгүй.`,
      actual: {
        currentProgressPercent: latest.progressPercent,
        stalledWorkingDays: stalledDays,
      },
      threshold: {
        maximumStalledWorkingDays: PRODUCTION_RULE_THRESHOLDS.stalledWorkingDays,
      },
      delta: {
        excessWorkingDays: stalledDays - PRODUCTION_RULE_THRESHOLDS.stalledWorkingDays,
      },
      sourceIds: [previous.progressEntryId, latest.progressEntryId],
      dedupeKey: `STALLED_PROGRESS:${workItem.workItemId}`,
      rootCauseGroupId: null,
    });
  }

  return evaluation("STALLED_PROGRESS", snapshot, evaluatedSubjects, deviations);
}

function firstAndCompletion(entries: readonly SnapshotProgressEntry[]): {
  first: SnapshotProgressEntry | null;
  completed: SnapshotProgressEntry | null;
} {
  return {
    first: entries[0] ?? null,
    completed: entries.find((entry) => entry.progressPercent >= 100) ?? null,
  };
}

export function evaluateDependencyViolationRule(
  snapshot: ProjectAnalysisSnapshotV1,
): DeterministicRuleEvaluationV1 {
  const entriesByWorkItem = approvedProgressByWorkItem(snapshot);
  const dependencies = executableDependencies(snapshot);
  const deviations: DeterministicDeviationV1[] = [];

  for (const dependency of dependencies) {
    const predecessor = firstAndCompletion(
      entriesByWorkItem.get(dependency.predecessorWorkItemId) ?? [],
    );
    const successor = firstAndCompletion(
      entriesByWorkItem.get(dependency.successorWorkItemId) ?? [],
    );
    let violated = false;
    let eventDate: string | null = null;
    let sourceIds: string[] = [];

    if (dependency.type === "FINISH_TO_START" && successor.first !== null) {
      const required =
        predecessor.completed === null
          ? null
          : addWorkingDays(
              predecessor.completed.capturedAt.slice(0, 10),
              dependency.lagDays + 1,
              snapshot.activeBaseline.calendar,
            );
      violated =
        required === null || compareIsoDates(successor.first.capturedAt.slice(0, 10), required) < 0;
      eventDate = successor.first.capturedAt.slice(0, 10);
      sourceIds = [
        successor.first.progressEntryId,
        predecessor.completed?.progressEntryId ?? dependency.predecessorWorkItemId,
      ];
    } else if (dependency.type === "START_TO_START" && successor.first !== null) {
      const required =
        predecessor.first === null
          ? null
          : addWorkingDays(
              predecessor.first.capturedAt.slice(0, 10),
              dependency.lagDays,
              snapshot.activeBaseline.calendar,
            );
      violated =
        required === null || compareIsoDates(successor.first.capturedAt.slice(0, 10), required) < 0;
      eventDate = successor.first.capturedAt.slice(0, 10);
      sourceIds = [
        successor.first.progressEntryId,
        predecessor.first?.progressEntryId ?? dependency.predecessorWorkItemId,
      ];
    } else if (dependency.type === "FINISH_TO_FINISH" && successor.completed !== null) {
      const required =
        predecessor.completed === null
          ? null
          : addWorkingDays(
              predecessor.completed.capturedAt.slice(0, 10),
              dependency.lagDays,
              snapshot.activeBaseline.calendar,
            );
      violated =
        required === null ||
        compareIsoDates(successor.completed.capturedAt.slice(0, 10), required) < 0;
      eventDate = successor.completed.capturedAt.slice(0, 10);
      sourceIds = [
        successor.completed.progressEntryId,
        predecessor.completed?.progressEntryId ?? dependency.predecessorWorkItemId,
      ];
    } else if (dependency.type === "START_TO_FINISH" && successor.completed !== null) {
      const required =
        predecessor.first === null
          ? null
          : addWorkingDays(
              predecessor.first.capturedAt.slice(0, 10),
              dependency.lagDays,
              snapshot.activeBaseline.calendar,
            );
      violated =
        required === null ||
        compareIsoDates(successor.completed.capturedAt.slice(0, 10), required) < 0;
      eventDate = successor.completed.capturedAt.slice(0, 10);
      sourceIds = [
        successor.completed.progressEntryId,
        predecessor.first?.progressEntryId ?? dependency.predecessorWorkItemId,
      ];
    }

    if (!violated || eventDate === null) {
      continue;
    }

    deviations.push({
      deviationId: `deviation-dependency-${dependency.dependencyId}`,
      ruleId: "DEPENDENCY_VIOLATION",
      ruleVersion: 1,
      severity: "CRITICAL",
      effectiveDate: eventDate,
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemId: dependency.successorWorkItemId,
      materialId: null,
      subcontractorId: null,
      title: "Dependency дараалал зөрчигдсөн",
      explanation: `${dependency.type} хамаарлын нөхцөл биелээгүй байхад залгамж ажил эхэлсэн эсвэл дууссан.`,
      actual: {
        eventDate,
        dependencyType: dependency.type,
      },
      threshold: {
        lagWorkingDays: dependency.lagDays,
        predecessorRequired: true,
      },
      delta: {
        violated: true,
      },
      sourceIds,
      dedupeKey: `DEPENDENCY_VIOLATION:${dependency.dependencyId}`,
      rootCauseGroupId: null,
    });
  }

  return evaluation("DEPENDENCY_VIOLATION", snapshot, dependencies.length, deviations);
}

export function evaluateBudgetOverrunRule(
  snapshot: ProjectAnalysisSnapshotV1,
): DeterministicRuleEvaluationV1 {
  const budget = moneyToCents(snapshot.activeBaseline.budgetMnt);
  const actual = snapshot.costEntries.reduce(
    (sum, entry) => sum + moneyToCents(entry.amountMnt),
    0n,
  );
  const deviations: DeterministicDeviationV1[] = [];

  if (actual > budget) {
    deviations.push({
      deviationId: "deviation-budget-project",
      ruleId: "BUDGET_OVERRUN",
      ruleVersion: 1,
      severity: actual > (budget * 11n) / 10n ? "CRITICAL" : "HIGH",
      effectiveDate: snapshot.asOf.slice(0, 10),
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemId: null,
      materialId: null,
      subcontractorId: null,
      title: "Төслийн нийт зардал төсвөөс хэтэрсэн",
      explanation: "Бүртгэгдсэн нийт зардал батлагдсан baseline төсвөөс их байна.",
      actual: {
        actualCostCents: actual.toString(),
      },
      threshold: {
        budgetCents: budget.toString(),
      },
      delta: {
        overrunCents: (actual - budget).toString(),
      },
      sourceIds: [
        snapshot.activeBaseline.baselineVersionId,
        ...snapshot.costEntries.slice(-499).map((entry) => entry.costEntryId),
      ],
      dedupeKey: "BUDGET_OVERRUN:PROJECT",
      rootCauseGroupId: null,
    });
  }

  return evaluation("BUDGET_OVERRUN", snapshot, 1, deviations);
}

export function evaluateLedgerMismatchRule(
  snapshot: ProjectAnalysisSnapshotV1,
): DeterministicRuleEvaluationV1 {
  let evaluatedSubjects = 0;
  const deviations: DeterministicDeviationV1[] = [];

  for (const movement of snapshot.stockMovements) {
    if (movement.kind !== "ISSUE" || movement.unitPriceMnt === null) {
      continue;
    }

    const ledgerEntries = snapshot.costEntries.filter(
      (entry) =>
        entry.sourceType === "STOCK_MOVEMENT" && entry.sourceId === movement.stockMovementId,
    );

    if (ledgerEntries.length === 0) {
      continue;
    }

    evaluatedSubjects += 1;
    const expected = quantityTimesUnitCostCents(movement.quantity, movement.unitPriceMnt);
    const recorded = ledgerEntries.reduce((sum, entry) => sum + moneyToCents(entry.amountMnt), 0n);

    if (expected === recorded) {
      continue;
    }

    deviations.push({
      deviationId: `deviation-ledger-${movement.stockMovementId}`,
      ruleId: "LEDGER_MISMATCH",
      ruleVersion: 1,
      severity: recorded - expected > 1_000_000n * 100n ? "HIGH" : "MEDIUM",
      effectiveDate: movement.occurredAt.slice(0, 10),
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      workItemId: movement.workItemId,
      materialId: movement.materialId,
      subcontractorId: null,
      title: "Материалын хөдөлгөөн ба өртгийн ledger зөрсөн",
      explanation:
        "Агуулахын зарлагын тоо хэмжээ × нэгж үнэ нь cost ledger-ийн нийлбэртэй тэнцэхгүй.",
      actual: {
        recordedCostCents: recorded.toString(),
      },
      threshold: {
        expectedCostCents: expected.toString(),
      },
      delta: {
        varianceCents: (recorded - expected).toString(),
      },
      sourceIds: [movement.stockMovementId, ...ledgerEntries.map((entry) => entry.costEntryId)],
      dedupeKey: `LEDGER_MISMATCH:${movement.stockMovementId}`,
      rootCauseGroupId: null,
    });
  }

  return evaluation("LEDGER_MISMATCH", snapshot, evaluatedSubjects, deviations);
}

export function evaluateProductionRules(
  snapshot: ProjectAnalysisSnapshotV1,
  ruleGraphs: RuleGraphSet = DEFAULT_RULE_GRAPHS,
): DeterministicRuleEvaluationV1[] {
  return [
    evaluateOverdueRule(snapshot, ruleGraphs),
    evaluateMaterialOveruseRule(snapshot, ruleGraphs),
    evaluateStockShortageRule(snapshot, ruleGraphs),
    evaluateProductivityDeclineRule(snapshot, ruleGraphs),
    evaluateCostAheadRule(snapshot, ruleGraphs),
    evaluateSubcontractorDeviationRule(snapshot, ruleGraphs),
    evaluateMissingDailyReportRule(snapshot, ruleGraphs),
    evaluateStalledProgressRule(snapshot),
    evaluateDependencyViolationRule(snapshot),
    evaluateBudgetOverrunRule(snapshot),
    evaluateLedgerMismatchRule(snapshot),
  ];
}
