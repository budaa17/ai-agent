import { createHash } from "node:crypto";
import {
  operationalForecastSnapshotV1Schema,
  recoveryProposalDraftV1Schema,
  rollingProductivitySnapshotV1Schema,
  type BuildWatchCanonicalUnit,
  type BuildWatchSourceReference,
  type OperationalForecastSnapshotV1,
  type RecoveryProposalDraftV1,
  type RollingProductivitySnapshotV1,
} from "../contracts/index.js";
import {
  addWorkingDays,
  compareIsoDates,
  isWorkingDay,
  nextWorkingDay,
  previousWorkingDay,
  workingDaysBetween,
  type ProductionCalendar,
} from "../production-analysis/calendar.js";
import {
  dedupeSourceRefs,
  formatPlanningDecimal,
  stableStringify,
} from "../planning/deterministic.js";
import {
  operationalForecastRequestV1Schema,
  operationalForecastResultV1Schema,
  type ApprovedProductivityNormV1,
  type OperationalForecastRequestV1,
  type OperationalForecastResultV1,
  type ProductivitySampleCalculationV1,
  type WorkItemForecastCalculationV1,
} from "./operational-forecast-contracts.js";

type OperationalWorkItem = OperationalForecastRequestV1["operationalSnapshot"]["workItems"][number];
type AppliedProgress = OperationalForecastRequestV1["appliedProgress"][number];
type AppliedProductivitySample = AppliedProgress["productivitySamples"][number];
type RollingWorkItem = RollingProductivitySnapshotV1["workItems"][number];
type RollingWindow = RollingWorkItem["windows"][number];
type ForecastWorkItem = OperationalForecastSnapshotV1["workItems"][number];
type ForecastConfidenceFactor = ForecastWorkItem["confidenceFactors"][number];
type ForecastDriver = ForecastWorkItem["drivers"][number];
type ForecastStatus = OperationalForecastSnapshotV1["status"];
type AdjustmentFactor = WorkItemForecastCalculationV1["factors"][number];
type SampleExclusionReason = RollingWorkItem["samples"][number]["exclusionReason"];

type PreparedProductivity = {
  rolling: RollingWorkItem;
  calculations: ProductivitySampleCalculationV1[];
  norm: ApprovedProductivityNormV1 | null;
  baselineRate: number | null;
  baselineRateSources: BuildWatchSourceReference[];
};

type ForecastState = {
  workItem: OperationalWorkItem;
  productivity: PreparedProductivity;
  factors: AdjustmentFactor[];
  confidence: number;
  confidenceFactors: ForecastConfidenceFactor[];
  adjustedProductivity: number | null;
  remainingDurationWorkingDays: number | null;
  ownProjectedStart: string | null;
  ownProjectedFinish: string | null;
  projectedStart: string | null;
  projectedFinish: string | null;
  dependencySources: BuildWatchSourceReference[];
};

const rollingWindows = [3, 7, 14] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareIdentifiers(left: string, right: string): number {
  return left.localeCompare(right);
}

function canonicalRequest(request: OperationalForecastRequestV1): OperationalForecastRequestV1 {
  return {
    ...request,
    approvedBaseline: {
      ...request.approvedBaseline,
      content: {
        ...request.approvedBaseline.content,
        activities: [...request.approvedBaseline.content.activities].sort((left, right) =>
          compareIdentifiers(left.activityId, right.activityId),
        ),
        dependencies: [...request.approvedBaseline.content.dependencies].sort((left, right) =>
          compareIdentifiers(left.dependencyId, right.dependencyId),
        ),
      },
    },
    operationalSnapshot: {
      ...request.operationalSnapshot,
      workItems: [...request.operationalSnapshot.workItems].sort((left, right) =>
        compareIdentifiers(left.workItemId, right.workItemId),
      ),
      crews: [...request.operationalSnapshot.crews].sort((left, right) =>
        compareIdentifiers(left.crewId, right.crewId),
      ),
      equipment: [...request.operationalSnapshot.equipment].sort((left, right) =>
        compareIdentifiers(left.equipmentId, right.equipmentId),
      ),
      materials: [...request.operationalSnapshot.materials].sort((left, right) =>
        compareIdentifiers(left.materialId, right.materialId),
      ),
      zones: [...request.operationalSnapshot.zones].sort((left, right) =>
        compareIdentifiers(left.zoneCode, right.zoneCode),
      ),
      inspections: [...request.operationalSnapshot.inspections].sort((left, right) =>
        compareIdentifiers(left.inspectionId, right.inspectionId),
      ),
      blockers: [...request.operationalSnapshot.blockers].sort((left, right) =>
        compareIdentifiers(left.blockerId, right.blockerId),
      ),
      weatherConstraints: [...request.operationalSnapshot.weatherConstraints].sort((left, right) =>
        compareIdentifiers(left.weatherConstraintId, right.weatherConstraintId),
      ),
      approvedActuals: [...request.operationalSnapshot.approvedActuals].sort((left, right) =>
        compareIdentifiers(left.actualId, right.actualId),
      ),
    },
    appliedProgress: [...request.appliedProgress].sort(
      (left, right) =>
        left.reportDate.localeCompare(right.reportDate) ||
        compareIdentifiers(left.applyId, right.applyId),
    ),
    productivityNorms: [...request.productivityNorms].sort((left, right) =>
      compareIdentifiers(left.normId, right.normId),
    ),
    learningAdjustments: [...request.learningAdjustments].sort(
      (left, right) =>
        left.effectiveFrom.localeCompare(right.effectiveFrom) ||
        compareIdentifiers(left.adjustmentId, right.adjustmentId),
    ),
    outlierReviews: [...request.outlierReviews].sort(
      (left, right) =>
        left.reviewedAt.localeCompare(right.reviewedAt) ||
        compareIdentifiers(left.reviewId, right.reviewId),
    ),
    recoveryOptions: [...request.recoveryOptions].sort((left, right) =>
      compareIdentifiers(left.optionId, right.optionId),
    ),
  };
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Forecast money must be a finite nonnegative number");
  }
  return value.toFixed(2);
}

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function boundedSources(
  sources: readonly BuildWatchSourceReference[],
  maximum = 100,
): BuildWatchSourceReference[] {
  return dedupeSourceRefs(sources).slice(0, maximum);
}

function calculationSource(
  request: OperationalForecastRequestV1,
  fieldPath: string,
): BuildWatchSourceReference {
  const digest = sha256(fieldPath).slice(0, 24);
  return {
    sourceRefId: `source-a5-forecast-${request.asOfDate}-${digest}`,
    tenantId: request.tenantId,
    projectId: request.projectId,
    sourceType: "SYSTEM_CALCULATION",
    sourceId: `a5-operational-forecast-${request.asOfDate}`,
    sourceVersionId: request.policy.policyVersionId,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath,
    region: null,
    asOf: request.generatedAt,
    sha256: null,
  };
}

function calendarFromRequest(request: OperationalForecastRequestV1): ProductionCalendar {
  return {
    workingWeekdays: request.operationalSnapshot.calendar.workingWeekdays,
    holidays: request.operationalSnapshot.calendar.holidays,
  };
}

function quantity(
  value: number,
  unit: BuildWatchCanonicalUnit,
  sources: readonly BuildWatchSourceReference[],
) {
  return {
    value: formatPlanningDecimal(Math.max(0, value)),
    unit,
    sourceRefs: boundedSources(sources),
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint]!;
  }
  return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
}

function outlierFlags(
  values: readonly { sampleId: string; value: number }[],
  threshold: number,
): ReadonlySet<string> {
  if (values.length < 3) {
    return new Set();
  }
  const center = median(values.map((item) => item.value));
  const absoluteDeviations = values.map((item) => Math.abs(item.value - center));
  const deviationMedian = median(absoluteDeviations);
  return new Set(
    values
      .filter((item) =>
        deviationMedian === 0
          ? Math.abs(item.value - center) > 0
          : Math.abs(item.value - center) / deviationMedian > threshold,
      )
      .map((item) => item.sampleId),
  );
}

