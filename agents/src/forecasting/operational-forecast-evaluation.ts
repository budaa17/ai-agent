import { createHash } from "node:crypto";
import type { BuildWatchSourceReference } from "../contracts/index.js";
import {
  addWorkingDays,
  previousWorkingDay,
  workingDaysBetween,
  type ProductionCalendar,
} from "../production-analysis/calendar.js";
import {
  operationalForecastRequestV1Schema,
  type OperationalForecastRequestV1,
} from "./operational-forecast-contracts.js";
import { calculateOperationalForecast } from "./operational-forecast.js";

const benchmarkCalendar: ProductionCalendar = {
  workingWeekdays: [1, 2, 3, 4, 5, 6],
  holidays: [],
};

const benchmarkAsOfDate = "2026-09-01";
const benchmarkGeneratedAt = "2026-09-01T18:00:00.000Z";
const delayScenarios = [
  -3, -2, -1, 0, 0, 0, 1, 2, 3, 4, 5, 5, 6, 7, 8, 9, 10, 10, 11, 12, 13, 14, 16, 18, 4, 8, 12, 0,
  15, 2,
] as const;

type EvaluationStatus =
  "ON_TRACK" | "AT_RISK" | "LIKELY_LATE" | "CRITICAL_LATE" | "INSUFFICIENT_DATA";

export type OperationalForecastEvaluationCase = {
  caseId: string;
  scenario: string;
  expectedStatus: EvaluationStatus;
  predictedStatus: EvaluationStatus;
  expectedDelayWorkingDays: number | null;
  predictedDelayWorkingDays: number | null;
  expectedProjectedFinish: string | null;
  predictedProjectedFinish: string | null;
  finishAbsoluteErrorWorkingDays: number | null;
  warningLeadWorkingDays: number | null;
  recoveryExpected: boolean;
  recoveryCreated: boolean;
  sourceComplete: boolean;
  deterministicReplay: boolean;
  baselineChanged: boolean;
  pass: boolean;
};

