import { DependencyType, WorkItemStatus } from "@prisma/client";
import { addDays, differenceInCalendarDays } from "date-fns";
import {
  detectedIssueSchema,
  projectAnalysisDataSchema,
  ruleEvaluationSchema,
  type AnalysisDependency,
  type AnalysisWorkItem,
  type DetectedIssue,
  type ProjectAnalysisData,
  type RuleEvaluation,
} from "./schema.js";

export const ANALYSIS_RULE_IDS = {
  overdue: "project.overdue-work-item.v1",
  stalled: "project.stalled-progress.v1",
  dependency: "project.dependency-violation.v1",
  budget: "project.budget-overrun.v1",
  ledger: "project.ledger-mismatch.v1",
} as const;

const issueTypeOrder = [
  "OVERDUE_WORK_ITEM",
  "STALLED_PROGRESS",
  "DEPENDENCY_VIOLATION",
  "BUDGET_OVERRUN",
  "LEDGER_MISMATCH",
] as const;

function toMoneyCents(value: string) {
  const match = value.match(/^(-?)(\d+)\.(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid fixed-precision money value: ${value}`);
  }

  const sign = match[1] === "-" ? -1n : 1n;
  return sign * (BigInt(match[2]!) * 100n + BigInt(match[3]!));
}

function fromMoneyCents(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const cents = String(absolute % 100n).padStart(2, "0");
  return `${sign}${whole}.${cents}`;
}

function issueId(type: DetectedIssue["type"], workItemId: string) {
  return `detected-${type.toLowerCase().replaceAll("_", "-")}-${workItemId}`;
}

function buildRuleEvaluation(decisionId: string, outputs: DetectedIssue[]): RuleEvaluation {
  return ruleEvaluationSchema.parse({
    decisionId,
    decisionVersion: 1,
    hitPolicy: "COLLECT",
    matchedCount: outputs.length,
    outputs,
  });
}

function isFinished(status: WorkItemStatus) {
  return status === WorkItemStatus.COMPLETED || status === WorkItemStatus.CANCELLED;
}

export function detectOverdueWorkItems(input: ProjectAnalysisData): DetectedIssue[] {
  const data = projectAnalysisDataSchema.parse(input);
  const asOf = new Date(data.asOf);

  return data.workItems
    .filter(
      (workItem) =>
        !isFinished(workItem.status) &&
        workItem.actualEnd === null &&
        new Date(workItem.plannedEnd) < asOf,
    )
    .map((workItem) => {
      const daysOverdue = differenceInCalendarDays(asOf, new Date(workItem.plannedEnd));

      return detectedIssueSchema.parse({
        id: issueId("OVERDUE_WORK_ITEM", workItem.id),
        ruleId: ANALYSIS_RULE_IDS.overdue,
        type: "OVERDUE_WORK_ITEM",
        severity: workItem.isCritical ? "HIGH" : "MEDIUM",
        tenantId: data.tenantId,
        projectId: data.projectId,
        workItemId: workItem.id,
        effectiveFrom: addDays(new Date(workItem.plannedEnd), 1).toISOString(),
        summary: `${workItem.code} ${workItem.name} ажил ${daysOverdue} хоног хугацаа хэтэрсэн.`,
        evidence: {
          plannedEnd: workItem.plannedEnd,
          status: workItem.status,
          progressPercent: workItem.progressPercent,
          daysOverdue,
        },
      });
    });
}

export function detectStalledProgress(
  input: ProjectAnalysisData,
  thresholdDays = 7,
): DetectedIssue[] {
  const data = projectAnalysisDataSchema.parse(input);
  const issues: DetectedIssue[] = [];

  for (const workItem of data.workItems) {
    if (isFinished(workItem.status)) {
      continue;
    }

    const snapshots = [...workItem.snapshots].sort(
      (left, right) => new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime(),
    );
    const latest = snapshots.at(-1);
    const previous = snapshots.at(-2);

    if (!latest || !previous) {
      continue;
    }

    const daysWithoutProgress = differenceInCalendarDays(
      new Date(latest.capturedAt),
      new Date(previous.capturedAt),
    );

    if (
      latest.progressPercent !== previous.progressPercent ||
      daysWithoutProgress < thresholdDays
    ) {
      continue;
    }

    issues.push(
      detectedIssueSchema.parse({
        id: issueId("STALLED_PROGRESS", workItem.id),
        ruleId: ANALYSIS_RULE_IDS.stalled,
        type: "STALLED_PROGRESS",
        severity: workItem.isCritical ? "HIGH" : "MEDIUM",
        tenantId: data.tenantId,
        projectId: data.projectId,
        workItemId: workItem.id,
        effectiveFrom: addDays(new Date(previous.capturedAt), thresholdDays).toISOString(),
        summary: `${workItem.code} ${workItem.name} ажлын ахиц ${daysWithoutProgress} хоног өөрчлөгдөөгүй.`,
        evidence: {
          previousCapturedAt: previous.capturedAt,
          latestCapturedAt: latest.capturedAt,
          previousProgressPercent: previous.progressPercent,
          currentProgressPercent: latest.progressPercent,
          daysWithoutProgress,
        },
      }),
    );
  }

  return issues;
}

function dependencyViolationEvent(
  dependency: AnalysisDependency,
  predecessor: AnalysisWorkItem,
  successor: AnalysisWorkItem,
) {
  switch (dependency.type) {
    case DependencyType.FINISH_TO_START: {
      if (!successor.actualStart) {
        return null;
      }

      const requiredStart = predecessor.actualEnd
        ? addDays(new Date(predecessor.actualEnd), dependency.lagDays + 1)
        : null;

      return !requiredStart || new Date(successor.actualStart) < requiredStart
        ? successor.actualStart
        : null;
    }
    case DependencyType.START_TO_START: {
      if (!successor.actualStart) {
        return null;
      }

      const requiredStart = predecessor.actualStart
        ? addDays(new Date(predecessor.actualStart), dependency.lagDays)
        : null;

      return !requiredStart || new Date(successor.actualStart) < requiredStart
        ? successor.actualStart
        : null;
    }
    case DependencyType.FINISH_TO_FINISH: {
      if (!successor.actualEnd) {
        return null;
      }

      const requiredFinish = predecessor.actualEnd
        ? addDays(new Date(predecessor.actualEnd), dependency.lagDays)
        : null;

      return !requiredFinish || new Date(successor.actualEnd) < requiredFinish
        ? successor.actualEnd
        : null;
    }
    case DependencyType.START_TO_FINISH: {
      if (!successor.actualEnd) {
        return null;
      }

      const requiredFinish = predecessor.actualStart
        ? addDays(new Date(predecessor.actualStart), dependency.lagDays)
        : null;

      return !requiredFinish || new Date(successor.actualEnd) < requiredFinish
        ? successor.actualEnd
        : null;
    }
  }
}

export function detectDependencyViolations(input: ProjectAnalysisData): DetectedIssue[] {
  const data = projectAnalysisDataSchema.parse(input);
  const asOf = new Date(data.asOf);
  const workItemsById = new Map(data.workItems.map((workItem) => [workItem.id, workItem]));
  const violationsBySuccessor = new Map<
    string,
    Array<{
      dependency: AnalysisDependency;
      predecessor: AnalysisWorkItem;
      eventDate: string;
    }>
  >();

  for (const dependency of data.dependencies) {
    const predecessor = workItemsById.get(dependency.predecessorId)!;
    const successor = workItemsById.get(dependency.successorId)!;

    if (isFinished(predecessor.status) || isFinished(successor.status)) {
      continue;
    }

    const eventDate = dependencyViolationEvent(dependency, predecessor, successor);

    if (!eventDate || new Date(eventDate) > asOf) {
      continue;
    }

    const successorViolations = violationsBySuccessor.get(successor.id) ?? [];
    successorViolations.push({ dependency, predecessor, eventDate });
    violationsBySuccessor.set(successor.id, successorViolations);
  }

  const issues: DetectedIssue[] = [];

  for (const [successorId, violations] of violationsBySuccessor) {
    const successor = workItemsById.get(successorId)!;
    const orderedViolations = [...violations].sort(
      (left, right) =>
        new Date(right.predecessor.plannedEnd).getTime() -
          new Date(left.predecessor.plannedEnd).getTime() ||
        left.predecessor.id.localeCompare(right.predecessor.id),
    );
    const primary = orderedViolations[0]!;
    const effectiveFrom = [...orderedViolations].map((violation) => violation.eventDate).sort()[0]!;
    const isCritical = orderedViolations.some((violation) => violation.predecessor.isCritical);

    issues.push(
      detectedIssueSchema.parse({
        id: issueId("DEPENDENCY_VIOLATION", successor.id),
        ruleId: ANALYSIS_RULE_IDS.dependency,
        type: "DEPENDENCY_VIOLATION",
        severity: successor.isCritical && isCritical ? "CRITICAL" : "HIGH",
        tenantId: data.tenantId,
        projectId: data.projectId,
        workItemId: successor.id,
        effectiveFrom,
        summary: `${successor.code} ${successor.name} ажил ${orderedViolations.length} дуусаагүй predecessor-тэй үед эхэлсэн.`,
        evidence: {
          dependencyIds: orderedViolations.map((violation) => violation.dependency.id),
          predecessorIds: orderedViolations.map((violation) => violation.predecessor.id),
          predecessorId: primary.predecessor.id,
          predecessorStatus: primary.predecessor.status,
          successorActualStart: successor.actualStart,
          violationCount: orderedViolations.length,
        },
      }),
    );
  }

  return issues;
}

export function detectBudgetOverruns(input: ProjectAnalysisData): DetectedIssue[] {
  const data = projectAnalysisDataSchema.parse(input);
  const issues: DetectedIssue[] = [];

  for (const workItem of data.workItems) {
    const budget = toMoneyCents(workItem.budget);
    const actualCost = toMoneyCents(workItem.actualCost);

    if (actualCost <= budget) {
      continue;
    }

    const variance = actualCost - budget;
    const overrunPercent = budget === 0n ? 100 : Number((variance * 10_000n) / budget) / 100;
    const latestCostDate = [...workItem.costEntries]
      .map((entry) => entry.occurredAt)
      .sort()
      .at(-1);

    issues.push(
      detectedIssueSchema.parse({
        id: issueId("BUDGET_OVERRUN", workItem.id),
        ruleId: ANALYSIS_RULE_IDS.budget,
        type: "BUDGET_OVERRUN",
        severity: overrunPercent >= 50 ? "HIGH" : "MEDIUM",
        tenantId: data.tenantId,
        projectId: data.projectId,
        workItemId: workItem.id,
        effectiveFrom: workItem.actualEnd ?? latestCostDate ?? data.asOf,
        summary: `${workItem.code} ${workItem.name} ажлын зардал төсвөөс ${fromMoneyCents(variance)} төгрөгөөр хэтэрсэн.`,
        evidence: {
          budget: workItem.budget,
          actualCost: workItem.actualCost,
          variance: fromMoneyCents(variance),
          overrunPercent,
        },
      }),
    );
  }

  return issues;
}

export function detectLedgerMismatches(input: ProjectAnalysisData): DetectedIssue[] {
  const data = projectAnalysisDataSchema.parse(input);
  const issues: DetectedIssue[] = [];

  for (const workItem of data.workItems) {
    const recordedActualCost = toMoneyCents(workItem.actualCost);
    const ledgerTotal = workItem.costEntries.reduce(
      (total, entry) => total + toMoneyCents(entry.amount),
      0n,
    );
    const variance = recordedActualCost - ledgerTotal;

    if (variance === 0n) {
      continue;
    }

    issues.push(
      detectedIssueSchema.parse({
        id: issueId("LEDGER_MISMATCH", workItem.id),
        ruleId: ANALYSIS_RULE_IDS.ledger,
        type: "LEDGER_MISMATCH",
        severity: "HIGH",
        tenantId: data.tenantId,
        projectId: data.projectId,
        workItemId: workItem.id,
        effectiveFrom: data.asOf,
        summary: `${workItem.code} ${workItem.name} ажлын бүртгэсэн зардал ledger-ээс ${fromMoneyCents(variance)} төгрөгөөр зөрсөн.`,
        evidence: {
          recordedActualCost: workItem.actualCost,
          ledgerTotal: fromMoneyCents(ledgerTotal),
          variance: fromMoneyCents(variance),
        },
      }),
    );
  }

  return issues;
}

export function evaluateDeterministicRules(
  input: ProjectAnalysisData,
  options: { stalledThresholdDays?: number } = {},
) {
  const data = projectAnalysisDataSchema.parse(input);
  const evaluations = [
    buildRuleEvaluation(ANALYSIS_RULE_IDS.overdue, detectOverdueWorkItems(data)),
    buildRuleEvaluation(
      ANALYSIS_RULE_IDS.stalled,
      detectStalledProgress(data, options.stalledThresholdDays ?? 7),
    ),
    buildRuleEvaluation(ANALYSIS_RULE_IDS.dependency, detectDependencyViolations(data)),
    buildRuleEvaluation(ANALYSIS_RULE_IDS.budget, detectBudgetOverruns(data)),
    buildRuleEvaluation(ANALYSIS_RULE_IDS.ledger, detectLedgerMismatches(data)),
  ];
  const issues = evaluations
    .flatMap((evaluation) => evaluation.outputs)
    .sort(
      (left, right) =>
        issueTypeOrder.indexOf(left.type) - issueTypeOrder.indexOf(right.type) ||
        left.workItemId.localeCompare(right.workItemId),
    );

  return {
    evaluations,
    issues,
  };
}