function shiftHours(start: string, end: string): number {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startTotal = startHour! * 60 + startMinute!;
  let endTotal = endHour! * 60 + endMinute!;
  if (endTotal <= startTotal) {
    endTotal += 24 * 60;
  }
  return (endTotal - startTotal) / 60;
}

function clampFactor(value: number): number {
  return Math.min(3, Math.max(0, value));
}

function activeBlockers(
  request: OperationalForecastRequestV1,
  workItemId: string,
  date = request.asOfDate,
) {
  return request.operationalSnapshot.blockers.filter(
    (blocker) =>
      blocker.workItemId === workItemId &&
      blocker.approved &&
      blocker.startedOn <= date &&
      (blocker.resolvedOn === null || blocker.resolvedOn > date),
  );
}

function findNorm(
  request: OperationalForecastRequestV1,
  workItem: OperationalWorkItem,
): ApprovedProductivityNormV1 | null {
  return (
    request.productivityNorms.find(
      (norm) => norm.workClassCode === workItem.workClassCode && norm.unit === workItem.unit,
    ) ?? null
  );
}

function baselineRate(
  request: OperationalForecastRequestV1,
  workItem: OperationalWorkItem,
): { value: number | null; sources: BuildWatchSourceReference[] } {
  if (request.policy.fallbackMethod !== "APPROVED_NORM_THEN_BASELINE_RATE") {
    return { value: null, sources: [] };
  }
  const activity = request.approvedBaseline.content.activities.find(
    (candidate) => candidate.workItemId === workItem.workItemId,
  );
  if (activity === undefined || activity.unit !== workItem.unit) {
    return { value: null, sources: [] };
  }
  return {
    value: Number(activity.plannedQuantity.value) / activity.durationWorkingDays,
    sources: boundedSources([
      ...activity.plannedQuantity.sourceRefs,
      ...activity.sourceRefs,
      ...request.approvedBaseline.content.calendar.sourceRefs,
    ]),
  };
}

function latestReviewBySample(
  request: OperationalForecastRequestV1,
): ReadonlyMap<string, OperationalForecastRequestV1["outlierReviews"][number]> {
  const reviews = new Map<string, OperationalForecastRequestV1["outlierReviews"][number]>();
  for (const review of request.outlierReviews) {
    reviews.set(review.productivitySampleId, review);
  }
  return reviews;
}

type SampleCandidate = {
  applied: AppliedProgress;
  sample: AppliedProductivitySample;
  normalizedValue: number | null;
  normalizationFactor: number | null;
  preliminaryReason: SampleExclusionReason;
  sources: BuildWatchSourceReference[];
};

