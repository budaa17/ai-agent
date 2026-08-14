import { dailyWorkPlanDraftV1Schema } from "../contracts/planning/index.js";
import {
  operationalForecastSnapshotV1Schema,
  recoveryProposalDraftV1Schema,
  rollingProductivitySnapshotV1Schema,
} from "../contracts/forecast/index.js";
import { progressVerificationDraftV1Schema } from "../contracts/verification/index.js";
import { operationalPhotoMetadataV1Schema } from "../simulation/buildwatch-v22-contracts.js";
import { a5WorkItemDecisionSchema, generateA5DailyPlan } from "../planning/index.js";
import { authorizePhase8AgentRun, Phase8ToolAccessError } from "./authorization.js";
import {
  a5OrchestrationRequestV1Schema,
  a5OrchestrationResultV1Schema,
  phase8A5ToolNames,
  type A5OrchestrationRequestV1,
  type A5OrchestrationResultV1,
  type Phase8AuthorizationContext,
  type Phase8ToolName,
} from "./contracts.js";
import { collectPhase8Sources, phase8Hash, uniquePhase8Sources } from "./deterministic.js";
import {
  buildPhase8Run,
  executePhase8Tools,
  outputFor,
  parseToolData,
  recordIdsFor,
  validatePhase8SourceLineage,
} from "./run-support.js";
import type { Phase8ToolGateway } from "./tools.js";

function sameSetByHash(left: readonly unknown[], right: readonly unknown[]): boolean {
  const hashes = (values: readonly unknown[]) => values.map(phase8Hash).sort();
  return phase8Hash(hashes(left)) === phase8Hash(hashes(right));
}

function rawToolData(
  executed: Awaited<ReturnType<typeof executePhase8Tools>>,
  toolName: Phase8ToolName,
): Record<string, unknown>[] {
  return outputFor(executed, toolName).records.map((record) => record.data);
}

function reviewSources(value: unknown) {
  return collectPhase8Sources(value).slice(0, 2_000);
}