export type OperationalForecastEvaluationReport = {
  schemaVersion: 1;
  evaluationType: "BUILDWATCH_V22_OPERATIONAL_FORECAST";
  generatedAt: string;
  seed: "buildwatch-v22-phase5-answer-key-v1";
  caseCount: number;
  metrics: {
    finishMaeWorkingDays: number;
    criticalDelayRecall: number;
    averageEarlyWarningWorkingDays: number;
    falseAlertRate: number;
    sourceCoverage: number;
    deterministicReplayRate: number;
    recoveryCoverage: number;
    baselineMutationCount: number;
  };
  thresholds: {
    minimumCaseCount: 24;
    maximumFinishMaeWorkingDays: 7;
    minimumCriticalDelayRecall: 0.9;
    minimumAverageEarlyWarningWorkingDays: 5;
    maximumFalseAlertRate: 0.1;
    requiredSourceCoverage: 1;
    requiredDeterministicReplayRate: 1;
    minimumRecoveryCoverage: 0.9;
    maximumBaselineMutationCount: 0;
  };
  cases: OperationalForecastEvaluationCase[];
  pass: boolean;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decimal(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function source(
  caseId: string,
  sourceRefId: string,
  sourceType: BuildWatchSourceReference["sourceType"],
  asOf: string,
): BuildWatchSourceReference {
  return {
    sourceRefId: `${caseId}-${sourceRefId}`,
    tenantId: "tenant-phase5-evaluation",
    projectId: "project-phase5-evaluation",
    sourceType,
    sourceId: `${caseId}-source-${sourceRefId}`,
    sourceVersionId: `${caseId}-source-version-001`,
    artifactId: sourceType === "PHOTO_EVIDENCE" ? `${caseId}-artifact-001` : null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: null,
    region: null,
    asOf,
    sha256: sourceType === "PHOTO_EVIDENCE" ? "b".repeat(64) : null,
  };
}

function evaluationStatus(delay: number): EvaluationStatus {
  if (delay <= 0) {
    return "ON_TRACK";
  }
  if (delay <= 5) {
    return "AT_RISK";
  }
  if (delay <= 10) {
    return "LIKELY_LATE";
  }
  return "CRITICAL_LATE";
}

function appliedProgress(
  caseId: string,
  reportDate: string,
  sampleIndex: number,
  pace: number,
): OperationalForecastRequestV1["appliedProgress"][number] {
  const reportSource = source(
    caseId,
    `report-${sampleIndex}`,
    "DAILY_REPORT",
    `${reportDate}T12:00:00.000Z`,
  );
  const photoSource = source(
    caseId,
    `photo-${sampleIndex}`,
    "PHOTO_EVIDENCE",
    `${reportDate}T11:30:00.000Z`,
  );
  const approvalSource = source(
    caseId,
    `approval-${sampleIndex}`,
    "HUMAN_DECISION",
    `${reportDate}T14:00:00.000Z`,
  );
  const calculationSource = source(
    caseId,
    `verification-calculation-${sampleIndex}`,
    "SYSTEM_CALCULATION",
    `${reportDate}T15:00:00.000Z`,
  );
  const sources = [reportSource, photoSource, approvalSource, calculationSource];
  const quantity = {
    value: decimal(pace),
    unit: "m2" as const,
    sourceRefs: sources,
  };
  const versionId = `${caseId}-verification-${sampleIndex}`;
  return {
    schemaVersion: 1,
    applyType: "APPLIED_PROGRESS_VERIFICATION",
    applyId: `${caseId}-apply-${sampleIndex}`,
    idempotencyKey: `${caseId}-apply-idempotency-${sampleIndex}`,
    commandId: `${caseId}-command-${sampleIndex}`,
    commandHash: hash(`${caseId}-command-${sampleIndex}`),
    tenantId: "tenant-phase5-evaluation",
    projectId: "project-phase5-evaluation",
    progressVerificationVersionId: versionId,
    dailyReportId: `${caseId}-daily-report-${sampleIndex}`,
    reportDate,
    status: "APPLIED",
    transactionBoundary: "APPROVED_COMMAND_ONLY",
    progressHistory: [
      {
        progressHistoryId: `${caseId}-history-${sampleIndex}`,
        progressVerificationVersionId: versionId,
        dailyReportId: `${caseId}-daily-report-${sampleIndex}`,
        dailyPlanItemId: `${caseId}-plan-item-${sampleIndex}`,
        dailyProgressEntryId: `${caseId}-progress-entry-${sampleIndex}`,
        workItemId: `${caseId}-work-item`,
        reportDate,
        completionStatus: "PARTIALLY_COMPLETED",
        verifiedQuantity: quantity,
        cumulativeQuantity: {
          ...quantity,
          value: decimal(pace * sampleIndex),
        },
        completionRatePercent: null,
        forecastEligible: true,
        sourceRefs: sources,
      },
    ],
    dailyVariances: [
      {
        dailyVarianceId: `${caseId}-variance-${sampleIndex}`,
        progressVerificationVersionId: versionId,
        workItemId: `${caseId}-work-item`,
        reportDate,
        plannedQuantity: quantity,
        verifiedQuantity: quantity,
        variance: {
          quantity: { ...quantity, value: "0" },
          percentage: "0",
          percentageSourceRefs: [calculationSource],
        },
        sourceRefs: sources,
      },
    ],
    productivitySamples: [
      {
        productivitySampleId: `${caseId}-sample-${sampleIndex}`,
        progressVerificationVersionId: versionId,
        workItemId: `${caseId}-work-item`,
        reportDate,
        quantity,
        laborHours: "48",
        included: true,
        exclusionReason: null,
        sourceRefs: sources,
      },
    ],
    materialLedgerEntries: [],
    forecastInputs: [
      {
        forecastInputId: `${caseId}-forecast-input-${sampleIndex}`,
        progressVerificationVersionId: versionId,
        workItemId: `${caseId}-work-item`,
        reportDate,
        completionStatus: "PARTIALLY_COMPLETED",
        verifiedQuantity: quantity,
        included: true,
        exclusionReason: null,
        sourceRefs: sources,
      },
    ],
    audit: {
      auditId: `${caseId}-audit-${sampleIndex}`,
      action: "APPLY_PROGRESS_VERIFICATION",
      actorId: "phase5-evaluation-worker",
      appliedAt: `${reportDate}T15:00:00.000Z`,
      commandHash: hash(`${caseId}-command-${sampleIndex}`),
      approvedSourceHash: hash(`${caseId}-approved-${sampleIndex}`),
      reviewerId: "phase5-evaluation-manager",
      reviewerRole: "PROJECT_MANAGER",
      sourceRefs: [approvalSource, calculationSource],
    },
    deterministic: true,
    appliedBy: "phase5-evaluation-worker",
    appliedAt: `${reportDate}T15:00:00.000Z`,
    sourceRefs: sources,
  };
}

function benchmarkRequest(
  caseId: string,
  delayWorkingDays: number,
  pace: number,
  insufficient = false,
): {
  request: OperationalForecastRequestV1;
  expectedProjectedFinish: string | null;
  plannedWorkItemFinish: string;
} {
  const scheduleSource = source(caseId, "schedule", "SCHEDULE_VERSION", "2026-08-01T00:00:00.000Z");
  const calendarSource = source(caseId, "calendar", "CALENDAR_VERSION", "2026-01-01T00:00:00.000Z");
  const resourceSource = source(
    caseId,
    "resource",
    "RESOURCE_AVAILABILITY",
    `${benchmarkAsOfDate}T08:00:00.000Z`,
  );
  const normSource = source(caseId, "norm", "CATALOG_VERSION", "2026-01-01T00:00:00.000Z");
  const policySource = source(caseId, "policy", "CATALOG_VERSION", "2026-01-01T00:00:00.000Z");
  const recoverySource = source(caseId, "recovery", "CATALOG_VERSION", "2026-01-01T00:00:00.000Z");
  const durationWorkingDays = 24;
  const remainingQuantity = pace * durationWorkingDays;
  const ownProjectedFinish = addWorkingDays(
    benchmarkAsOfDate,
    durationWorkingDays - 1,
    benchmarkCalendar,
  );
  const plannedWorkItemFinish = addWorkingDays(
    ownProjectedFinish,
    -delayWorkingDays,
    benchmarkCalendar,
  );
  const baselineFinish = "2026-12-31";
  const expectedProjectedFinish = insufficient
    ? null
    : addWorkingDays(baselineFinish, delayWorkingDays, benchmarkCalendar);
  const sampleEnd = previousWorkingDay(benchmarkAsOfDate, benchmarkCalendar, true);
  const samples = [
    addWorkingDays(sampleEnd, -2, benchmarkCalendar),
    addWorkingDays(sampleEnd, -1, benchmarkCalendar),
    sampleEnd,
  ].map((reportDate, index) => appliedProgress(caseId, reportDate, index + 1, pace));
  const request = operationalForecastRequestV1Schema.parse({
    schemaVersion: 1,
    requestType: "A5_OPERATIONAL_FORECAST",
    requestId: `${caseId}-request`,
    idempotencyKey: `${caseId}-idempotency`,
    tenantId: "tenant-phase5-evaluation",
    projectId: "project-phase5-evaluation",
    asOfDate: benchmarkAsOfDate,
    approvedBaseline: {
      schemaVersion: 1,
      versionType: "APPROVED_BASELINE",
      baselineVersionId: `${caseId}-baseline-v1`,
      tenantId: "tenant-phase5-evaluation",
      projectId: "project-phase5-evaluation",
      status: "APPROVED",
      content: {
        quantityTakeoffVersionId: `${caseId}-qto-v1`,
        estimateVersionId: `${caseId}-estimate-v1`,
        scheduleVersionId: `${caseId}-schedule-v1`,
        plannedStart: "2026-08-01",
        plannedFinish: baselineFinish,
        budgetMnt: "100000000.00",
        calendar: {
          calendarVersionId: `${caseId}-calendar-v1`,
          timezone: "Asia/Ulaanbaatar",
          workingWeekdays: [...benchmarkCalendar.workingWeekdays],
          workHoursPerDay: 8,
          holidays: [...benchmarkCalendar.holidays],
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          sourceRefs: [calendarSource],
        },
        activities: [
          {
            activityId: `${caseId}-activity`,
            workItemId: `${caseId}-work-item`,
            code: `${caseId}-WORK`,
            name: "Phase 5 benchmark activity",
            zoneCode: "ZONE-01",
            unit: "m2",
            plannedQuantity: {
              value: decimal(remainingQuantity + pace * 6),
              unit: "m2",
              sourceRefs: [scheduleSource],
            },
            durationWorkingDays: 30,
            plannedStart: "2026-08-01",
            plannedEnd: plannedWorkItemFinish,
            priority: "CRITICAL",
            isCritical: true,
            totalFloatWorkingDays: 0,
            contractMilestone: false,
            resourceRequirements: [
              {
                requirementId: `${caseId}-crew-requirement`,
                resourceType: "CREW",
                resourceClassCode: "MASON",
                count: 1,
                sourceRefs: [scheduleSource],
              },
            ],
            sourceRefs: [scheduleSource],
          },
        ],
        dependencies: [],
      },
      metadata: {
        version: 1,
        approvedBy: "phase5-evaluation-manager",
        approvedAt: "2026-08-01T08:00:00.000Z",
        sourceHash: hash(`${caseId}-baseline`),
        supersedesVersionId: null,
      },
    },
    operationalSnapshot: {
      schemaVersion: 1,
      snapshotType: "OPERATIONAL_PLANNING",
      snapshotId: `${caseId}-operational-snapshot`,
      tenantId: "tenant-phase5-evaluation",
      projectId: "project-phase5-evaluation",
      asOf: `${benchmarkAsOfDate}T08:00:00.000Z`,
      baselineVersionId: `${caseId}-baseline-v1`,
      scheduleVersionId: `${caseId}-schedule-v1`,
      policyVersion: {
        policyVersionId: `${caseId}-planning-policy-v1`,
        version: 1,
        effectiveFrom: "2026-01-01",
      },
      calendar: {
        calendarVersionId: `${caseId}-calendar-v1`,
        timezone: "Asia/Ulaanbaatar",
        workingWeekdays: [...benchmarkCalendar.workingWeekdays],
        workHoursPerDay: 8,
        holidays: [...benchmarkCalendar.holidays],
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        sourceRefs: [calendarSource],
      },
      workItems: [
        {
          workItemId: `${caseId}-work-item`,
          activityId: `${caseId}-activity`,
          code: `${caseId}-WORK`,
          name: "Phase 5 benchmark activity",
          zoneCode: "ZONE-01",
          workClassCode: "MASONRY",
          unit: "m2",
          plannedQuantity: {
            value: decimal(remainingQuantity + pace * 6),
            unit: "m2",
            sourceRefs: [scheduleSource],
          },
          remainingQuantity: {
            value: decimal(remainingQuantity),
            unit: "m2",
            sourceRefs: [scheduleSource],
          },
          status: "IN_PROGRESS",
          priority: "CRITICAL",
          isCritical: true,
          totalFloatWorkingDays: 0,
          downstreamUnlockCount: 1,
          contractMilestone: false,
          plannedStart: benchmarkAsOfDate,
          plannedFinish: plannedWorkItemFinish,
          predecessorWorkItemIds: [],
          requiredInspectionIds: [],
          requiredCrewType: "MASON",
          requiredEquipmentIds: [],
          requiredMaterials: [],
          weatherRestrictions: [],
          safetyRestrictions: [],
          sourceRefs: [scheduleSource],
        },
      ],
      crews: [
        {
          crewId: `${caseId}-crew`,
          crewType: "MASON",
          headcount: 6,
          shiftStart: "08:00",
          shiftEnd: "16:00",
          productivityPerShift: {
            value: decimal(pace),
            unit: "m2",
            sourceRefs: [resourceSource],
          },
          productivityVersion: {
            tenantId: "tenant-phase5-evaluation",
            projectId: "project-phase5-evaluation",
            catalogType: "PRODUCTIVITY",
            versionId: `${caseId}-crew-productivity-v1`,
            version: 1,
            effectiveFrom: "2026-01-01",
            effectiveTo: null,
            approvedBy: "phase5-evaluation-manager",
            approvedAt: "2026-01-01T01:00:00.000Z",
            sourceRefs: [resourceSource],
          },
          availableFrom: "2026-01-01",
          availableTo: "2026-12-31",
          available: true,
          sourceRefs: [resourceSource],
        },
      ],
      equipment: [],
      materials: [],
      zones: [
        {
          zoneCode: "ZONE-01",
          maxConcurrentActivities: 2,
          available: true,
          sourceRefs: [resourceSource],
        },
      ],
      inspections: [],
      blockers: [],
      weatherConstraints: [],
      approvedActuals: [],
    },
    appliedProgress: insufficient ? [] : samples,
    productivityNorms: insufficient
      ? []
      : [
          {
            normId: `${caseId}-norm`,
            normVersionId: `${caseId}-norm-v1`,
            tenantId: "tenant-phase5-evaluation",
            projectId: "project-phase5-evaluation",
            workClassCode: "MASONRY",
            unit: "m2",
            productivityPerWorkingDay: {
              value: "10",
              unit: "m2",
              sourceRefs: [normSource],
            },
            referenceCrewHeadcount: 6,
            referenceShiftHours: 8,
            effectiveFrom: "2026-01-01",
            approvedBy: "phase5-evaluation-manager",
            approvedAt: "2026-01-01T01:00:00.000Z",
            sourceRefs: [normSource],
          },
        ],
    learningAdjustments: [],
    outlierReviews: [],
    recoveryOptions: [
      {
        optionId: `${caseId}-recovery-option`,
        optionVersionId: `${caseId}-recovery-option-v1`,
        actionType: "ADD_CREW",
        applicableWorkClassCode: "MASONRY",
        productivityMultiplier: "1.5",
        fixedWorkingDaysReduction: null,
        additionalCostMnt: {
          value: "500000.00",
          currency: "MNT",
          sourceRefs: [recoverySource],
        },
        requiredResourceIds: [`${caseId}-recovery-crew`],
        risks: ["Site congestion"],
        effectiveFrom: "2026-01-01",
        sourceRefs: [recoverySource],
      },
    ],
    policy: {
      schemaVersion: 1,
      policyType: "OPERATIONAL_FORECAST_POLICY",
      policyId: `${caseId}-forecast-policy`,
      policyVersionId: `${caseId}-forecast-policy-v1`,
      version: 1,
      tenantId: "tenant-phase5-evaluation",
      projectId: "project-phase5-evaluation",
      effectiveFrom: "2026-01-01",
      approvedBy: "phase5-evaluation-manager",
      approvedAt: "2026-01-01T01:00:00.000Z",
      minimumValidSamples: 3,
      outlierMethod: "MAD_REVIEW_ONLY",
      outlierThresholdMad: "3.5",
      blockedDayHandling: "EXCLUDE",
      fallbackMethod: "APPROVED_NORM_ONLY",
      windowWeights: { threeDay: 0.5, sevenDay: 0.3, fourteenDay: 0.2 },
      weatherRestrictedFactor: "0.7",
      unavailableEquipmentFactor: "0.5",
      materialShortageFloorFactor: "0.25",
      openBlockerFactor: "0.5",
      minimumAdjustedProductivityFactor: "0.1",
      maximumAdjustedProductivityFactor: "3",
      warningWorkingDays: 5,
      criticalWorkingDays: 10,
      confidenceWeights: {
        approvedReportCoverage: 0.2,
        validQuantityCoverage: 0.2,
        photoEvidenceCoverage: 0.1,
        productivityHistoryLength: 0.15,
        unresolvedBlockers: 0.1,
        catalogCompleteness: 0.1,
        dependencyCompleteness: 0.05,
        resourceDataQuality: 0.1,
      },
      maximumRecoveryScenarios: 3,
      sourceRefs: [policySource],
    },
    generatedAt: benchmarkGeneratedAt,
  });
  return { request, expectedProjectedFinish, plannedWorkItemFinish };
}

function sourceComplete(result: ReturnType<typeof calculateOperationalForecast>): boolean {
  return (
    result.forecast.sourceRefs.length > 0 &&
    result.forecast.confidenceFactors.every((factor) => factor.sourceRefs.length > 0) &&
    result.forecast.workItems.every(
      (workItem) =>
        workItem.sourceRefs.length > 0 &&
        workItem.confidenceFactors.every((factor) => factor.sourceRefs.length > 0) &&
        workItem.drivers.every(
          (driver) =>
            driver.sourceRefs.length > 0 && driver.impactWorkingDays.sourceRefs.length > 0,
        ),
    ) &&
    result.recoveryProposals.every(
      (proposal) =>
        proposal.sourceRefs.length > 0 &&
        proposal.actions.every((action) => action.sourceRefs.length > 0),
    )
  );
}

export function evaluateOperationalForecast(): OperationalForecastEvaluationReport {
  const definitions = [
    ...delayScenarios.map((delayWorkingDays, index) => ({
      caseId: `phase5-forecast-${String(index + 1).padStart(2, "0")}`,
      scenario: `DELAY_${delayWorkingDays}`,
      delayWorkingDays,
      pace: 8 + (index % 5),
      insufficient: false,
    })),
    {
      caseId: "phase5-forecast-31",
      scenario: "INSUFFICIENT_NO_NORM",
      delayWorkingDays: 0,
      pace: 10,
      insufficient: true,
    },
    {
      caseId: "phase5-forecast-32",
      scenario: "INSUFFICIENT_NO_HISTORY",
      delayWorkingDays: 0,
      pace: 12,
      insufficient: true,
    },
  ];
  const cases: OperationalForecastEvaluationCase[] = definitions.map((definition) => {
    const benchmark = benchmarkRequest(
      definition.caseId,
      definition.delayWorkingDays,
      definition.pace,
      definition.insufficient,
    );
    const result = calculateOperationalForecast(benchmark.request);
    const replay = calculateOperationalForecast(structuredClone(benchmark.request));
    const expectedStatus: EvaluationStatus = definition.insufficient
      ? "INSUFFICIENT_DATA"
      : evaluationStatus(definition.delayWorkingDays);
    const expectedDelay = definition.insufficient ? null : definition.delayWorkingDays;
    const predictedDelay = result.forecast.delayWorkingDays?.value ?? null;
    const finishError =
      benchmark.expectedProjectedFinish === null || result.forecast.projectedFinish === null
        ? null
        : Math.abs(
            workingDaysBetween(
              benchmark.expectedProjectedFinish,
              result.forecast.projectedFinish,
              benchmarkCalendar,
              false,
            ),
          );
    const warningLead =
      definition.insufficient ||
      definition.delayWorkingDays <= 0 ||
      result.forecast.status === "ON_TRACK" ||
      result.forecast.status === "INSUFFICIENT_DATA"
        ? null
        : workingDaysBetween(
            benchmarkAsOfDate,
            benchmark.plannedWorkItemFinish,
            benchmarkCalendar,
            false,
          );
    const recoveryExpected = !definition.insufficient && definition.delayWorkingDays > 0;
    const deterministicReplay = JSON.stringify(result) === JSON.stringify(replay);
    const sourcesPresent = sourceComplete(result);
    const pass =
      result.forecast.status === expectedStatus &&
      predictedDelay === expectedDelay &&
      result.forecast.projectedFinish === benchmark.expectedProjectedFinish &&
      (finishError === null || finishError <= 7) &&
      result.recoveryProposals.length > 0 === recoveryExpected &&
      sourcesPresent &&
      deterministicReplay &&
      !result.baselineChanged;
    return {
      caseId: definition.caseId,
      scenario: definition.scenario,
      expectedStatus,
      predictedStatus: result.forecast.status,
      expectedDelayWorkingDays: expectedDelay,
      predictedDelayWorkingDays: predictedDelay,
      expectedProjectedFinish: benchmark.expectedProjectedFinish,
      predictedProjectedFinish: result.forecast.projectedFinish,
      finishAbsoluteErrorWorkingDays: finishError,
      warningLeadWorkingDays: warningLead,
      recoveryExpected,
      recoveryCreated: result.recoveryProposals.length > 0,
      sourceComplete: sourcesPresent,
      deterministicReplay,
      baselineChanged: result.baselineChanged,
      pass,
    };
  });

  const finishErrors = cases
    .map((item) => item.finishAbsoluteErrorWorkingDays)
    .filter((value): value is number => value !== null);
  const criticalCases = cases.filter((item) => item.expectedStatus === "CRITICAL_LATE");
  const warningLeads = cases
    .map((item) => item.warningLeadWorkingDays)
    .filter((value): value is number => value !== null);
  const healthyCases = cases.filter(
    (item) => item.expectedDelayWorkingDays !== null && item.expectedDelayWorkingDays <= 0,
  );
  const recoveryCases = cases.filter((item) => item.recoveryExpected);
  const metrics = {
    finishMaeWorkingDays: finishErrors.reduce((sum, value) => sum + value, 0) / finishErrors.length,
    criticalDelayRecall:
      criticalCases.filter((item) => item.predictedStatus === "CRITICAL_LATE").length /
      criticalCases.length,
    averageEarlyWarningWorkingDays:
      warningLeads.reduce((sum, value) => sum + value, 0) / warningLeads.length,
    falseAlertRate:
      healthyCases.filter((item) => item.predictedStatus !== "ON_TRACK").length /
      healthyCases.length,
    sourceCoverage: cases.filter((item) => item.sourceComplete).length / cases.length,
    deterministicReplayRate: cases.filter((item) => item.deterministicReplay).length / cases.length,
    recoveryCoverage:
      recoveryCases.filter((item) => item.recoveryCreated).length / recoveryCases.length,
    baselineMutationCount: cases.filter((item) => item.baselineChanged).length,
  };
  const thresholds = {
    minimumCaseCount: 24 as const,
    maximumFinishMaeWorkingDays: 7 as const,
    minimumCriticalDelayRecall: 0.9 as const,
    minimumAverageEarlyWarningWorkingDays: 5 as const,
    maximumFalseAlertRate: 0.1 as const,
    requiredSourceCoverage: 1 as const,
    requiredDeterministicReplayRate: 1 as const,
    minimumRecoveryCoverage: 0.9 as const,
    maximumBaselineMutationCount: 0 as const,
  };
  return {
    schemaVersion: 1,
    evaluationType: "BUILDWATCH_V22_OPERATIONAL_FORECAST",
    generatedAt: benchmarkGeneratedAt,
    seed: "buildwatch-v22-phase5-answer-key-v1",
    caseCount: cases.length,
    metrics,
    thresholds,
    cases,
    pass:
      cases.length >= thresholds.minimumCaseCount &&
      cases.every((item) => item.pass) &&
      metrics.finishMaeWorkingDays <= thresholds.maximumFinishMaeWorkingDays &&
      metrics.criticalDelayRecall >= thresholds.minimumCriticalDelayRecall &&
      metrics.averageEarlyWarningWorkingDays >= thresholds.minimumAverageEarlyWarningWorkingDays &&
      metrics.falseAlertRate <= thresholds.maximumFalseAlertRate &&
      metrics.sourceCoverage === thresholds.requiredSourceCoverage &&
      metrics.deterministicReplayRate === thresholds.requiredDeterministicReplayRate &&
      metrics.recoveryCoverage >= thresholds.minimumRecoveryCoverage &&
      metrics.baselineMutationCount === thresholds.maximumBaselineMutationCount,
  };
}

export function renderOperationalForecastEvaluationMarkdown(
  report: OperationalForecastEvaluationReport,
): string {
  const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
  const rows = report.cases.map(
    (item) =>
      `| ${item.caseId} | ${item.scenario} | ${item.expectedStatus} | ${item.predictedStatus} | ${item.finishAbsoluteErrorWorkingDays ?? "n/a"} | ${item.warningLeadWorkingDays ?? "n/a"} | ${item.pass ? "PASS" : "FAIL"} |`,
  );
  return `# BuildWatch v2.2 Phase 5 Forecast Evaluation

- Gate: **${report.pass ? "PASS" : "FAIL"}**
- Cases: **${report.caseCount}**
- Finish MAE: **${report.metrics.finishMaeWorkingDays.toFixed(2)} working days**
- Critical-delay recall: **${percent(report.metrics.criticalDelayRecall)}**
- Average early warning: **${report.metrics.averageEarlyWarningWorkingDays.toFixed(2)} working days**
- False-alert rate: **${percent(report.metrics.falseAlertRate)}**
- Source coverage: **${percent(report.metrics.sourceCoverage)}**
- Deterministic replay: **${percent(report.metrics.deterministicReplayRate)}**
- Recovery coverage: **${percent(report.metrics.recoveryCoverage)}**
- Baseline mutations: **${report.metrics.baselineMutationCount}**

| Case | Scenario | Expected | Predicted | Finish error | Warning lead | Result |
|---|---|---:|---:|---:|---:|---:|
${rows.join("\n")}
`;
}