function collectProductivity(
  request: OperationalForecastRequestV1,
  workItem: OperationalWorkItem,
): PreparedProductivity {
  const norm = findNorm(request, workItem);
  const fallback = baselineRate(request, workItem);
  const calculation = calculationSource(
    request,
    `rollingProductivity.workItems.${workItem.workItemId}`,
  );
  const candidates: SampleCandidate[] = request.appliedProgress
    .flatMap((applied) =>
      applied.productivitySamples
        .filter((sample) => sample.workItemId === workItem.workItemId)
        .map((sample) => ({ applied, sample })),
    )
    .sort(
      (left, right) =>
        left.sample.reportDate.localeCompare(right.sample.reportDate) ||
        left.applied.appliedAt.localeCompare(right.applied.appliedAt) ||
        compareIdentifiers(left.sample.productivitySampleId, right.sample.productivitySampleId),
    )
    .map(({ applied, sample }) => {
      const sampleSources = boundedSources([
        ...(sample.quantity?.sourceRefs ?? []),
        ...sample.sourceRefs,
        ...applied.sourceRefs,
      ]);
      let preliminaryReason: SampleExclusionReason = null;
      let normalizedValue: number | null = null;
      let normalizationFactor: number | null = null;
      if (!sample.included) {
        preliminaryReason = sample.exclusionReason;
      } else if (sample.quantity === null) {
        preliminaryReason = "NO_VERIFIED_QUANTITY";
      } else if (sample.quantity.unit !== workItem.unit) {
        preliminaryReason = "WRONG_UNIT";
      } else if (Number(sample.quantity.value) <= 0) {
        preliminaryReason = "ZERO_QUANTITY";
      } else if (
        request.policy.blockedDayHandling === "EXCLUDE" &&
        activeBlockers(request, workItem.workItemId, sample.reportDate).length > 0
      ) {
        preliminaryReason = "BLOCKED_DAY_POLICY";
      } else {
        const referenceLaborHours =
          norm === null ? null : norm.referenceCrewHeadcount * norm.referenceShiftHours;
        normalizationFactor =
          referenceLaborHours === null || sample.laborHours === null
            ? 1
            : clampFactor(referenceLaborHours / Number(sample.laborHours));
        normalizedValue =
          request.policy.blockedDayHandling === "INCLUDE_AS_ZERO" &&
          activeBlockers(request, workItem.workItemId, sample.reportDate).length > 0
            ? 0
            : Number(sample.quantity.value) * normalizationFactor;
      }
      return {
        applied,
        sample,
        normalizedValue,
        normalizationFactor,
        preliminaryReason,
        sources: sampleSources,
      };
    });

  const latestByDate = new Map<string, string>();
  for (const candidate of candidates) {
    latestByDate.set(candidate.sample.reportDate, candidate.sample.productivitySampleId);
  }
  for (const candidate of candidates) {
    if (latestByDate.get(candidate.sample.reportDate) !== candidate.sample.productivitySampleId) {
      candidate.preliminaryReason = "DUPLICATE_EVIDENCE_ONLY";
      candidate.normalizedValue = null;
      candidate.normalizationFactor = null;
    }
  }

  const outliers = outlierFlags(
    candidates
      .filter(
        (candidate): candidate is SampleCandidate & { normalizedValue: number } =>
          candidate.preliminaryReason === null && candidate.normalizedValue !== null,
      )
      .map((candidate) => ({
        sampleId: candidate.sample.productivitySampleId,
        value: candidate.normalizedValue,
      })),
    Number(request.policy.outlierThresholdMad),
  );
  const reviews = latestReviewBySample(request);
  const calculations: ProductivitySampleCalculationV1[] = [];
  const samples: RollingWorkItem["samples"] = [];

  for (const candidate of candidates) {
    const sampleId = candidate.sample.productivitySampleId;
    const review = reviews.get(sampleId) ?? null;
    const outlierCandidate = outliers.has(sampleId);
    const reviewerExcluded = review?.decision === "EXCLUDE";
    const exclusionReason: SampleExclusionReason = reviewerExcluded
      ? "REVIEWER_EXCLUDED_OUTLIER"
      : candidate.preliminaryReason;
    const included = exclusionReason === null;
    const sources = boundedSources([
      ...candidate.sources,
      ...(review?.sourceRefs ?? []),
      calculation,
    ]);
    const rawQuantity =
      candidate.sample.quantity === null
        ? null
        : quantity(
            Number(candidate.sample.quantity.value),
            candidate.sample.quantity.unit,
            candidate.sample.quantity.sourceRefs,
          );
    const normalizedQuantity =
      candidate.normalizedValue === null
        ? null
        : quantity(candidate.normalizedValue, workItem.unit, sources);
    samples.push({
      sampleId,
      workItemId: workItem.workItemId,
      reportDate: candidate.sample.reportDate,
      approvedVerificationId: candidate.applied.progressVerificationVersionId,
      quantity: included ? normalizedQuantity : rawQuantity,
      included,
      exclusionReason,
      outlierCandidate,
      sourceRefs: sources,
    });
    calculations.push({
      productivitySampleId: sampleId,
      workItemId: workItem.workItemId,
      reportDate: candidate.sample.reportDate,
      rawQuantity,
      normalizedQuantity,
      laborHours: candidate.sample.laborHours,
      normalizationFactor:
        candidate.normalizationFactor === null
          ? null
          : formatPlanningDecimal(candidate.normalizationFactor),
      outlierCandidate,
      reviewerDecision: review?.decision ?? null,
      included,
      exclusionReason,
      sourceRefs: sources,
    });
  }

  const calendar = calendarFromRequest(request);
  const windowEnd = previousWorkingDay(request.asOfDate, calendar, true);
  const windows: RollingWindow[] = rollingWindows.map((windowWorkingDays) => {
    const windowStart = addWorkingDays(windowEnd, -(windowWorkingDays - 1), calendar);
    const available = samples.filter(
      (sample) =>
        sample.included &&
        sample.quantity !== null &&
        compareIsoDates(sample.reportDate, windowStart) >= 0 &&
        compareIsoDates(sample.reportDate, windowEnd) <= 0 &&
        isWorkingDay(sample.reportDate, calendar),
    );
    const sampleIds = available.map((sample) => sample.sampleId);
    const coveragePercent = round(
      Math.min(
        100,
        (new Set(available.map((sample) => sample.reportDate)).size / windowWorkingDays) * 100,
      ),
      2,
    );
    let method: RollingWindow["method"];
    let productivityPerWorkingDay: RollingWindow["productivityPerWorkingDay"];
    let confidence: number;
    let sources: BuildWatchSourceReference[];
    if (available.length >= request.policy.minimumValidSamples) {
      const average =
        available.reduce((sum, sample) => sum + Number(sample.quantity!.value), 0) /
        available.length;
      method = "ROLLING_ACTUAL";
      sources = boundedSources([...available.flatMap((sample) => sample.sourceRefs), calculation]);
      productivityPerWorkingDay = quantity(average, workItem.unit, sources);
      confidence = round(0.5 + 0.5 * Math.min(1, coveragePercent / 100));
    } else if (norm !== null) {
      method = "COLD_START_NORM";
      sources = boundedSources([
        ...norm.productivityPerWorkingDay.sourceRefs,
        ...norm.sourceRefs,
        ...available.flatMap((sample) => sample.sourceRefs),
        calculation,
      ]);
      productivityPerWorkingDay = quantity(
        Number(norm.productivityPerWorkingDay.value),
        workItem.unit,
        sources,
      );
      confidence = round(
        Math.min(0.6, 0.35 + 0.25 * (available.length / request.policy.minimumValidSamples)),
      );
    } else if (fallback.value !== null) {
      method = "BASELINE_RATE_FALLBACK";
      sources = boundedSources([
        ...fallback.sources,
        ...available.flatMap((sample) => sample.sourceRefs),
        calculation,
      ]);
      productivityPerWorkingDay = quantity(fallback.value, workItem.unit, sources);
      confidence = round(
        Math.min(0.5, 0.25 + 0.25 * (available.length / request.policy.minimumValidSamples)),
      );
    } else {
      method = "INSUFFICIENT_DATA";
      sources = boundedSources([
        ...available.flatMap((sample) => sample.sourceRefs),
        ...workItem.sourceRefs,
        calculation,
      ]);
      productivityPerWorkingDay = null;
      confidence = round(0.2 * (available.length / request.policy.minimumValidSamples));
    }
    return {
      windowWorkingDays,
      method,
      sampleIds,
      validSampleCount: sampleIds.length,
      coveragePercent,
      productivityPerWorkingDay,
      confidence,
      sourceRefs: sources,
    };
  });

  const weighted = windows
    .map((window) => ({
      window,
      weight:
        window.windowWorkingDays === 3
          ? request.policy.windowWeights.threeDay
          : window.windowWorkingDays === 7
            ? request.policy.windowWeights.sevenDay
            : request.policy.windowWeights.fourteenDay,
    }))
    .filter(
      (
        item,
      ): item is typeof item & {
        window: RollingWindow & {
          productivityPerWorkingDay: NonNullable<RollingWindow["productivityPerWorkingDay"]>;
        };
      } => item.window.productivityPerWorkingDay !== null && item.weight > 0,
    );
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  const weightedCurrent =
    totalWeight === 0
      ? null
      : weighted.reduce(
          (sum, item) => sum + Number(item.window.productivityPerWorkingDay.value) * item.weight,
          0,
        ) / totalWeight;
  const selectedWindow =
    windows.find((window) => window.method === "ROLLING_ACTUAL") ??
    windows.find((window) => window.method === "COLD_START_NORM") ??
    windows.find((window) => window.method === "BASELINE_RATE_FALLBACK") ??
    null;
  const selectedSources = boundedSources([
    ...weighted.flatMap((item) => item.window.sourceRefs),
    calculation,
  ]);

  return {
    rolling: {
      workItemId: workItem.workItemId,
      unit: workItem.unit,
      samples,
      windows,
      selectedWindowWorkingDays: selectedWindow?.windowWorkingDays ?? null,
      selectedProductivity:
        weightedCurrent === null ? null : quantity(weightedCurrent, workItem.unit, selectedSources),
    },
    calculations,
    norm,
    baselineRate: fallback.value,
    baselineRateSources: fallback.sources,
  };
}

function factor(
  name: AdjustmentFactor["factor"],
  value: number,
  sources: readonly BuildWatchSourceReference[],
): AdjustmentFactor {
  return {
    factor: name,
    value: formatPlanningDecimal(clampFactor(value)),
    sourceRefs: boundedSources(sources),
  };
}