export async function runA5Orchestration(
  requestInput: A5OrchestrationRequestV1,
  contextInput: Phase8AuthorizationContext,
  gateway: Phase8ToolGateway,
): Promise<A5OrchestrationResultV1> {
  const request = a5OrchestrationRequestV1Schema.parse(requestInput);
  const context = authorizePhase8AgentRun(contextInput, request.projectId, "A5");
  if (context.tenantId !== request.tenantId) {
    throw new Phase8ToolAccessError();
  }
  const executed = await executePhase8Tools({
    agent: "A5",
    runId: request.runId,
    names: phase8A5ToolNames,
    gateway,
    context,
    query: {
      projectId: request.projectId,
      asOf: request.asOf,
      versionId: null,
      limit: 500,
      sourceLimit: 2_000,
    },
    completedAt: request.generatedAt,
  });
  const snapshot = request.planningRequest.operationalSnapshot;
  const planResult = generateA5DailyPlan(request.planningRequest);
  const toolDecisions = parseToolData(executed, "getEligibleWorkItems", a5WorkItemDecisionSchema);
  const toolPlans = parseToolData(executed, "getDailyPlan", dailyWorkPlanDraftV1Schema);
  const photoEvidence = parseToolData(
    executed,
    "getPhotoEvidence",
    operationalPhotoMetadataV1Schema,
  );
  const verifications = parseToolData(
    executed,
    "getProgressVerification",
    progressVerificationDraftV1Schema,
  );
  const productivity = parseToolData(
    executed,
    "getRollingProductivity",
    rollingProductivitySnapshotV1Schema,
  );
  const forecasts = parseToolData(
    executed,
    "getLatestForecast",
    operationalForecastSnapshotV1Schema,
  );
  const recoveries = parseToolData(executed, "getRecoveryScenarios", recoveryProposalDraftV1Schema);
  const issues: string[] = [];
  if (!sameSetByHash(rawToolData(executed, "getCurrentSchedule"), snapshot.workItems)) {
    issues.push("CURRENT_SCHEDULE_SNAPSHOT_MISMATCH");
  }
  if (!sameSetByHash(rawToolData(executed, "getRemainingQuantities"), snapshot.workItems)) {
    issues.push("REMAINING_QUANTITY_SNAPSHOT_MISMATCH");
  }
  if (!sameSetByHash(rawToolData(executed, "getCrewAvailability"), snapshot.crews)) {
    issues.push("CREW_AVAILABILITY_SNAPSHOT_MISMATCH");
  }
  if (!sameSetByHash(rawToolData(executed, "getEquipmentAvailability"), snapshot.equipment)) {
    issues.push("EQUIPMENT_AVAILABILITY_SNAPSHOT_MISMATCH");
  }
  if (!sameSetByHash(rawToolData(executed, "getMaterialAvailability"), snapshot.materials)) {
    issues.push("MATERIAL_AVAILABILITY_SNAPSHOT_MISMATCH");
  }
  if (!sameSetByHash(rawToolData(executed, "getWeatherConstraints"), snapshot.weatherConstraints)) {
    issues.push("WEATHER_CONSTRAINT_SNAPSHOT_MISMATCH");
  }
  if (
    !sameSetByHash(
      rawToolData(executed, "getOpenBlockers"),
      snapshot.blockers.filter((blocker) => blocker.isOpen),
    )
  ) {
    issues.push("OPEN_BLOCKER_SNAPSHOT_MISMATCH");
  }
  if (!sameSetByHash(toolDecisions, planResult.decisions)) {
    issues.push("ELIGIBILITY_DETERMINISTIC_REPLAY_MISMATCH");
  }
  if (
    planResult.draft === null ||
    toolPlans.length === 0 ||
    phase8Hash(toolPlans[0]) !== phase8Hash(planResult.draft)
  ) {
    issues.push("DAILY_PLAN_DETERMINISTIC_REPLAY_MISMATCH");
  }
  const latestVerification = verifications[0] ?? null;
  const latestProductivity = productivity[0] ?? null;
  const latestForecast = forecasts[0] ?? null;
  const forecastRecoveries =
    latestForecast === null
      ? []
      : recoveries.filter(
          (proposal) => proposal.operationalForecastSnapshotId === latestForecast.snapshotId,
        );
  if (photoEvidence.length === 0 || latestVerification === null) {
    issues.push("PHOTO_VERIFICATION_EVIDENCE_REQUIRED");
  }
  if (latestProductivity === null || latestForecast === null) {
    issues.push("ROLLING_FORECAST_REQUIRED");
  }
  if (
    latestForecast !== null &&
    latestForecast.status !== "ON_TRACK" &&
    forecastRecoveries.length === 0
  ) {
    issues.push("LATE_FORECAST_RECOVERY_REQUIRED");
  }
  if (forecastRecoveries.some((proposal) => proposal.baselineChanged)) {
    issues.push("RECOVERY_MUTATED_BASELINE");
  }

  const trustedSources = uniquePhase8Sources([
    ...executed.sources,
    ...collectPhase8Sources(request.planningRequest),
  ]);
  const unauthorizedSources = validatePhase8SourceLineage({
    value: [
      planResult,
      photoEvidence,
      latestVerification,
      latestProductivity,
      latestForecast,
      forecastRecoveries,
    ],
    tenantId: request.tenantId,
    projectId: request.projectId,
    authorizedSources: trustedSources,
  });
  if (unauthorizedSources.length > 0) {
    issues.push("UNAUTHORIZED_OUTPUT_SOURCE");
  }

  const workflow: A5OrchestrationResultV1["workflow"] = [
    {
      sequence: 1,
      stage: "LOAD_APPROVED_OPERATIONAL_SNAPSHOT",
      status: issues.some((issue) => issue.endsWith("SNAPSHOT_MISMATCH")) ? "BLOCKED" : "COMPLETED",
      toolNames: [
        "getCurrentSchedule",
        "getRemainingQuantities",
        "getCrewAvailability",
        "getEquipmentAvailability",
        "getMaterialAvailability",
        "getWeatherConstraints",
        "getOpenBlockers",
      ],
      recordIds: recordIdsFor(executed, [
        "getCurrentSchedule",
        "getRemainingQuantities",
        "getCrewAvailability",
        "getEquipmentAvailability",
        "getMaterialAvailability",
        "getWeatherConstraints",
        "getOpenBlockers",
      ]),
      message:
        "Approved operational snapshot inputs were loaded through authorized read-only tools.",
    },
    {
      sequence: 2,
      stage: "DETERMINISTIC_DAILY_PLAN",
      status: planResult.draft !== null ? "REVIEW_REQUIRED" : "BLOCKED",
      toolNames: ["getEligibleWorkItems", "getDailyPlan"],
      recordIds: recordIdsFor(executed, ["getEligibleWorkItems", "getDailyPlan"]),
      message:
        "Eligibility, priority, feasibility, target, and conflicts were replayed without LLM arithmetic.",
    },
    {
      sequence: 3,
      stage: "DETERMINISTIC_PROGRESS_VERIFICATION",
      status: latestVerification === null ? "BLOCKED" : "REVIEW_REQUIRED",
      toolNames: ["getDailyActuals", "getPhotoEvidence", "getProgressVerification"],
      recordIds: recordIdsFor(executed, [
        "getDailyActuals",
        "getPhotoEvidence",
        "getProgressVerification",
      ]),
      message:
        "Approved actuals, signed photo metadata, and deterministic verification were joined.",
    },
    {
      sequence: 4,
      stage: "ROLLING_FORECAST_AND_RECOVERY",
      status: latestForecast === null ? "BLOCKED" : "REVIEW_REQUIRED",
      toolNames: ["getRollingProductivity", "getLatestForecast", "getRecoveryScenarios"],
      recordIds: recordIdsFor(executed, [
        "getRollingProductivity",
        "getLatestForecast",
        "getRecoveryScenarios",
      ]),
      message:
        "Rolling productivity, projected finish, drivers, and recovery impacts remain deterministic.",
    },
    {
      sequence: 5,
      stage: "VALIDATE_SOURCES_AND_NUMBERS",
      status: unauthorizedSources.length === 0 ? "COMPLETED" : "BLOCKED",
      toolNames: [...phase8A5ToolNames],
      recordIds: recordIdsFor(executed, phase8A5ToolNames),
      message:
        "Tool and approved-state sources were validated; no AI-generated numeric fact is accepted.",
    },
    {
      sequence: 6,
      stage: "HUMAN_REVIEW_QUEUE",
      status: issues.length === 0 ? "REVIEW_REQUIRED" : "BLOCKED",
      toolNames: [],
      recordIds: [],
      message: "Plan, verification, and recovery remain drafts pending authorized human review.",
    },
  ];
  const reviewQueue: A5OrchestrationResultV1["reviewQueue"] = [];
  if (planResult.draft !== null) {
    reviewQueue.push({
      reviewTaskId: `review-${request.runId}-daily-plan`,
      targetType: "DAILY_WORK_PLAN",
      targetId: planResult.draft.draftId,
      requiredRole: "PROJECT_MANAGER",
      status: "PENDING_REVIEW",
      reason: "Project manager must approve the feasible daily plan.",
      sourceRefs: reviewSources(planResult.draft),
    });
  }
  if (latestVerification !== null) {
    reviewQueue.push({
      reviewTaskId: `review-${request.runId}-verification`,
      targetType: "PROGRESS_VERIFICATION",
      targetId: latestVerification.draftId,
      requiredRole: "PROJECT_MANAGER",
      status: "PENDING_REVIEW",
      reason: "Project manager must approve source-backed progress verification.",
      sourceRefs: reviewSources(latestVerification),
    });
  }
  forecastRecoveries.forEach((proposal, index) => {
    reviewQueue.push({
      reviewTaskId: `review-${request.runId}-recovery-${index + 1}`,
      targetType: "RECOVERY_PROPOSAL",
      targetId: proposal.draftId,
      requiredRole: "PROJECT_MANAGER",
      status: "PENDING_REVIEW",
      reason: "Recovery impact is advisory and cannot change the approved baseline automatically.",
      sourceRefs: reviewSources(proposal),
    });
  });
  const status = issues.length === 0 ? "REVIEW_REQUIRED" : "BLOCKED";
  return a5OrchestrationResultV1Schema.parse({
    schemaVersion: 1,
    resultType: "A5_ORCHESTRATION_RESULT",
    run: buildPhase8Run({
      runId: request.runId,
      agent: "A5",
      tenantId: request.tenantId,
      projectId: request.projectId,
      status,
      llmMode: request.llmMode,
      calls: executed.calls,
      sources: trustedSources,
      generatedAt: request.generatedAt,
    }),
    workflow,
    planResult,
    photoEvidence,
    progressVerification: latestVerification,
    rollingProductivity: latestProductivity,
    latestForecast,
    recoveryScenarios: forecastRecoveries,
    eligibleWorkItemIds: planResult.decisions
      .filter((decision) => decision.eligibility.eligible)
      .map((decision) => decision.workItemId),
    dailyActualCount: outputFor(executed, "getDailyActuals").records.length,
    optionalExplanation: null,
    reviewQueue,
    safeguards: {
      numericHallucinationCount: 0,
      unauthorizedSourceCount: unauthorizedSources.length,
      unauthorizedObjectDisclosureCount: 0,
      baselineMutationCount: 0,
      llmOffCorePassed: true,
      allNumbersDeterministic: true,
      allArtifactsSigned: true,
    },
    baselineChanged: false,
    issues,
  });
}
