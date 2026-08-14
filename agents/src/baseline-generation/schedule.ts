import type { ContractValidationIssue } from "../contracts/common.js";
import {
  buildWatchReviewStateTransitionV1Schema,
  type BuildWatchReviewDecision,
  type BuildWatchReviewStateTransitionV1,
} from "../contracts/buildwatch-v2-common.js";
import {
  approvedEstimateVersionV1Schema,
  type ApprovedEstimateVersionV1,
} from "../contracts/estimate/index.js";
import {
  approvedQuantityTakeoffVersionV1Schema,
  type ApprovedQuantityTakeoffVersionV1,
} from "../contracts/quantity/index.js";
import {
  approvedBaselineCommandV1Schema,
  baselineDraftV1Schema,
  type ApprovedBaselineCommandV1,
  type ApprovedBaselineVersionV1,
  type BaselineDraftV1,
} from "../contracts/schedule/index.js";
import {
  addWorkingDays,
  isWorkingDay,
  nextWorkingDay,
  type ProductionCalendar,
} from "../production-analysis/calendar.js";
import {
  approvedProductivityRateV1Schema,
  approvedScheduleVersionV1Schema,
  approvedWorkTemplateV1Schema,
  scheduleDraftV1Schema,
  scheduleGenerationRequestV1Schema,
  type ApprovedProductivityRateV1,
  type ApprovedScheduleVersionV1,
  type ApprovedWorkTemplateV1,
  type ScheduleDraftV1,
  type ScheduleGenerationRequestV1,
} from "./contracts.js";
import { ceilExactDivision, parseExactDecimal } from "./decimal.js";
import {
  catalogIsEffective,
  catalogMatchesScope,
  cloneJson,
  createApprovedQuantitySource,
  createCalculationSource,
  deepFreeze,
  phase7Hash,
  phase7Id,
  uniqueSources,
  validationIssue,
} from "./deterministic.js";

type BaselineContent = BaselineDraftV1["content"];
type BaselineActivity = BaselineContent["activities"][number];
type BaselineDependency = BaselineContent["dependencies"][number];

type CpmInputActivity = Readonly<{
  activityId: string;
  durationWorkingDays: number;
}>;

type CpmInputDependency = Readonly<{
  predecessorActivityId: string;
  successorActivityId: string;
  type: BaselineDependency["type"];
  lagWorkingDays: number;
}>;

export type CpmActivityResult = Readonly<{
  activityId: string;
  earliestStartOffset: number;
  earliestFinishOffset: number;
  latestStartOffset: number;
  latestFinishOffset: number;
  totalFloatWorkingDays: number;
  isCritical: boolean;
}>;

export type CpmScheduleResult = Readonly<{
  projectDurationWorkingDays: number;
  activities: readonly CpmActivityResult[];
  topologicalOrder: readonly string[];
}>;

function dependencyForwardConstraint(
  dependency: CpmInputDependency,
  predecessorStart: number,
  predecessorDuration: number,
  successorDuration: number,
): number {
  if (dependency.type === "FINISH_TO_START") {
    return predecessorStart + predecessorDuration + dependency.lagWorkingDays;
  }
  if (dependency.type === "START_TO_START") {
    return predecessorStart + dependency.lagWorkingDays;
  }
  if (dependency.type === "FINISH_TO_FINISH") {
    return predecessorStart + predecessorDuration + dependency.lagWorkingDays - successorDuration;
  }
  return predecessorStart + dependency.lagWorkingDays - successorDuration;
}

function dependencyBackwardConstraint(
  dependency: CpmInputDependency,
  successorLatestStart: number,
  predecessorDuration: number,
  successorDuration: number,
): number {
  if (dependency.type === "FINISH_TO_START") {
    return successorLatestStart - predecessorDuration - dependency.lagWorkingDays;
  }
  if (dependency.type === "START_TO_START") {
    return successorLatestStart - dependency.lagWorkingDays;
  }
  if (dependency.type === "FINISH_TO_FINISH") {
    return (
      successorLatestStart + successorDuration - predecessorDuration - dependency.lagWorkingDays
    );
  }
  return successorLatestStart + successorDuration - dependency.lagWorkingDays;
}