function resourceFactors(
  request: OperationalForecastRequestV1,
  workItem: OperationalWorkItem,
  productivity: PreparedProductivity,
): AdjustmentFactor[] {
  const calculation = calculationSource(
    request,
    `workItemCalculations.${workItem.workItemId}.factors`,
  );
  const selected = productivity.rolling.selectedProductivity;
  const currentProductivity = selected === null ? null : Number(selected.value);
  const normValue =
    productivity.norm === null ? null : Number(productivity.norm.productivityPerWorkingDay.value);
  const paceFactor =
    currentProductivity === null || normValue === null || normValue <= 0
      ? 1
      : currentProductivity / normValue;
  const matchingCrews = request.operationalSnapshot.crews.filter(
    (crew) =>
      workItem.requiredCrewType !== null &&
      crew.crewType === workItem.requiredCrewType &&
      crew.available &&
      crew.availableFrom <= request.asOfDate &&
      crew.availableTo >= request.asOfDate,
  );
  const totalHeadcount = matchingCrews.reduce((sum, crew) => sum + crew.headcount, 0);
  const crewFactor =
    workItem.requiredCrewType === null
      ? 1
      : productivity.norm === null
        ? matchingCrews.length > 0
          ? 1
          : 0
        : totalHeadcount / productivity.norm.referenceCrewHeadcount;
  const averageShiftHours =
    totalHeadcount === 0
      ? null
      : matchingCrews.reduce(
          (sum, crew) => sum + shiftHours(crew.shiftStart, crew.shiftEnd) * crew.headcount,
          0,
        ) / totalHeadcount;
  const shiftFactor =
    averageShiftHours === null
      ? workItem.requiredCrewType === null
        ? 1
        : 0
      : averageShiftHours /
        (productivity.norm?.referenceShiftHours ??
          request.operationalSnapshot.calendar.workHoursPerDay);

  const requiredEquipment = workItem.requiredEquipmentIds.map((equipmentId) =>
    request.operationalSnapshot.equipment.find(
      (equipment) => equipment.equipmentId === equipmentId,
    ),
  );
  const unavailableEquipment = requiredEquipment.filter(
    (equipment) =>
      equipment === undefined ||
      !equipment.available ||
      equipment.availableFrom > request.asOfDate ||
      equipment.availableTo < request.asOfDate,
  );
  const equipmentCapacityFactor =
    currentProductivity === null || currentProductivity <= 0
      ? 1
      : Math.min(
          1,
          ...requiredEquipment
            .filter(
              (equipment): equipment is NonNullable<typeof equipment> =>
                equipment !== undefined && equipment.capacityPerShift.unit === workItem.unit,
            )
            .map((equipment) => Number(equipment.capacityPerShift.value) / currentProductivity),
        );
  const equipmentFactor =
    workItem.requiredEquipmentIds.length === 0
      ? 1
      : unavailableEquipment.length > 0
        ? Number(request.policy.unavailableEquipmentFactor)
        : equipmentCapacityFactor;

  const materialRatios = workItem.requiredMaterials.map((requirement) => {
    const availability = request.operationalSnapshot.materials.find(
      (material) => material.materialId === requirement.materialId,
    );
    if (
      availability === undefined ||
      availability.availableQuantity.unit !== requirement.quantity.unit ||
      availability.reservedQuantity.unit !== requirement.quantity.unit
    ) {
      return 0;
    }
    const netAvailable = Math.max(
      0,
      Number(availability.availableQuantity.value) - Number(availability.reservedQuantity.value),
    );
    const required = Number(requirement.quantity.value);
    return required <= 0 ? 1 : Math.min(1, netAvailable / required);
  });
  const materialFactor =
    materialRatios.length === 0
      ? 1
      : Math.max(Number(request.policy.materialShortageFloorFactor), Math.min(...materialRatios));

  const forecastHorizonEnd = addWorkingDays(request.asOfDate, 13, calendarFromRequest(request));
  const restrictedWeather = request.operationalSnapshot.weatherConstraints.filter(
    (constraint) =>
      constraint.date >= request.asOfDate &&
      constraint.date <= forecastHorizonEnd &&
      constraint.restrictedWorkClassCodes.includes(workItem.workClassCode),
  );
  const weatherFactor =
    restrictedWeather.length === 0
      ? 1
      : 1 -
        Math.min(1, restrictedWeather.length / 14) *
          (1 - Number(request.policy.weatherRestrictedFactor));
  const blockers = activeBlockers(request, workItem.workItemId);
  const blockerFactor = blockers.length === 0 ? 1 : Number(request.policy.openBlockerFactor);
  const latestLearning = request.learningAdjustments
    .filter((adjustment) => adjustment.workItemId === workItem.workItemId)
    .at(-1);
  const learningFactor = latestLearning === undefined ? 1 : Number(latestLearning.factor);
  const calendarFactor = request.operationalSnapshot.calendar.workHoursPerDay / 8;

  const crewSources = boundedSources([
    ...matchingCrews.flatMap((crew) => crew.sourceRefs),
    ...(productivity.norm?.sourceRefs ?? []),
    calculation,
  ]);
  const equipmentSources = boundedSources([
    ...requiredEquipment.flatMap((equipment) => equipment?.sourceRefs ?? []),
    calculation,
  ]);
  const materialSources = boundedSources([
    ...workItem.requiredMaterials.flatMap((material) => material.quantity.sourceRefs),
    ...request.operationalSnapshot.materials
      .filter((material) =>
        workItem.requiredMaterials.some(
          (requirement) => requirement.materialId === material.materialId,
        ),
      )
      .flatMap((material) => material.sourceRefs),
    calculation,
  ]);

  return [
    factor("RECENT_PACE", paceFactor, [
      ...(selected?.sourceRefs ?? []),
      ...(productivity.norm?.sourceRefs ?? []),
      calculation,
    ]),
    factor("CREW_SIZE", crewFactor, crewSources),
    factor("SHIFT", shiftFactor, crewSources),
    factor("WEATHER", weatherFactor, [
      ...restrictedWeather.flatMap((constraint) => constraint.sourceRefs),
      calculation,
    ]),
    factor("LEARNING", learningFactor, [...(latestLearning?.sourceRefs ?? []), calculation]),
    factor("EQUIPMENT", equipmentFactor, equipmentSources),
    factor("MATERIAL", materialFactor, materialSources),
    factor("BLOCKER", blockerFactor, [
      ...blockers.flatMap((blocker) => blocker.sourceRefs),
      calculation,
    ]),
    factor("CALENDAR", calendarFactor, [
      ...request.operationalSnapshot.calendar.sourceRefs,
      calculation,
    ]),
  ];
}

function confidenceFactors(
  request: OperationalForecastRequestV1,
  workItem: OperationalWorkItem,
  productivity: PreparedProductivity,
): ForecastConfidenceFactor[] {
  const calculation = calculationSource(
    request,
    `forecast.workItems.${workItem.workItemId}.confidence`,
  );
  const calendar = calendarFromRequest(request);
  const end = previousWorkingDay(request.asOfDate, calendar, true);
  const start = addWorkingDays(end, -13, calendar);
  const relevantApplied = request.appliedProgress.filter(
    (applied) => applied.reportDate >= start && applied.reportDate <= end,
  );
  const workItemSamples = productivity.calculations;
  const validSamples = workItemSamples.filter((sample) => sample.included);
  const reportCoverage = Math.min(
    1,
    new Set(relevantApplied.map((applied) => applied.reportDate)).size / 14,
  );
  const quantityCoverage =
    workItemSamples.length === 0 ? 0 : validSamples.length / workItemSamples.length;
  const photoCoverage =
    workItemSamples.length === 0
      ? 0
      : workItemSamples.filter((sample) =>
          sample.sourceRefs.some((source) => source.sourceType === "PHOTO_EVIDENCE"),
        ).length / workItemSamples.length;
  const historyLength = Math.min(1, validSamples.length / 14);
  const blockerScore = Math.max(0, 1 - activeBlockers(request, workItem.workItemId).length / 3);
  const catalogScore =
    productivity.norm !== null ? 1 : productivity.baselineRate !== null ? 0.5 : 0;
  const workItemIds = new Set(request.operationalSnapshot.workItems.map((item) => item.workItemId));
  const validPredecessors = workItem.predecessorWorkItemIds.filter((id) =>
    workItemIds.has(id),
  ).length;
  const dependencyScore =
    workItem.predecessorWorkItemIds.length === 0
      ? 1
      : validPredecessors / workItem.predecessorWorkItemIds.length;
  const resourceChecks = [
    ...(workItem.requiredCrewType === null
      ? []
      : [
          request.operationalSnapshot.crews.some(
            (crew) => crew.crewType === workItem.requiredCrewType,
          ),
        ]),
    ...workItem.requiredEquipmentIds.map((equipmentId) =>
      request.operationalSnapshot.equipment.some(
        (equipment) => equipment.equipmentId === equipmentId,
      ),
    ),
    ...workItem.requiredMaterials.map((requirement) =>
      request.operationalSnapshot.materials.some(
        (material) => material.materialId === requirement.materialId,
      ),
    ),
  ];
  const resourceScore =
    resourceChecks.length === 0 ? 1 : resourceChecks.filter(Boolean).length / resourceChecks.length;
  const sampleSources = workItemSamples.flatMap((sample) => sample.sourceRefs);
  const factorInputs: Array<{
    factor: ForecastConfidenceFactor["factor"];
    score: number;
    weight: number;
    sources: BuildWatchSourceReference[];
  }> = [
    {
      factor: "APPROVED_REPORT_COVERAGE",
      score: reportCoverage,
      weight: request.policy.confidenceWeights.approvedReportCoverage,
      sources: [...relevantApplied.flatMap((applied) => applied.sourceRefs), calculation],
    },
    {
      factor: "VALID_QUANTITY_COVERAGE",
      score: quantityCoverage,
      weight: request.policy.confidenceWeights.validQuantityCoverage,
      sources: [...sampleSources, calculation],
    },
    {
      factor: "PHOTO_EVIDENCE_COVERAGE",
      score: photoCoverage,
      weight: request.policy.confidenceWeights.photoEvidenceCoverage,
      sources: [...sampleSources, calculation],
    },
    {
      factor: "PRODUCTIVITY_HISTORY_LENGTH",
      score: historyLength,
      weight: request.policy.confidenceWeights.productivityHistoryLength,
      sources: [...sampleSources, calculation],
    },
    {
      factor: "UNRESOLVED_BLOCKERS",
      score: blockerScore,
      weight: request.policy.confidenceWeights.unresolvedBlockers,
      sources: [
        ...activeBlockers(request, workItem.workItemId).flatMap((blocker) => blocker.sourceRefs),
        calculation,
      ],
    },
    {
      factor: "CATALOG_COMPLETENESS",
      score: catalogScore,
      weight: request.policy.confidenceWeights.catalogCompleteness,
      sources: [
        ...(productivity.norm?.sourceRefs ?? productivity.baselineRateSources),
        calculation,
      ],
    },
    {
      factor: "DEPENDENCY_COMPLETENESS",
      score: dependencyScore,
      weight: request.policy.confidenceWeights.dependencyCompleteness,
      sources: [...workItem.sourceRefs, calculation],
    },
    {
      factor: "RESOURCE_DATA_QUALITY",
      score: resourceScore,
      weight: request.policy.confidenceWeights.resourceDataQuality,
      sources: [
        ...request.operationalSnapshot.crews.flatMap((crew) => crew.sourceRefs),
        ...request.operationalSnapshot.equipment.flatMap((equipment) => equipment.sourceRefs),
        ...request.operationalSnapshot.materials.flatMap((material) => material.sourceRefs),
        calculation,
      ],
    },
  ];
  return factorInputs.map((input) => ({
    factor: input.factor,
    score: round(Math.min(1, Math.max(0, input.score))),
    weight: input.weight,
    sourceRefs: boundedSources(input.sources),
  }));
}

