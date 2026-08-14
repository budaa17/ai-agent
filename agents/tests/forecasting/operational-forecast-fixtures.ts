import type {
  BuildWatchSourceReference,
  OperationalPlanningSnapshotV1,
} from "../../src/contracts/index.js";
import {
  operationalForecastRequestV1Schema,
  type OperationalForecastRequestV1,
} from "../../src/forecasting/index.js";
import {
  appliedProgressVerificationV1Schema,
  applyApprovedProgressVerification,
  approveProgressVerificationDraft,
  generateProgressVerification,
  type AppliedProgressVerificationV1,
} from "../../src/verification/index.js";
import {
  buildApprovedBaselineCommand,
  buildOperationalPlanningSnapshot,
  buildV22Source,
  buildWatchV22ProjectId,
  buildWatchV22TenantId,
} from "../contracts/buildwatch-v22-fixtures.js";
import { buildProgressVerificationRequest } from "../verification/progress-verification-fixtures.js";

function shiftedFixture<T>(value: T, date: string, identifierSuffix: string): T {
  return JSON.parse(
    JSON.stringify(value)
      .replaceAll("2026-08-01", date)
      .replaceAll("phase4-", `phase5-${identifierSuffix}-`),
  ) as T;
}

function baseAppliedProgress(): AppliedProgressVerificationV1 {
  const request = buildProgressVerificationRequest();
  const result = generateProgressVerification(request);
  const command = approveProgressVerificationDraft({
    schemaVersion: 1,
    requestType: "APPROVE_PROGRESS_VERIFICATION_DRAFT",
    commandId: "phase4-approve-command-001",
    idempotencyKey: "phase4-approve-idempotency-001",
    progressVerificationVersionId: "phase4-verification-version-001",
    version: 1,
    supersedesVersionId: null,
    draft: result.draft,
    approvedContent: structuredClone(result.draft.content),
    decision: {
      decisionId: "phase4-manager-decision-001",
      action: "APPROVE",
      reviewerId: "user-project-manager",
      reviewerRole: "PROJECT_MANAGER",
      decidedAt: "2026-08-01T14:00:00.000Z",
      reason: null,
      correctedFieldPaths: [],
    },
  });
  return applyApprovedProgressVerification({
    schemaVersion: 1,
    requestType: "APPLY_APPROVED_PROGRESS_VERIFICATION",
    command,
    approvedActual: request.approvedActual,
    appliedBy: "verification-worker",
    appliedAt: "2026-08-01T15:00:00.000Z",
  });
}

export function buildAppliedProgressSample(
  date: string,
  quantity: number,
  options: {
    identifierSuffix?: string;
    laborHours?: number | null;
    included?: boolean;
    exclusionReason?: "UNVERIFIABLE" | "NO_VERIFIED_QUANTITY" | "ZERO_QUANTITY" | null;
  } = {},
): AppliedProgressVerificationV1 {
  const suffix = options.identifierSuffix ?? date;
  const applied = shiftedFixture(baseAppliedProgress(), date, suffix);
  const sample = applied.productivitySamples[0]!;
  sample.quantity =
    options.exclusionReason === "NO_VERIFIED_QUANTITY"
      ? null
      : {
          value: String(quantity),
          unit: "m2",
          sourceRefs: sample.quantity?.sourceRefs ?? sample.sourceRefs,
        };
  sample.laborHours =
    options.laborHours === undefined
      ? "48"
      : options.laborHours === null
        ? null
        : String(options.laborHours);
  sample.included = options.included ?? options.exclusionReason == null;
  sample.exclusionReason = options.exclusionReason ?? null;
  const history = applied.progressHistory[0]!;
  history.verifiedQuantity = sample.quantity;
  history.forecastEligible = sample.included;
  const variance = applied.dailyVariances[0]!;
  variance.verifiedQuantity = sample.quantity;
  const forecastInput = applied.forecastInputs[0]!;
  forecastInput.verifiedQuantity = sample.quantity;
  forecastInput.included = sample.included;
  forecastInput.exclusionReason =
    options.exclusionReason === "ZERO_QUANTITY"
      ? "NO_VERIFIED_QUANTITY"
      : (options.exclusionReason ?? null);
  return appliedProgressVerificationV1Schema.parse(applied);
}

function forecastSource(
  sourceRefId: string,
  sourceType: BuildWatchSourceReference["sourceType"] = "SYSTEM_CALCULATION",
): BuildWatchSourceReference {
  return buildV22Source(sourceRefId, {
    sourceType,
    sourceId: `source-${sourceRefId}`,
    sourceVersionId: "phase5-source-version-001",
    asOf: "2026-01-01T00:00:00.000Z",
  });
}

function normalizeOperationalSnapshot(
  snapshot: OperationalPlanningSnapshotV1,
  asOfDate: string,
): void {
  snapshot.asOf = `${asOfDate}T08:00:00.000Z`;
  snapshot.crews[0]!.headcount = 6;
  snapshot.crews[0]!.shiftStart = "08:00";
  snapshot.crews[0]!.shiftEnd = "16:00";
  snapshot.materials[0]!.asOf = `${asOfDate}T08:00:00.000Z`;
  snapshot.weatherConstraints = [];
}