export function calculateCpmSchedule(
  activities: readonly CpmInputActivity[],
  dependencies: readonly CpmInputDependency[],
): CpmScheduleResult {
  if (activities.length === 0) {
    throw new Error("CPM requires at least one activity");
  }
  const durationById = new Map(
    activities.map((activity) => [activity.activityId, activity.durationWorkingDays]),
  );
  if (
    durationById.size !== activities.length ||
    activities.some(
      (activity) =>
        !Number.isInteger(activity.durationWorkingDays) || activity.durationWorkingDays <= 0,
    )
  ) {
    throw new Error("CPM activity identifiers and positive durations are required");
  }
  const outgoing = new Map<string, CpmInputDependency[]>();
  const incoming = new Map<string, CpmInputDependency[]>();
  const indegree = new Map(activities.map((activity) => [activity.activityId, 0]));
  for (const dependency of dependencies) {
    if (
      !durationById.has(dependency.predecessorActivityId) ||
      !durationById.has(dependency.successorActivityId) ||
      dependency.predecessorActivityId === dependency.successorActivityId
    ) {
      throw new Error("CPM dependency references an invalid activity");
    }
    outgoing.set(dependency.predecessorActivityId, [
      ...(outgoing.get(dependency.predecessorActivityId) ?? []),
      dependency,
    ]);
    incoming.set(dependency.successorActivityId, [
      ...(incoming.get(dependency.successorActivityId) ?? []),
      dependency,
    ]);
    indegree.set(
      dependency.successorActivityId,
      (indegree.get(dependency.successorActivityId) ?? 0) + 1,
    );
  }
  const ready = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([activityId]) => activityId)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const activityId = ready.shift()!;
    order.push(activityId);
    for (const dependency of [...(outgoing.get(activityId) ?? [])].sort((left, right) =>
      left.successorActivityId.localeCompare(right.successorActivityId),
    )) {
      const next = (indegree.get(dependency.successorActivityId) ?? 0) - 1;
      indegree.set(dependency.successorActivityId, next);
      if (next === 0) {
        ready.push(dependency.successorActivityId);
        ready.sort();
      }
    }
  }
  if (order.length !== activities.length) {
    throw new Error("Schedule dependencies contain a cycle");
  }

  const earliestStart = new Map<string, number>();
  for (const activityId of order) {
    const successorDuration = durationById.get(activityId)!;
    const constraint = (incoming.get(activityId) ?? []).reduce(
      (maximum, dependency) =>
        Math.max(
          maximum,
          dependencyForwardConstraint(
            dependency,
            earliestStart.get(dependency.predecessorActivityId) ?? 0,
            durationById.get(dependency.predecessorActivityId)!,
            successorDuration,
          ),
        ),
      0,
    );
    earliestStart.set(activityId, Math.max(0, constraint));
  }
  const projectDuration = Math.max(
    ...order.map((activityId) => earliestStart.get(activityId)! + durationById.get(activityId)!),
  );
  const latestStart = new Map(
    order.map((activityId) => [activityId, projectDuration - durationById.get(activityId)!]),
  );
  for (const activityId of [...order].reverse()) {
    const activityOutgoing = outgoing.get(activityId) ?? [];
    if (activityOutgoing.length === 0) continue;
    const predecessorDuration = durationById.get(activityId)!;
    const latest = Math.min(
      ...activityOutgoing.map((dependency) =>
        dependencyBackwardConstraint(
          dependency,
          latestStart.get(dependency.successorActivityId)!,
          predecessorDuration,
          durationById.get(dependency.successorActivityId)!,
        ),
      ),
    );
    latestStart.set(activityId, latest);
  }
  const results = order.map((activityId) => {
    const duration = durationById.get(activityId)!;
    const earliest = earliestStart.get(activityId)!;
    const latest = latestStart.get(activityId)!;
    const totalFloat = latest - earliest;
    return {
      activityId,
      earliestStartOffset: earliest,
      earliestFinishOffset: earliest + duration,
      latestStartOffset: latest,
      latestFinishOffset: latest + duration,
      totalFloatWorkingDays: totalFloat,
      isCritical: totalFloat === 0,
    };
  });
  return {
    projectDurationWorkingDays: projectDuration,
    activities: results,
    topologicalOrder: order,
  };
}