function weightedConfidence(factors: readonly ForecastConfidenceFactor[]): number {
  return round(factors.reduce((sum, item) => sum + item.score * item.weight, 0));
}

function topologicalWorkItemIds(workItems: readonly OperationalWorkItem[]): string[] {
  const ids = new Set(workItems.map((item) => item.workItemId));
  const incoming = new Map(workItems.map((item) => [item.workItemId, 0]));
  const successors = new Map(workItems.map((item) => [item.workItemId, [] as string[]]));
  for (const workItem of workItems) {
    for (const predecessorId of workItem.predecessorWorkItemIds) {
      if (!ids.has(predecessorId)) {
        throw new Error(`Forecast dependency references unknown work item: ${predecessorId}`);
      }
      incoming.set(workItem.workItemId, incoming.get(workItem.workItemId)! + 1);
      successors.get(predecessorId)!.push(workItem.workItemId);
    }
  }
  const ready = [...incoming.entries()]
    .filter(([, count]) => count === 0)
    .map(([workItemId]) => workItemId)
    .sort(compareIdentifiers);
  const result: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    result.push(current);
    for (const successorId of successors.get(current)!.sort(compareIdentifiers)) {
      const remaining = incoming.get(successorId)! - 1;
      incoming.set(successorId, remaining);
      if (remaining === 0) {
        ready.push(successorId);
        ready.sort(compareIdentifiers);
      }
    }
  }
  if (result.length !== workItems.length) {
    throw new Error("Forecast dependency graph contains a cycle");
  }
  return result;
}

function maximumDate(left: string, right: string): string {
  return compareIsoDates(left, right) >= 0 ? left : right;
}

function statusFromDelay(delay: number, request: OperationalForecastRequestV1): ForecastStatus {
  if (delay <= 0) {
    return "ON_TRACK";
  }
  if (delay <= request.policy.warningWorkingDays) {
    return "AT_RISK";
  }
  if (delay <= request.policy.criticalWorkingDays) {
    return "LIKELY_LATE";
  }
  return "CRITICAL_LATE";
}

function dependencyDefinition(
  request: OperationalForecastRequestV1,
  predecessorId: string,
  successorId: string,
) {
  const activityByWorkItem = new Map(
    request.approvedBaseline.content.activities.map((activity) => [activity.workItemId, activity]),
  );
  const predecessor = activityByWorkItem.get(predecessorId);
  const successor = activityByWorkItem.get(successorId);
  if (predecessor === undefined || successor === undefined) {
    return null;
  }
  return (
    request.approvedBaseline.content.dependencies.find(
      (dependency) =>
        dependency.predecessorActivityId === predecessor.activityId &&
        dependency.successorActivityId === successor.activityId,
    ) ?? null
  );
}

function dependencyStartConstraint(
  request: OperationalForecastRequestV1,
  predecessor: ForecastState,
  successorDuration: number,
  successorId: string,
): { start: string; sources: BuildWatchSourceReference[] } | null {
  if (predecessor.projectedStart === null || predecessor.projectedFinish === null) {
    return null;
  }
  const calendar = calendarFromRequest(request);
  const dependency = dependencyDefinition(request, predecessor.workItem.workItemId, successorId);
  const type = dependency?.type ?? "FINISH_TO_START";
  const lag = dependency?.lagWorkingDays ?? 0;
  let requiredStart: string;
  if (type === "FINISH_TO_START") {
    requiredStart = addWorkingDays(predecessor.projectedFinish, lag + 1, calendar);
  } else if (type === "START_TO_START") {
    requiredStart = addWorkingDays(predecessor.projectedStart, lag, calendar);
  } else {
    const requiredFinish =
      type === "FINISH_TO_FINISH"
        ? addWorkingDays(predecessor.projectedFinish, lag, calendar)
        : addWorkingDays(predecessor.projectedStart, lag, calendar);
    requiredStart = addWorkingDays(requiredFinish, -Math.max(0, successorDuration - 1), calendar);
  }
  return {
    start: requiredStart,
    sources: boundedSources([
      ...(dependency?.sourceRefs ?? predecessor.workItem.sourceRefs),
      calculationSource(request, `dependencies.${predecessor.workItem.workItemId}.${successorId}`),
    ]),
  };
}