export function buildOperationalForecastRequest(
  overrides: Partial<OperationalForecastRequestV1> = {},
): OperationalForecastRequestV1 {
  const asOfDate = "2026-08-15";
  const operationalSnapshot = buildOperationalPlanningSnapshot();
  normalizeOperationalSnapshot(operationalSnapshot, asOfDate);
  const policySource = forecastSource("phase5-forecast-policy", "CATALOG_VERSION");
  const normSource = forecastSource("phase5-productivity-norm", "CATALOG_VERSION");
  const recoverySource = forecastSource("phase5-recovery-catalog", "CATALOG_VERSION");
  const request: OperationalForecastRequestV1 = {
    schemaVersion: 1,
    requestType: "A5_OPERATIONAL_FORECAST",
    requestId: "phase5-forecast-request-001",
    idempotencyKey: "phase5-forecast-idempotency-001",
    tenantId: buildWatchV22TenantId,
    projectId: buildWatchV22ProjectId,
    asOfDate,
    approvedBaseline: buildApprovedBaselineCommand().approvedVersion,
    operationalSnapshot,
    appliedProgress: [
      buildAppliedProgressSample("2026-08-13", 10),
      buildAppliedProgressSample("2026-08-14", 10),
      buildAppliedProgressSample("2026-08-15", 10),
    ],
    productivityNorms: [
      {
        normId: "productivity-norm-masonry-001",
        normVersionId: "productivity-norm-masonry-v1",
        tenantId: buildWatchV22TenantId,
        projectId: buildWatchV22ProjectId,
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
        approvedBy: "user-project-manager",
        approvedAt: "2026-01-01T01:00:00.000Z",
        sourceRefs: [normSource],
      },
    ],
    learningAdjustments: [],
    outlierReviews: [],
    recoveryOptions: [
      {
        optionId: "recovery-add-crew",
        optionVersionId: "recovery-add-crew-v1",
        actionType: "ADD_CREW",
        applicableWorkClassCode: "MASONRY",
        productivityMultiplier: "1.5",
        fixedWorkingDaysReduction: null,
        additionalCostMnt: {
          value: "500000.00",
          currency: "MNT",
          sourceRefs: [recoverySource],
        },
        requiredResourceIds: ["crew-mason-002"],
        risks: ["Site congestion"],
        effectiveFrom: "2026-01-01",
        sourceRefs: [recoverySource],
      },
      {
        optionId: "recovery-parallelize",
        optionVersionId: "recovery-parallelize-v1",
        actionType: "PARALLELIZE_WORK",
        applicableWorkClassCode: "MASONRY",
        productivityMultiplier: "2",
        fixedWorkingDaysReduction: null,
        additionalCostMnt: {
          value: "250000.00",
          currency: "MNT",
          sourceRefs: [recoverySource],
        },
        requiredResourceIds: [],
        risks: ["Zone congestion"],
        effectiveFrom: "2026-01-01",
        sourceRefs: [recoverySource],
      },
      {
        optionId: "recovery-expedite-material",
        optionVersionId: "recovery-expedite-material-v1",
        actionType: "EXPEDITE_MATERIAL",
        applicableWorkClassCode: "MASONRY",
        productivityMultiplier: null,
        fixedWorkingDaysReduction: 2,
        additionalCostMnt: {
          value: "300000.00",
          currency: "MNT",
          sourceRefs: [recoverySource],
        },
        requiredResourceIds: ["material-001"],
        risks: ["Premium freight cost"],
        effectiveFrom: "2026-01-01",
        sourceRefs: [recoverySource],
      },
    ],
    policy: {
      schemaVersion: 1,
      policyType: "OPERATIONAL_FORECAST_POLICY",
      policyId: "phase5-forecast-policy",
      policyVersionId: "phase5-forecast-policy-v1",
      version: 1,
      tenantId: buildWatchV22TenantId,
      projectId: buildWatchV22ProjectId,
      effectiveFrom: "2026-01-01",
      approvedBy: "user-project-manager",
      approvedAt: "2026-01-01T01:00:00.000Z",
      minimumValidSamples: 3,
      outlierMethod: "MAD_REVIEW_ONLY",
      outlierThresholdMad: "3.5",
      blockedDayHandling: "EXCLUDE",
      fallbackMethod: "APPROVED_NORM_THEN_BASELINE_RATE",
      windowWeights: {
        threeDay: 0.5,
        sevenDay: 0.3,
        fourteenDay: 0.2,
      },
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
      maximumRecoveryScenarios: 5,
      sourceRefs: [policySource],
    },
    generatedAt: `${asOfDate}T16:00:00.000Z`,
    ...overrides,
  };
  return operationalForecastRequestV1Schema.parse(request);
}