function catalogRecords<T>(
  input: Readonly<{
    records: readonly T[];
    parse: (record: T) => T;
    identity: (record: T) => string;
    version: (record: T) => ApprovedProductivityRateV1["version"];
    tenantId: string;
    projectId: string;
    asOf: string;
    code: string;
    issues: ContractValidationIssue[];
  }>,
): T[] {
  const valid: T[] = [];
  input.records.forEach((record, index) => {
    try {
      const parsed = input.parse(record);
      const version = input.version(parsed);
      if (!catalogMatchesScope(version, input.tenantId, input.projectId)) {
        input.issues.push(
          validationIssue(
            `${input.code}_SCOPE_MISMATCH`,
            [`${input.code.toLowerCase()}.${index}`],
            `${input.code} is outside the schedule scope`,
          ),
        );
      } else if (catalogIsEffective(version, input.asOf)) {
        valid.push(parsed);
      }
    } catch (error) {
      input.issues.push(
        validationIssue(
          `INVALID_${input.code}`,
          [`${input.code.toLowerCase()}.${index}`],
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  });
  return valid.sort((left, right) => input.identity(left).localeCompare(input.identity(right)));
}

function resolveUniqueLatest<
  T extends Readonly<{
    version: ApprovedProductivityRateV1["version"];
  }>,
>(records: readonly T[], identity: (record: T) => string): T | null {
  const sorted = [...records].sort((left, right) => {
    const date = right.version.effectiveFrom.localeCompare(left.version.effectiveFrom);
    if (date !== 0) return date;
    const version = right.version.version - left.version.version;
    if (version !== 0) return version;
    return identity(left).localeCompare(identity(right));
  });
  const first = sorted[0];
  const second = sorted[1];
  if (first === undefined) return null;
  if (
    second !== undefined &&
    first.version.effectiveFrom === second.version.effectiveFrom &&
    first.version.version === second.version.version &&
    first.version.versionId !== second.version.versionId
  ) {
    return null;
  }
  return first;
}

export type ScheduleGenerationResult = Readonly<{
  schemaVersion: 1;
  resultType: "SCHEDULE_GENERATION";
  deterministic: true;
  complete: boolean;
  draft: ScheduleDraftV1 | null;
  cpm: CpmScheduleResult | null;
  issues: readonly ContractValidationIssue[];
}>;

export function generateScheduleDraft(
  input: Readonly<{
    request: ScheduleGenerationRequestV1;
    approvedQuantity: ApprovedQuantityTakeoffVersionV1;
    approvedEstimate: ApprovedEstimateVersionV1;
  }>,
): ScheduleGenerationResult {
  const request = scheduleGenerationRequestV1Schema.parse(input.request);
  const quantity = approvedQuantityTakeoffVersionV1Schema.parse(input.approvedQuantity);
  const estimate = approvedEstimateVersionV1Schema.parse(input.approvedEstimate);
  const issues: ContractValidationIssue[] = [];
  if (
    quantity.metadata.sourceHash !== phase7Hash(quantity.content) ||
    estimate.metadata.sourceHash !== phase7Hash(estimate.content)
  ) {
    issues.push(
      validationIssue(
        "SCHEDULE_APPROVED_SOURCE_HASH_MISMATCH",
        ["approvedQuantity", "approvedEstimate"],
        "Schedule inputs must retain their immutable approved source hashes",
      ),
    );
  }
  if (
    request.tenantId !== quantity.tenantId ||
    request.projectId !== quantity.projectId ||
    estimate.tenantId !== quantity.tenantId ||
    estimate.projectId !== quantity.projectId ||
    request.approvedQuantityVersionId !== quantity.quantityTakeoffVersionId ||
    request.approvedEstimateVersionId !== estimate.estimateVersionId ||
    estimate.content.quantityTakeoffVersionId !== quantity.quantityTakeoffVersionId
  ) {
    issues.push(
      validationIssue(
        "SCHEDULE_SCOPE_OR_VERSION_MISMATCH",
        ["request"],
        "Schedule, quantity, and estimate must share an approved scope/version lineage",
      ),
    );
  }
  const calendarSourcesInScope = request.calendar.sourceRefs.every(
    (source) => source.tenantId === request.tenantId && source.projectId === request.projectId,
  );
  if (
    !calendarSourcesInScope ||
    request.calendar.effectiveFrom > request.plannedStart ||
    (request.calendar.effectiveTo !== null && request.calendar.effectiveTo < request.plannedStart)
  ) {
    issues.push(
      validationIssue(
        "SCHEDULE_CALENDAR_NOT_EFFECTIVE",
        ["request.calendar"],
        "Schedule requires an in-scope effective operational calendar",
      ),
    );
  }
  const productivityRates = catalogRecords({
    records: request.productivityRates,
    parse: (record) => approvedProductivityRateV1Schema.parse(record),
    identity: (record) => record.productivityId,
    version: (record) => record.version,
    tenantId: request.tenantId,
    projectId: request.projectId,
    asOf: request.plannedStart,
    code: "PRODUCTIVITY_RATE",
    issues,
  });
  const workTemplates = catalogRecords({
    records: request.workTemplates,
    parse: (record) => approvedWorkTemplateV1Schema.parse(record),
    identity: (record) => record.templateId,
    version: (record) => record.version,
    tenantId: request.tenantId,
    projectId: request.projectId,
    asOf: request.plannedStart,
    code: "WORK_TEMPLATE",
    issues,
  });
  const duplicateWorkCodes = new Set<string>();
  const workCodeCounts = new Map<string, number>();
  for (const item of quantity.content.items) {
    const count = (workCodeCounts.get(item.workCode) ?? 0) + 1;
    workCodeCounts.set(item.workCode, count);
    if (count > 1) duplicateWorkCodes.add(item.workCode);
  }
  for (const workCode of duplicateWorkCodes) {
    issues.push(
      validationIssue(
        "SCHEDULE_WORK_CODE_AMBIGUOUS",
        ["approvedQuantity.content.items"],
        `Narrow-MVP scheduling requires one quantity item per work code: ${workCode}`,
      ),
    );
  }

  const activityInputs: Array<
    Readonly<{
      item: ApprovedQuantityTakeoffVersionV1["content"]["items"][number];
      rate: ApprovedProductivityRateV1;
      template: ApprovedWorkTemplateV1;
      activityId: string;
      duration: number;
    }>
  > = [];
  for (const item of quantity.content.items) {
    if (duplicateWorkCodes.has(item.workCode)) continue;
    if (parseExactDecimal(item.finalQuantity.value).coefficient === 0n) {
      issues.push(
        validationIssue(
          "ZERO_QUANTITY_NOT_SCHEDULED",
          [`approvedQuantity.content.items.${item.itemId}`],
          "A zero accepted quantity does not create a scheduled activity",
          "WARNING",
        ),
      );
      continue;
    }
    const rate = resolveUniqueLatest(
      productivityRates.filter(
        (candidate) =>
          candidate.workCode === item.workCode && candidate.workUnit === item.finalQuantity.unit,
      ),
      (candidate) => candidate.productivityId,
    );
    const template = resolveUniqueLatest(
      workTemplates.filter((candidate) => candidate.workCode === item.workCode),
      (candidate) => candidate.templateId,
    );
    if (rate === null) {
      issues.push(
        validationIssue(
          "SCHEDULE_PRODUCTIVITY_MISSING_OR_AMBIGUOUS",
          [`approvedQuantity.content.items.${item.itemId}`],
          `No unambiguous effective productivity exists for ${item.workCode}`,
        ),
      );
    }
    if (template === null) {
      issues.push(
        validationIssue(
          "SCHEDULE_WORK_TEMPLATE_MISSING_OR_AMBIGUOUS",
          [`approvedQuantity.content.items.${item.itemId}`],
          `No unambiguous approved work template exists for ${item.workCode}`,
        ),
      );
    }
    if (rate === null || template === null) continue;
    const duration = ceilExactDivision(
      parseExactDecimal(item.finalQuantity.value),
      parseExactDecimal(rate.quantityPerWorkingDay),
    );
    if (duration <= 0) {
      issues.push(
        validationIssue(
          "SCHEDULE_DURATION_INVALID",
          [`approvedQuantity.content.items.${item.itemId}`],
          "Productivity-derived schedule duration must be positive",
        ),
      );
      continue;
    }
    activityInputs.push({
      item,
      rate,
      template,
      activityId: phase7Id("activity", request.scheduleVersionId, item.itemId),
      duration,
    });
  }
  if (activityInputs.length === 0) {
    return {
      schemaVersion: 1,
      resultType: "SCHEDULE_GENERATION",
      deterministic: true,
      complete: false,
      draft: null,
      cpm: null,
      issues,
    };
  }
  const inputByWorkCode = new Map(activityInputs.map((entry) => [entry.item.workCode, entry]));
  const dependencies: BaselineDependency[] = [];
  for (const successor of activityInputs) {
    for (const rule of successor.template.predecessors) {
      const predecessor = inputByWorkCode.get(rule.predecessorWorkCode);
      if (predecessor === undefined) {
        issues.push(
          validationIssue(
            "SCHEDULE_PREDECESSOR_MISSING",
            [`workTemplates.${successor.template.templateId}.predecessors`],
            `Predecessor ${rule.predecessorWorkCode} has no scheduled quantity item`,
          ),
        );
        continue;
      }
      dependencies.push({
        dependencyId: phase7Id(
          "schedule-dependency",
          predecessor.activityId,
          successor.activityId,
          rule.type,
        ),
        predecessorActivityId: predecessor.activityId,
        successorActivityId: successor.activityId,
        type: rule.type,
        lagWorkingDays: rule.lagWorkingDays,
        sourceRefs: uniqueSources([...rule.sourceRefs, ...successor.template.version.sourceRefs]),
      });
    }
  }
  let cpm: CpmScheduleResult;
  try {
    cpm = calculateCpmSchedule(
      activityInputs.map((entry) => ({
        activityId: entry.activityId,
        durationWorkingDays: entry.duration,
      })),
      dependencies,
    );
  } catch (error) {
    issues.push(
      validationIssue(
        "SCHEDULE_CPM_FAILED",
        ["dependencies"],
        error instanceof Error ? error.message : String(error),
      ),
    );
    return {
      schemaVersion: 1,
      resultType: "SCHEDULE_GENERATION",
      deterministic: true,
      complete: false,
      draft: null,
      cpm: null,
      issues,
    };
  }
  const cpmById = new Map(cpm.activities.map((activity) => [activity.activityId, activity]));
  const calendar: ProductionCalendar = {
    workingWeekdays: request.calendar.workingWeekdays,
    holidays: request.calendar.holidays,
  };
  const plannedStart = isWorkingDay(request.plannedStart, calendar)
    ? request.plannedStart
    : nextWorkingDay(request.plannedStart, calendar, true);
  const activities: BaselineActivity[] = activityInputs.map((entry) => {
    const cpmActivity = cpmById.get(entry.activityId)!;
    const start = addWorkingDays(plannedStart, cpmActivity.earliestStartOffset, calendar);
    const end = addWorkingDays(start, entry.duration - 1, calendar);
    const quantitySource = createApprovedQuantitySource({
      tenantId: request.tenantId,
      projectId: request.projectId,
      sourceRefId: phase7Id(
        "source-schedule-quantity",
        quantity.quantityTakeoffVersionId,
        entry.item.itemId,
      ),
      quantityVersionId: quantity.quantityTakeoffVersionId,
      itemId: entry.item.itemId,
      asOf: request.createdAt,
    });
    const calculationSource = createCalculationSource({
      tenantId: request.tenantId,
      projectId: request.projectId,
      sourceRefId: phase7Id("source-schedule-calculation", entry.activityId),
      sourceId: request.scheduleVersionId,
      fieldPath: `activities.${entry.activityId}`,
      asOf: request.createdAt,
    });
    const sources = uniqueSources([
      quantitySource,
      ...entry.rate.version.sourceRefs,
      ...entry.template.version.sourceRefs,
      ...entry.template.sourceRefs,
      calculationSource,
    ]);
    const resourceSources = uniqueSources([...entry.rate.version.sourceRefs, calculationSource]);
    return {
      activityId: entry.activityId,
      workItemId: phase7Id("work-item", request.scheduleVersionId, entry.item.itemId),
      wbsCode: entry.template.wbsCode,
      parentWbsCode: entry.template.parentWbsCode,
      code: entry.item.workCode,
      name: entry.template.name,
      zoneCode: entry.template.zoneCode,
      unit: entry.item.finalQuantity.unit,
      plannedQuantity: {
        value: entry.item.finalQuantity.value,
        unit: entry.item.finalQuantity.unit,
        sourceRefs: uniqueSources([quantitySource, ...entry.item.finalQuantity.sourceRefs]),
      },
      durationWorkingDays: entry.duration,
      plannedStart: start,
      plannedEnd: end,
      priority: entry.template.priority,
      isCritical: cpmActivity.isCritical,
      totalFloatWorkingDays: cpmActivity.totalFloatWorkingDays,
      contractMilestone: entry.template.contractMilestone,
      productivityVersion: cloneJson(entry.rate.version),
      resourceRequirements: [
        {
          requirementId: phase7Id("resource-crew", entry.activityId),
          resourceType: "CREW" as const,
          resourceClassCode: entry.rate.laborClassCode,
          count: entry.rate.crewCount,
          sourceRefs: resourceSources,
        },
        ...entry.rate.equipment.map((equipment) => ({
          requirementId: phase7Id(
            "resource-equipment",
            entry.activityId,
            equipment.equipmentClassCode,
          ),
          resourceType: "EQUIPMENT" as const,
          resourceClassCode: equipment.equipmentClassCode,
          count: equipment.count,
          sourceRefs: resourceSources,
        })),
      ],
      sourceRefs: sources,
    };
  });
  activities.sort((left, right) => left.activityId.localeCompare(right.activityId));
  dependencies.sort((left, right) => left.dependencyId.localeCompare(right.dependencyId));
  const plannedFinish = activities.reduce(
    (latest, activity) => (activity.plannedEnd > latest ? activity.plannedEnd : latest),
    plannedStart,
  );
  const content: BaselineContent = {
    quantityTakeoffVersionId: quantity.quantityTakeoffVersionId,
    estimateVersionId: estimate.estimateVersionId,
    scheduleVersionId: request.scheduleVersionId,
    plannedStart,
    plannedFinish,
    budgetMnt: estimate.content.totalMnt.value,
    calendar: cloneJson(request.calendar),
    activities,
    dependencies,
  };
  const draft = scheduleDraftV1Schema.parse({
    schemaVersion: 1,
    draftType: "SCHEDULE",
    draftId: request.draftId,
    scheduleVersionId: request.scheduleVersionId,
    tenantId: request.tenantId,
    projectId: request.projectId,
    status: issues.some((issue) => issue.severity === "ERROR")
      ? "NEEDS_CORRECTION"
      : "REVIEW_REQUIRED",
    content,
    validationIssues: issues,
    requiresHumanReview: true,
    createdAt: request.createdAt,
    createdBy: request.createdBy,
  });
  return {
    schemaVersion: 1,
    resultType: "SCHEDULE_GENERATION",
    deterministic: true,
    complete: !issues.some((issue) => issue.severity === "ERROR"),
    draft,
    cpm,
    issues,
  };
}

export function createCommercialReviewTransition(
  input: Readonly<{
    transitionId: string;
    tenantId: string;
    projectId: string;
    targetType: BuildWatchReviewStateTransitionV1["targetType"];
    targetId: string;
    fromStatus: BuildWatchReviewStateTransitionV1["fromStatus"];
    toStatus: BuildWatchReviewStateTransitionV1["toStatus"];
    decision: BuildWatchReviewDecision;
  }>,
): BuildWatchReviewStateTransitionV1 {
  return buildWatchReviewStateTransitionV1Schema.parse({
    schemaVersion: 1,
    transitionType: "REVIEW_LIFECYCLE",
    transitionId: input.transitionId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    targetType: input.targetType,
    targetId: input.targetId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    actorId: input.decision.reviewerId,
    actorRole: input.decision.reviewerRole,
    reason: input.decision.reason,
    transitionedAt: input.decision.decidedAt,
  });
}

export function approveSchedule(
  input: Readonly<{
    draft: ScheduleDraftV1;
    decision: BuildWatchReviewDecision;
    previousVersion?: ApprovedScheduleVersionV1 | null;
  }>,
): ApprovedScheduleVersionV1 {
  const previousVersion = input.previousVersion ?? null;
  if (
    input.draft.status !== "REVIEW_REQUIRED" ||
    input.draft.validationIssues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new Error("Only an error-free schedule draft can be approved");
  }
  if (input.decision.action !== "APPROVE" || input.decision.reviewerRole !== "PROJECT_MANAGER") {
    throw new Error("Schedule approval requires a project manager");
  }
  if (
    previousVersion !== null &&
    (previousVersion.tenantId !== input.draft.tenantId ||
      previousVersion.projectId !== input.draft.projectId)
  ) {
    throw new Error("Previous schedule version is outside the draft scope");
  }
  if (
    previousVersion !== null &&
    (previousVersion.scheduleVersionId === input.draft.scheduleVersionId ||
      previousVersion.metadata.sourceHash !== phase7Hash(previousVersion.content))
  ) {
    throw new Error("Previous schedule version ID/hash is not immutable");
  }
  const content = cloneJson(input.draft.content);
  return deepFreeze(
    approvedScheduleVersionV1Schema.parse({
      schemaVersion: 1,
      versionType: "APPROVED_SCHEDULE",
      scheduleVersionId: input.draft.scheduleVersionId,
      tenantId: input.draft.tenantId,
      projectId: input.draft.projectId,
      status: "APPROVED",
      content,
      metadata: {
        version: (previousVersion?.metadata.version ?? 0) + 1,
        approvedBy: input.decision.reviewerId,
        approvedAt: input.decision.decidedAt,
        sourceHash: phase7Hash(content),
        supersedesVersionId: previousVersion?.scheduleVersionId ?? null,
      },
    }),
  );
}

export function composeBaselineDraft(
  input: Readonly<{
    draftId: string;
    approvedQuantity: ApprovedQuantityTakeoffVersionV1;
    approvedEstimate: ApprovedEstimateVersionV1;
    approvedSchedule: ApprovedScheduleVersionV1;
    createdAt: string;
    createdBy: string;
  }>,
): BaselineDraftV1 {
  const quantity = approvedQuantityTakeoffVersionV1Schema.parse(input.approvedQuantity);
  const estimate = approvedEstimateVersionV1Schema.parse(input.approvedEstimate);
  const schedule = approvedScheduleVersionV1Schema.parse(input.approvedSchedule);
  if (
    quantity.metadata.sourceHash !== phase7Hash(quantity.content) ||
    estimate.metadata.sourceHash !== phase7Hash(estimate.content) ||
    schedule.metadata.sourceHash !== phase7Hash(schedule.content)
  ) {
    throw new Error("Approved baseline inputs failed immutable source-hash checks");
  }
  if (
    quantity.tenantId !== estimate.tenantId ||
    quantity.projectId !== estimate.projectId ||
    schedule.tenantId !== quantity.tenantId ||
    schedule.projectId !== quantity.projectId ||
    estimate.content.quantityTakeoffVersionId !== quantity.quantityTakeoffVersionId ||
    schedule.content.quantityTakeoffVersionId !== quantity.quantityTakeoffVersionId ||
    schedule.content.estimateVersionId !== estimate.estimateVersionId ||
    schedule.content.scheduleVersionId !== schedule.scheduleVersionId ||
    schedule.content.budgetMnt !== estimate.content.totalMnt.value
  ) {
    throw new Error("Approved quantity, estimate, and schedule lineage does not match");
  }
  return baselineDraftV1Schema.parse({
    schemaVersion: 1,
    draftType: "BASELINE",
    draftId: input.draftId,
    tenantId: quantity.tenantId,
    projectId: quantity.projectId,
    status: "REVIEW_REQUIRED",
    content: cloneJson(schedule.content),
    validationIssues: [],
    requiresHumanReview: true,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
  });
}

export function approveBaseline(
  input: Readonly<{
    commandId: string;
    idempotencyKey: string;
    baselineVersionId: string;
    draft: BaselineDraftV1;
    decision: BuildWatchReviewDecision;
    previousVersion?: ApprovedBaselineVersionV1 | null;
    changeReason?: string | null;
  }>,
): ApprovedBaselineCommandV1 {
  const previousVersion = input.previousVersion ?? null;
  const changeReason = input.changeReason ?? null;
  if (
    input.draft.status !== "REVIEW_REQUIRED" ||
    input.draft.validationIssues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new Error("Only an error-free baseline draft can be approved");
  }
  if (input.decision.action !== "APPROVE" || input.decision.reviewerRole !== "PROJECT_MANAGER") {
    throw new Error("Baseline approval requires a project manager");
  }
  if (previousVersion === null && changeReason !== null) {
    throw new Error("Initial baseline approval cannot have a change reason");
  }
  if (previousVersion !== null) {
    if (
      previousVersion.tenantId !== input.draft.tenantId ||
      previousVersion.projectId !== input.draft.projectId
    ) {
      throw new Error("Previous baseline version is outside the draft scope");
    }
    if (changeReason === null || changeReason.trim().length === 0) {
      throw new Error("A superseding baseline requires a change reason");
    }
    if (
      previousVersion.baselineVersionId === input.baselineVersionId ||
      previousVersion.metadata.sourceHash !== phase7Hash(previousVersion.content)
    ) {
      throw new Error("Previous baseline version ID/hash is not immutable");
    }
    if (phase7Hash(previousVersion.content) === phase7Hash(input.draft.content)) {
      throw new Error("An unchanged baseline cannot create a superseding version");
    }
  }
  const content = cloneJson(input.draft.content);
  const command = approvedBaselineCommandV1Schema.parse({
    schemaVersion: 1,
    commandType: "APPROVE_BASELINE",
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    tenantId: input.draft.tenantId,
    projectId: input.draft.projectId,
    draftId: input.draft.draftId,
    approvedVersion: {
      schemaVersion: 1,
      versionType: "APPROVED_BASELINE",
      baselineVersionId: input.baselineVersionId,
      tenantId: input.draft.tenantId,
      projectId: input.draft.projectId,
      status: "APPROVED",
      content,
      metadata: {
        version: (previousVersion?.metadata.version ?? 0) + 1,
        approvedBy: input.decision.reviewerId,
        approvedAt: input.decision.decidedAt,
        sourceHash: phase7Hash(content),
        supersedesVersionId: previousVersion?.baselineVersionId ?? null,
      },
    },
    decision: input.decision,
    changeReason,
  });
  return deepFreeze(command);
}