function buildStates(
  request: OperationalForecastRequestV1,
  productivityByWorkItem: ReadonlyMap<string, PreparedProductivity>,
): Map<string, ForecastState> {
  const calendar = calendarFromRequest(request);
  const states = new Map<string, ForecastState>();
  for (const workItem of request.operationalSnapshot.workItems) {
    const productivity = productivityByWorkItem.get(workItem.workItemId)!;
    const factors = resourceFactors(request, workItem, productivity);
    const confidenceFactorValues = confidenceFactors(request, workItem, productivity);
    const confidence = weightedConfidence(confidenceFactorValues);
    const completed =
      workItem.status === "COMPLETED" ||
      workItem.status === "CANCELLED" ||
      Number(workItem.remainingQuantity.value) <= 0;
    const selected = productivity.rolling.selectedProductivity;
    const normValue =
      productivity.norm === null ? null : Number(productivity.norm.productivityPerWorkingDay.value);
    const selectedValue = selected === null ? null : Number(selected.value);
    const baseProductivity = normValue ?? selectedValue;
    const combinedFactor = factors.reduce((product, item) => product * Number(item.value), 1);
    const boundedFactor = Math.min(
      Number(request.policy.maximumAdjustedProductivityFactor),
      Math.max(Number(request.policy.minimumAdjustedProductivityFactor), combinedFactor),
    );
    const adjustedProductivity = completed
      ? Math.max(1, baseProductivity ?? productivity.baselineRate ?? 1)
      : baseProductivity === null || baseProductivity <= 0
        ? null
        : baseProductivity * boundedFactor;
    const duration = completed
      ? 0
      : adjustedProductivity === null
        ? null
        : Math.max(1, Math.ceil(Number(workItem.remainingQuantity.value) / adjustedProductivity));
    const start =
      duration === null
        ? null
        : completed
          ? workItem.plannedFinish
          : maximumDate(
              nextWorkingDay(request.asOfDate, calendar, true),
              nextWorkingDay(workItem.plannedStart, calendar, true),
            );
    const finish =
      duration === null || start === null
        ? null
        : duration === 0
          ? workItem.plannedFinish
          : addWorkingDays(start, duration - 1, calendar);
    states.set(workItem.workItemId, {
      workItem,
      productivity,
      factors,
      confidence,
      confidenceFactors: confidenceFactorValues,
      adjustedProductivity,
      remainingDurationWorkingDays: duration,
      ownProjectedStart: start,
      ownProjectedFinish: finish,
      projectedStart: start,
      projectedFinish: finish,
      dependencySources: [],
    });
  }

  for (const workItemId of topologicalWorkItemIds(request.operationalSnapshot.workItems)) {
    const state = states.get(workItemId)!;
    if (
      state.remainingDurationWorkingDays === null ||
      state.projectedStart === null ||
      state.projectedFinish === null ||
      state.remainingDurationWorkingDays === 0
    ) {
      continue;
    }
    let projectedStart = state.projectedStart;
    const dependencySources: BuildWatchSourceReference[] = [];
    let dependencyInsufficient = false;
    for (const predecessorId of state.workItem.predecessorWorkItemIds) {
      const predecessor = states.get(predecessorId)!;
      const constraint = dependencyStartConstraint(
        request,
        predecessor,
        state.remainingDurationWorkingDays,
        workItemId,
      );
      if (constraint === null) {
        dependencyInsufficient = true;
        break;
      }
      projectedStart = maximumDate(projectedStart, constraint.start);
      dependencySources.push(...constraint.sources);
    }
    state.dependencySources = boundedSources(dependencySources);
    if (dependencyInsufficient) {
      state.projectedStart = null;
      state.projectedFinish = null;
    } else {
      state.projectedStart = projectedStart;
      state.projectedFinish = addWorkingDays(
        projectedStart,
        state.remainingDurationWorkingDays - 1,
        calendar,
      );
    }
  }
  return states;
}

function driverImpact(duration: number, factorValue: number): number {
  if (Math.abs(factorValue - 1) <= 0.000001) {
    return 0;
  }
  if (factorValue <= 0) {
    return duration;
  }
  const adjustedDuration = Math.max(1, Math.ceil(duration / factorValue));
  return adjustedDuration - duration;
}

function factorDriverType(factorName: AdjustmentFactor["factor"]): ForecastDriver["type"] {
  switch (factorName) {
    case "CREW_SIZE":
    case "SHIFT":
      return "CREW";
    case "WEATHER":
      return "WEATHER";
    case "EQUIPMENT":
      return "EQUIPMENT";
    case "MATERIAL":
      return "MATERIAL";
    case "BLOCKER":
      return "BLOCKER";
    case "RECENT_PACE":
    case "LEARNING":
    case "CALENDAR":
      return "PRODUCTIVITY";
  }
}

function driversForState(
  request: OperationalForecastRequestV1,
  state: ForecastState,
): ForecastDriver[] {
  const calculation = calculationSource(
    request,
    `forecast.workItems.${state.workItem.workItemId}.drivers`,
  );
  if (state.remainingDurationWorkingDays === null || state.projectedFinish === null) {
    return [
      {
        driverId: `forecast-driver-${state.workItem.workItemId}-data-quality`,
        type: "DATA_QUALITY",
        workItemId: state.workItem.workItemId,
        summary: "Approved productivity history, norm, or dependency evidence is insufficient.",
        impactWorkingDays: { value: 0, sourceRefs: [calculation] },
        sourceRefs: boundedSources([...state.workItem.sourceRefs, calculation]),
      },
    ];
  }
  const drivers = state.factors
    .map((item) => ({
      item,
      impact: driverImpact(state.remainingDurationWorkingDays!, Number(item.value)),
    }))
    .filter(({ impact }) => impact !== 0)
    .map(({ item, impact }) => ({
      driverId: `forecast-driver-${state.workItem.workItemId}-${item.factor.toLowerCase()}`,
      type: factorDriverType(item.factor),
      workItemId: state.workItem.workItemId,
      summary: `${item.factor} factor changed the deterministic remaining-duration estimate.`,
      impactWorkingDays: {
        value: impact,
        sourceRefs: boundedSources([...item.sourceRefs, calculation]),
      },
      sourceRefs: boundedSources([...item.sourceRefs, calculation]),
    }));
  if (
    state.ownProjectedFinish !== null &&
    compareIsoDates(state.projectedFinish, state.ownProjectedFinish) > 0
  ) {
    const impact = workingDaysBetween(
      state.ownProjectedFinish,
      state.projectedFinish,
      calendarFromRequest(request),
      false,
    );
    drivers.push({
      driverId: `forecast-driver-${state.workItem.workItemId}-dependency`,
      type: "DEPENDENCY",
      workItemId: state.workItem.workItemId,
      summary: "Approved schedule dependencies moved the projected finish.",
      impactWorkingDays: {
        value: impact,
        sourceRefs: boundedSources([...state.dependencySources, calculation]),
      },
      sourceRefs: boundedSources([...state.dependencySources, calculation]),
    });
  }
  return drivers.sort((left, right) => compareIdentifiers(left.driverId, right.driverId));
}

function buildForecastWorkItems(
  request: OperationalForecastRequestV1,
  states: ReadonlyMap<string, ForecastState>,
): {
  workItems: ForecastWorkItem[];
  calculations: WorkItemForecastCalculationV1[];
} {
  const calendar = calendarFromRequest(request);
  const workItems: ForecastWorkItem[] = [];
  const calculations: WorkItemForecastCalculationV1[] = [];
  for (const sourceWorkItem of request.operationalSnapshot.workItems) {
    const state = states.get(sourceWorkItem.workItemId)!;
    const calculation = calculationSource(
      request,
      `forecast.workItems.${sourceWorkItem.workItemId}`,
    );
    const insufficient = state.projectedFinish === null;
    const delay = insufficient
      ? null
      : workingDaysBetween(sourceWorkItem.plannedFinish, state.projectedFinish!, calendar, false);
    const status: ForecastStatus =
      delay === null ? "INSUFFICIENT_DATA" : statusFromDelay(delay, request);
    const sources = boundedSources([
      ...sourceWorkItem.remainingQuantity.sourceRefs,
      ...sourceWorkItem.sourceRefs,
      ...state.factors.flatMap((item) => item.sourceRefs),
      ...state.dependencySources,
      calculation,
    ]);
    const drivers = driversForState(request, state);
    workItems.push({
      workItemId: sourceWorkItem.workItemId,
      remainingQuantity: sourceWorkItem.remainingQuantity,
      adjustedDailyProductivity:
        insufficient || state.adjustedProductivity === null
          ? null
          : quantity(state.adjustedProductivity, sourceWorkItem.unit, sources),
      remainingDurationWorkingDays:
        insufficient || state.remainingDurationWorkingDays === null
          ? null
          : { value: state.remainingDurationWorkingDays, sourceRefs: sources },
      projectedFinish: insufficient ? null : state.projectedFinish,
      delayWorkingDays: delay === null ? null : { value: delay, sourceRefs: sources },
      status,
      confidence: state.confidence,
      confidenceFactors: state.confidenceFactors,
      drivers,
      sourceRefs: sources,
    });
    calculations.push({
      calculationId: `forecast-calculation-${sourceWorkItem.workItemId}`,
      workItemId: sourceWorkItem.workItemId,
      approvedNorm: state.productivity.norm?.productivityPerWorkingDay ?? null,
      weightedCurrentProductivity: state.productivity.rolling.selectedProductivity,
      factors: state.factors,
      adjustedDailyProductivity:
        state.adjustedProductivity === null
          ? null
          : quantity(state.adjustedProductivity, sourceWorkItem.unit, sources),
      remainingQuantity: sourceWorkItem.remainingQuantity,
      remainingDurationWorkingDays: state.remainingDurationWorkingDays,
      ownProjectedFinish: state.ownProjectedFinish,
      dependencyProjectedFinish: state.projectedFinish,
      confidence: state.confidence,
      sourceRefs: boundedSources(sources, 200),
    });
  }
  return { workItems, calculations };
}

function projectConfidenceFactors(
  request: OperationalForecastRequestV1,
  workItems: readonly ForecastWorkItem[],
): ForecastConfidenceFactor[] {
  const relevantIds = new Set(
    request.operationalSnapshot.workItems
      .filter((item) => item.isCritical || item.contractMilestone)
      .map((item) => item.workItemId),
  );
  const relevant = workItems.filter((item) => relevantIds.has(item.workItemId));
  const candidates = relevant.length > 0 ? relevant : [...workItems];
  const calculation = calculationSource(request, "forecast.projectConfidence");
  return Object.keys(request.policy.confidenceWeights).map((_, index) => {
    const factorName = candidates[0]!.confidenceFactors[index]!.factor;
    const values = candidates.map((item) => item.confidenceFactors[index]!);
    return {
      factor: factorName,
      score: round(values.reduce((sum, item) => sum + item.score, 0) / values.length),
      weight: values[0]!.weight,
      sourceRefs: boundedSources([...values.flatMap((item) => item.sourceRefs), calculation]),
    };
  });
}

function projectedCriticalPath(
  request: OperationalForecastRequestV1,
  states: ReadonlyMap<string, ForecastState>,
): string[] {
  const scores = new Map<string, number>();
  const previous = new Map<string, string | null>();
  for (const workItemId of topologicalWorkItemIds(request.operationalSnapshot.workItems)) {
    const state = states.get(workItemId)!;
    const duration = state.remainingDurationWorkingDays ?? 0;
    const predecessor = state.workItem.predecessorWorkItemIds
      .map((predecessorId) => ({
        predecessorId,
        score: scores.get(predecessorId) ?? 0,
      }))
      .sort(
        (left, right) =>
          right.score - left.score || compareIdentifiers(left.predecessorId, right.predecessorId),
      )[0];
    scores.set(workItemId, duration + (predecessor?.score ?? 0));
    previous.set(workItemId, predecessor?.predecessorId ?? null);
  }
  const terminal = [...scores.entries()].sort(([leftId, leftScore], [rightId, rightScore]) => {
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    const leftFinish = states.get(leftId)!.projectedFinish;
    const rightFinish = states.get(rightId)!.projectedFinish;
    if (leftFinish !== null && rightFinish !== null && leftFinish !== rightFinish) {
      return rightFinish.localeCompare(leftFinish);
    }
    return compareIdentifiers(leftId, rightId);
  })[0]?.[0];
  if (terminal === undefined) {
    return [request.operationalSnapshot.workItems[0]!.workItemId];
  }
  const path: string[] = [];
  let current: string | null = terminal;
  while (current !== null) {
    path.push(current);
    current = previous.get(current) ?? null;
  }
  return path.reverse();
}

function buildForecastSnapshot(
  request: OperationalForecastRequestV1,
  requestHash: string,
  rollingSnapshotId: string,
  workItems: readonly ForecastWorkItem[],
  projectedCriticalPathWorkItemIds: readonly string[],
): OperationalForecastSnapshotV1 {
  const calendar = calendarFromRequest(request);
  const criticalIds = new Set([
    ...projectedCriticalPathWorkItemIds,
    ...request.operationalSnapshot.workItems
      .filter((item) => item.isCritical || item.contractMilestone)
      .map((item) => item.workItemId),
  ]);
  const relevant = workItems.filter((item) => criticalIds.has(item.workItemId));
  const projectItems = relevant.length > 0 ? relevant : [...workItems];
  const insufficient = projectItems.some((item) => item.status === "INSUFFICIENT_DATA");
  const delay = insufficient
    ? null
    : Math.max(...projectItems.map((item) => item.delayWorkingDays!.value));
  const projectedFinish =
    delay === null
      ? null
      : addWorkingDays(request.approvedBaseline.content.plannedFinish, delay, calendar);
  const confidenceFactorValues = projectConfidenceFactors(request, workItems);
  const calculation = calculationSource(request, "forecast.project");
  const drivers = projectItems
    .flatMap((item) => item.drivers)
    .sort((left, right) => compareIdentifiers(left.driverId, right.driverId));
  const sources = boundedSources(
    [
      ...request.approvedBaseline.content.activities.flatMap((activity) => activity.sourceRefs),
      ...request.approvedBaseline.content.dependencies.flatMap(
        (dependency) => dependency.sourceRefs,
      ),
      ...request.approvedBaseline.content.calendar.sourceRefs,
      ...drivers.flatMap((driver) => driver.sourceRefs),
      calculation,
    ],
    1_000,
  );
  return operationalForecastSnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotType: "OPERATIONAL_FORECAST",
    snapshotId: `operational-forecast-${requestHash.slice(0, 24)}`,
    tenantId: request.tenantId,
    projectId: request.projectId,
    asOf: request.generatedAt,
    baselineVersionId: request.approvedBaseline.baselineVersionId,
    scheduleVersionId: request.approvedBaseline.content.scheduleVersionId,
    rollingProductivitySnapshotId: rollingSnapshotId,
    policyVersion: {
      policyVersionId: request.policy.policyVersionId,
      version: request.policy.version,
      effectiveFrom: request.policy.effectiveFrom,
    },
    thresholds: {
      warningWorkingDays: request.policy.warningWorkingDays,
      criticalWorkingDays: request.policy.criticalWorkingDays,
      sourceRefs: boundedSources([...request.policy.sourceRefs, calculation]),
    },
    baselineFinish: request.approvedBaseline.content.plannedFinish,
    projectedFinish,
    delayWorkingDays: delay === null ? null : { value: delay, sourceRefs: sources },
    status: delay === null ? "INSUFFICIENT_DATA" : statusFromDelay(delay, request),
    confidence: weightedConfidence(confidenceFactorValues),
    confidenceFactors: confidenceFactorValues,
    workItems,
    projectedCriticalPathWorkItemIds,
    drivers,
    sourceRefs: sources,
    deterministic: true,
    baselineChanged: false,
  });
}

function recoveryConflicts(
  request: OperationalForecastRequestV1,
  workItem: OperationalWorkItem,
  actionType: RecoveryProposalDraftV1["actions"][number]["type"],
): string[] {
  const conflicts: string[] = [];
  if (actionType === "PARALLELIZE_WORK" && workItem.zoneCode !== null) {
    const zone = request.operationalSnapshot.zones.find(
      (candidate) => candidate.zoneCode === workItem.zoneCode,
    );
    if (zone === undefined || !zone.available || zone.maxConcurrentActivities <= 1) {
      conflicts.push(`zone-capacity-${workItem.zoneCode}`);
    }
  }
  if (actionType === "CHANGE_ZONE_SEQUENCE") {
    for (const predecessorId of workItem.predecessorWorkItemIds) {
      const dependency = dependencyDefinition(request, predecessorId, workItem.workItemId);
      conflicts.push(dependency?.dependencyId ?? `dependency-${predecessorId}`);
    }
  }
  if (actionType === "MOVE_RESOURCE") {
    for (const equipmentId of workItem.requiredEquipmentIds) {
      const equipment = request.operationalSnapshot.equipment.find(
        (candidate) => candidate.equipmentId === equipmentId,
      );
      if (equipment !== undefined && !equipment.available) {
        conflicts.push(`resource-${equipmentId}`);
      }
    }
  }
  return [...new Set(conflicts)].sort(compareIdentifiers);
}

function buildRecoveryProposals(
  request: OperationalForecastRequestV1,
  forecast: OperationalForecastSnapshotV1,
): RecoveryProposalDraftV1[] {
  if (forecast.delayWorkingDays === null || forecast.delayWorkingDays.value <= 0) {
    return [];
  }
  const workItemById = new Map(
    request.operationalSnapshot.workItems.map((item) => [item.workItemId, item]),
  );
  const candidates = forecast.workItems
    .filter(
      (item) =>
        item.delayWorkingDays !== null &&
        item.delayWorkingDays.value > 0 &&
        item.remainingDurationWorkingDays !== null,
    )
    .sort(
      (left, right) =>
        Number(right.delayWorkingDays!.value) - Number(left.delayWorkingDays!.value) ||
        compareIdentifiers(left.workItemId, right.workItemId),
    );
  const proposals: Array<RecoveryProposalDraftV1 & { optionId: string }> = [];
  for (const target of candidates) {
    const workItem = workItemById.get(target.workItemId)!;
    const duration = target.remainingDurationWorkingDays!.value;
    for (const option of request.recoveryOptions) {
      if (
        option.applicableWorkClassCode !== null &&
        option.applicableWorkClassCode !== workItem.workClassCode
      ) {
        continue;
      }
      const multipliedDuration =
        option.productivityMultiplier === null
          ? duration
          : Math.max(1, Math.ceil(duration / Number(option.productivityMultiplier)));
      const recovered = Math.max(
        0,
        duration -
          Math.max(
            duration === 0 ? 0 : 1,
            multipliedDuration - (option.fixedWorkingDaysReduction ?? 0),
          ),
      );
      const projectImpact = Math.min(recovered, forecast.delayWorkingDays.value);
      if (projectImpact <= 0) {
        continue;
      }
      const calculation = calculationSource(
        request,
        `recovery.${option.optionId}.${workItem.workItemId}`,
      );
      const conflicts = recoveryConflicts(request, workItem, option.actionType);
      const sources = boundedSources(
        [
          ...option.sourceRefs,
          ...option.additionalCostMnt.sourceRefs,
          ...workItem.sourceRefs,
          calculation,
        ],
        1_000,
      );
      proposals.push({
        schemaVersion: 1,
        draftType: "RECOVERY_PROPOSAL",
        draftId:
          `recovery-${forecast.snapshotId.slice(-24)}-${option.optionId}-${workItem.workItemId}`.slice(
            0,
            200,
          ),
        tenantId: request.tenantId,
        projectId: request.projectId,
        operationalForecastSnapshotId: forecast.snapshotId,
        status: conflicts.length > 0 ? "DRAFT" : "REVIEW_REQUIRED",
        proposal: `${option.actionType} option can recover ${projectImpact} working day(s) for ${workItem.code}.`,
        actions: [
          {
            actionId: `recovery-action-${option.optionId}-${workItem.workItemId}`.slice(0, 200),
            type: option.actionType,
            workItemIds: [workItem.workItemId],
            description: `Apply approved recovery option ${option.optionVersionId} to ${workItem.code}.`,
            sourceRefs: sources.slice(0, 100),
          },
        ],
        estimatedScheduleImpactWorkingDays: {
          value: -projectImpact,
          sourceRefs: sources.slice(0, 100),
        },
        additionalCostMnt: {
          value: formatMoney(Number(option.additionalCostMnt.value)),
          currency: "MNT",
          sourceRefs: boundedSources(option.additionalCostMnt.sourceRefs),
        },
        requiredResourceIds: [...option.requiredResourceIds].sort(compareIdentifiers),
        dependencyConflictIds: conflicts,
        risks: [...option.risks],
        sourceRefs: sources,
        calculatedBy: "DETERMINISTIC_SCENARIO_ENGINE",
        baselineChanged: false,
        requiresHumanReview: true,
        createdAt: request.generatedAt,
        optionId: option.optionId,
      });
    }
  }
  return proposals
    .sort(
      (left, right) =>
        left.estimatedScheduleImpactWorkingDays.value -
          right.estimatedScheduleImpactWorkingDays.value ||
        Number(left.additionalCostMnt.value) - Number(right.additionalCostMnt.value) ||
        compareIdentifiers(left.optionId, right.optionId),
    )
    .slice(0, request.policy.maximumRecoveryScenarios)
    .map(({ optionId: _optionId, ...proposal }) => recoveryProposalDraftV1Schema.parse(proposal));
}

export function calculateOperationalForecast(input: unknown): OperationalForecastResultV1 {
  const parsed = operationalForecastRequestV1Schema.parse(input);
  const request = canonicalRequest(parsed);
  const requestHash = sha256(stableStringify(request));
  const rollingSnapshotId = `rolling-productivity-${requestHash.slice(0, 24)}`;
  const prepared = request.operationalSnapshot.workItems.map((workItem) =>
    collectProductivity(request, workItem),
  );
  const productivityByWorkItem = new Map(prepared.map((item) => [item.rolling.workItemId, item]));
  const rollingProductivity = rollingProductivitySnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotType: "ROLLING_PRODUCTIVITY",
    snapshotId: rollingSnapshotId,
    tenantId: request.tenantId,
    projectId: request.projectId,
    asOf: request.generatedAt,
    policyVersion: {
      policyVersionId: request.policy.policyVersionId,
      version: request.policy.version,
      effectiveFrom: request.policy.effectiveFrom,
    },
    workItems: prepared.map((item) => item.rolling),
  });
  const states = buildStates(request, productivityByWorkItem);
  const forecastItems = buildForecastWorkItems(request, states);
  const criticalPathWorkItemIds = projectedCriticalPath(request, states);
  const forecast = buildForecastSnapshot(
    request,
    requestHash,
    rollingSnapshotId,
    forecastItems.workItems,
    criticalPathWorkItemIds,
  );
  const recoveryProposals = buildRecoveryProposals(request, forecast);
  const narrativeSources = boundedSources(
    [
      ...forecast.sourceRefs,
      ...forecast.drivers.flatMap((driver) => driver.sourceRefs),
      ...recoveryProposals.flatMap((proposal) => proposal.sourceRefs),
    ],
    1_000,
  );
  return operationalForecastResultV1Schema.parse({
    schemaVersion: 1,
    resultType: "A5_OPERATIONAL_FORECAST_RESULT",
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    requestHash,
    tenantId: request.tenantId,
    projectId: request.projectId,
    asOfDate: request.asOfDate,
    rollingProductivity,
    productivityCalculations: prepared.flatMap((item) => item.calculations),
    forecast,
    workItemCalculations: forecastItems.calculations,
    recoveryProposals,
    a2NarrativeInput: {
      schemaVersion: 1,
      inputType: "A2_FORECAST_NARRATIVE_INPUT",
      tenantId: request.tenantId,
      projectId: request.projectId,
      operationalForecastSnapshotId: forecast.snapshotId,
      projectStatus: forecast.status,
      projectedFinish: forecast.projectedFinish,
      delayWorkingDays: forecast.delayWorkingDays?.value ?? null,
      driverIds: forecast.drivers.map((driver) => driver.driverId),
      recoveryProposalIds: recoveryProposals.map((proposal) => proposal.draftId),
      numericAuthority: "A5_DETERMINISTIC_ONLY",
      a2MayCreateNumericFacts: false,
      sourceRefs: narrativeSources,
    },
    deterministic: true,
    llmRequired: false,
    baselineChanged: false,
    generatedAt: request.generatedAt,
  });
}

export class OperationalForecastGateway {
  readonly #byIdempotencyKey = new Map<string, OperationalForecastResultV1>();

  calculate(input: unknown): OperationalForecastResultV1 {
    const result = calculateOperationalForecast(input);
    const existing = this.#byIdempotencyKey.get(result.idempotencyKey);
    if (existing !== undefined) {
      if (existing.requestHash !== result.requestHash) {
        throw new Error("Operational-forecast idempotency key was reused with different content");
      }
      return existing;
    }
    this.#byIdempotencyKey.set(result.idempotencyKey, result);
    return result;
  }
}
