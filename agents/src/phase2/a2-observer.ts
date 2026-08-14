import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  recommendationDraftV1Schema,
  type RecommendationActionV1,
  type RecommendationDraftV1,
} from "../contracts/agent-outputs.js";
import {
  contractIdentifierSchema,
  contractIsoDateTimeSchema,
  contractValidationIssueSchema,
  confidenceLevelFromScore,
} from "../contracts/common.js";
import {
  deterministicAnalysisV1Schema,
  type AgentSourceRefV1,
  type DeterministicAnalysisV1,
  type DeterministicDeviationV1,
  type RecoveryScenarioV1,
} from "../contracts/deterministic-analysis.js";
import {
  projectAnalysisSnapshotV1Schema,
  type ProjectAnalysisSnapshotV1,
} from "../contracts/project-analysis-snapshot.js";
import { analyzeProjectSnapshot } from "../production-analysis/index.js";

export const a2ContextMemoryV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: contractIdentifierSchema,
    recentAlertIds: z.array(contractIdentifierSchema).max(500),
    closedAlertIds: z.array(contractIdentifierSchema).max(500),
    previousRecommendationIds: z.array(contractIdentifierSchema).max(500),
    managerDecisionRefs: z.array(contractIdentifierSchema).max(500),
    repeatedBlockerGroups: z
      .array(
        z
          .object({
            groupKey: z.string().trim().min(1).max(500),
            count: z.number().int().positive(),
            blockerIds: z.array(contractIdentifierSchema).min(1).max(500),
          })
          .strict(),
      )
      .max(100),
    tenantTerminology: z.record(z.string().trim().min(1), z.string().trim().min(1).max(500)),
    weeklyReportCount: z.number().int().nonnegative(),
    dataFreshnessAt: contractIsoDateTimeSchema,
    dataAgeHours: z.number().finite().nonnegative(),
  })
  .strict();

export const a2ProductionResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    runId: contractIdentifierSchema,
    requestId: contractIdentifierSchema,
    trigger: z.enum(["MANUAL", "EVENT", "NIGHTLY", "SCHEDULED"]),
    snapshotId: contractIdentifierSchema,
    analysis: deterministicAnalysisV1Schema,
    contextMemory: a2ContextMemoryV1Schema,
    drafts: z.array(recommendationDraftV1Schema).max(500),
    aiStatus: z.enum(["NOT_REQUESTED", "COMPLETED", "AI_UNAVAILABLE"]),
    aiError: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

export type A2ContextMemoryV1 = z.infer<typeof a2ContextMemoryV1Schema>;
export type A2ProductionResultV1 = z.infer<typeof a2ProductionResultV1Schema>;

export interface A2NarrativeGateway {
  enrich(input: {
    snapshot: ProjectAnalysisSnapshotV1;
    analysis: DeterministicAnalysisV1;
    drafts: readonly RecommendationDraftV1[];
    contextMemory: A2ContextMemoryV1;
  }): Promise<
    Readonly<
      Record<
        string,
        {
          title?: string;
          summary?: string;
          rootCause?: string | null;
        }
      >
    >
  >;
}

function stableId(prefix: string, value: string) {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function latestObservedAt(snapshot: ProjectAnalysisSnapshotV1) {
  const timestamps = [
    snapshot.asOf,
    ...snapshot.progressEntries.map((entry) => entry.capturedAt),
    ...snapshot.stockMovements.map((entry) => entry.occurredAt),
    ...snapshot.costEntries.map((entry) => entry.occurredAt),
    ...snapshot.blockers.map((entry) => entry.openedAt),
    ...snapshot.alerts.map((entry) => entry.createdAt),
  ];

  return timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;
}

export function buildA2ContextMemory(snapshotInput: ProjectAnalysisSnapshotV1): A2ContextMemoryV1 {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);
  const blockerGroups = new Map<string, ProjectAnalysisSnapshotV1["blockers"]>();

  for (const blocker of snapshot.blockers) {
    const key = [
      blocker.category,
      blocker.supplierName ?? blocker.responsibleParty ?? "unknown",
    ].join(":");
    const group = blockerGroups.get(key) ?? [];
    group.push(blocker);
    blockerGroups.set(key, group);
  }

  const dataFreshnessAt = latestObservedAt(snapshot);
  const context = {
    schemaVersion: 1 as const,
    snapshotId: snapshot.snapshotId,
    recentAlertIds: snapshot.alerts
      .filter((alert) => alert.status !== "CLOSED")
      .map((alert) => alert.alertId),
    closedAlertIds: snapshot.alerts
      .filter((alert) => alert.status === "CLOSED")
      .map((alert) => alert.alertId),
    previousRecommendationIds: snapshot.recommendationDecisions.map(
      (decision) => decision.recommendationId,
    ),
    managerDecisionRefs: snapshot.recommendationDecisions
      .filter((decision) => decision.decidedAt !== null)
      .map((decision) => decision.recommendationId),
    repeatedBlockerGroups: [...blockerGroups.entries()]
      .filter(([, blockers]) => blockers.length >= 2)
      .map(([groupKey, blockers]) => ({
        groupKey,
        count: blockers.length,
        blockerIds: blockers.map((blocker) => blocker.blockerId),
      }))
      .sort(
        (left, right) => right.count - left.count || left.groupKey.localeCompare(right.groupKey),
      ),
    tenantTerminology: snapshot.tenantProfile.terminology,
    weeklyReportCount: new Set(snapshot.dailyReports.map((report) => report.date.slice(0, 7))).size,
    dataFreshnessAt,
    dataAgeHours: Math.max(
      0,
      (Date.parse(snapshot.asOf) - Date.parse(dataFreshnessAt)) / 3_600_000,
    ),
  };

  return a2ContextMemoryV1Schema.parse(context);
}

function sourceRefsForDeviation(
  analysis: DeterministicAnalysisV1,
  deviation: DeterministicDeviationV1,
): AgentSourceRefV1[] {
  const explicitIds = new Set(deviation.sourceIds);
  const entityIds = new Set([
    deviation.workItemId,
    deviation.materialId,
    deviation.subcontractorId,
  ]);
  const selected = analysis.sourceCatalog.filter(
    (source) =>
      explicitIds.has(source.sourceId) ||
      explicitIds.has(source.entityId) ||
      entityIds.has(source.entityId),
  );
  const fallback =
    selected.length > 0
      ? selected
      : analysis.sourceCatalog.filter(
          (source) => source.catalog === "BASELINE" || source.catalog === "WORK_ITEM",
        );
  const unique = new Map(fallback.map((source) => [source.sourceId, source]));
  return [...unique.values()].slice(0, 100);
}

function observationKind(
  deviation: DeterministicDeviationV1,
): RecommendationDraftV1["observationKind"] {
  if (
    ["PRODUCTIVITY_DECLINE", "STALLED_PROGRESS", "MISSING_DAILY_REPORT"].includes(deviation.ruleId)
  ) {
    return "TREND";
  }

  if (
    deviation.rootCauseGroupId !== null ||
    ["MATERIAL_OVERUSE", "STOCK_SHORTAGE", "DEPENDENCY_VIOLATION"].includes(deviation.ruleId)
  ) {
    return "ROOT_CAUSE";
  }

  return "DEVIATION";
}

function scenarioForDeviation(
  analysis: DeterministicAnalysisV1,
  deviation: DeterministicDeviationV1,
): RecoveryScenarioV1 | null {
  const byTarget = analysis.recoveryScenarios.find((scenario) =>
    deviation.workItemId === null
      ? false
      : scenario.targetWorkItemIds.includes(deviation.workItemId),
  );

  return (
    byTarget ??
    analysis.recoveryScenarios.find((scenario) => scenario.dataSufficient) ??
    analysis.recoveryScenarios[0] ??
    null
  );
}

function actionType(scenario: RecoveryScenarioV1 | null): RecommendationActionV1["actionType"] {
  if (scenario === null) {
    return "INVESTIGATE";
  }

  const byScenario: Record<RecoveryScenarioV1["type"], RecommendationActionV1["actionType"]> = {
    EXTRA_CREW: "ADD_RESOURCE",
    PARALLELIZATION: "PARALLELIZE",
    RESEQUENCE: "RESEQUENCE",
    SUBCONTRACTOR_OPTION: "SUBCONTRACT",
  };
  return byScenario[scenario.type];
}

function resources(
  scenario: RecoveryScenarioV1 | null,
): RecommendationActionV1["requiredResources"] {
  if (scenario === null) {
    return [
      {
        resourceType: "OTHER",
        description: "Нэмэлт эх өгөгдөл болон хариуцагчийн баталгаажуулалт",
        quantity: null,
      },
    ];
  }

  const byScenario: Record<
    RecoveryScenarioV1["type"],
    RecommendationActionV1["requiredResources"]
  > = {
    EXTRA_CREW: [
      {
        resourceType: "LABOR",
        description: "Нэмэлт ажлын баг",
        quantity: null,
      },
    ],
    PARALLELIZATION: [
      {
        resourceType: "LABOR",
        description: "Зэрэгцээ ажлын фронтын баг",
        quantity: null,
      },
    ],
    RESEQUENCE: [
      {
        resourceType: "APPROVAL",
        description: "Хамаарлын өөрчлөлтийн техникийн зөвшөөрөл",
        quantity: null,
      },
    ],
    SUBCONTRACTOR_OPTION: [
      {
        resourceType: "SUBCONTRACTOR",
        description: "Нэмэлт туслан гүйцэтгэгчийн нөөц",
        quantity: null,
      },
    ],
  };
  return byScenario[scenario.type];
}

function buildAction(
  snapshot: ProjectAnalysisSnapshotV1,
  analysis: DeterministicAnalysisV1,
  deviation: DeterministicDeviationV1,
): RecommendationActionV1 {
  const scenario = scenarioForDeviation(analysis, deviation);
  const dependencyConflicts = snapshot.dependencies
    .filter(
      (dependency) =>
        deviation.workItemId !== null &&
        (dependency.predecessorWorkItemId === deviation.workItemId ||
          dependency.successorWorkItemId === deviation.workItemId),
    )
    .map((dependency) => dependency.dependencyId);
  const dataSufficient = scenario?.dataSufficient ?? false;

  return {
    actionId: stableId("action", `${analysis.analysisId}:${deviation.deviationId}`),
    actionType: actionType(scenario),
    title:
      scenario === null
        ? "Нөхцөл байдлыг нэмэлтээр шалгах"
        : `${scenario.type} хувилбарыг хүнээр хянуулах`,
    description:
      scenario === null
        ? "Эх өгөгдлийн бүрдлийг нягталж, шийдвэрийн хувилбар бэлтгэнэ."
        : "Deterministic scenario-ийн нөлөө, нөөц, эрсдэлийг менежер баталгаажуулна.",
    scenarioType: scenario?.type ?? null,
    scenarioId: scenario?.scenarioId ?? null,
    estimatedImpactWorkingDays: dataSufficient ? scenario!.estimatedImpactDays : null,
    estimatedCostMnt: null,
    ownerRef:
      snapshot.alerts.find(
        (alert) => alert.workItemId === deviation.workItemId && alert.assigneeRef !== null,
      )?.assigneeRef ?? null,
    requiredResources: resources(scenario),
    optionRisks: scenario?.assumptions.slice(0, 10) ?? [
      "Өгөгдөл дутуу үед impact автоматаар тооцохгүй.",
    ],
    dependencyConflicts,
    feasibilityStatus:
      scenario === null
        ? "INSUFFICIENT_DATA"
        : dataSufficient
          ? dependencyConflicts.length > 0
            ? "CONDITIONAL"
            : "FEASIBLE"
          : "INSUFFICIENT_DATA",
    dataSufficient,
  };
}

function buildValidationIssues(sourceRefs: AgentSourceRefV1[], action: RecommendationActionV1) {
  const issues: z.infer<typeof contractValidationIssueSchema>[] = [];

  if (sourceRefs.length === 0) {
    issues.push({
      code: "A2_SOURCE_REQUIRED",
      severity: "ERROR",
      fieldPaths: ["sourceRefs"],
      message: "Recommendation draft requires source evidence",
      deterministic: true,
    });
  }

  if (!action.dataSufficient) {
    issues.push({
      code: "A2_SCENARIO_DATA_INSUFFICIENT",
      severity: "WARNING",
      fieldPaths: ["actions.0.dataSufficient"],
      message: "Scenario impact is withheld until deterministic data is sufficient",
      deterministic: true,
    });
  }

  return issues.map((validationIssue) => contractValidationIssueSchema.parse(validationIssue));
}

export function buildProductionRecommendationDrafts(
  snapshotInput: ProjectAnalysisSnapshotV1,
  analysisInput?: DeterministicAnalysisV1,
): RecommendationDraftV1[] {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(snapshotInput);
  const analysis = deterministicAnalysisV1Schema.parse(
    analysisInput ?? analyzeProjectSnapshot(snapshot),
  );

  if (
    analysis.tenantId !== snapshot.tenantId ||
    analysis.projectId !== snapshot.projectId ||
    analysis.snapshotId !== snapshot.snapshotId
  ) {
    throw new Error("A2 snapshot and analysis scope do not match");
  }

  return analysis.deviations.map((deviation) => {
    const sourceRefs = sourceRefsForDeviation(analysis, deviation);
    const action = buildAction(snapshot, analysis, deviation);
    const validationIssues = buildValidationIssues(sourceRefs, action);
    const confidenceScore = sourceRefs.length === 0 ? 0.2 : action.dataSufficient ? 0.94 : 0.72;
    const workItemIds = deviation.workItemId === null ? [] : [deviation.workItemId];
    const rootCause =
      deviation.rootCauseGroupId === null
        ? null
        : `Deterministic root-cause group: ${deviation.rootCauseGroupId}`;

    return recommendationDraftV1Schema.parse({
      schemaVersion: 1,
      artifactType: "RECOMMENDATION_DRAFT",
      recommendationId: stableId(
        "recommendation",
        `${analysis.analysisId}:${deviation.deviationId}`,
      ),
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      snapshotId: snapshot.snapshotId,
      analysisId: analysis.analysisId,
      generatedAt: snapshot.asOf,
      observationKind: observationKind(deviation),
      priority: deviation.severity,
      title: deviation.title,
      summary: deviation.explanation,
      rootCause,
      rootCauseGroupId: deviation.rootCauseGroupId,
      workItemIds,
      actions: [action],
      sourceRefs,
      contextMemoryRefs: snapshot.recommendationDecisions
        .filter((decision) =>
          workItemIds.some((workItemId) => decision.workItemIds.includes(workItemId)),
        )
        .map((decision) => decision.recommendationId),
      dataFreshnessAt: latestObservedAt(snapshot),
      confidenceScore,
      confidenceLevel: confidenceLevelFromScore(confidenceScore),
      validationIssues,
      status: validationIssues.some((validationIssue) => validationIssue.severity === "ERROR")
        ? "NEEDS_CORRECTION"
        : "PENDING_REVIEW",
      requiresHumanReview: true,
    });
  });
}

function qualitativeNarrative(value: string) {
  if (value.length > 3_000) {
    throw new Error("A2 narrative exceeds the output limit");
  }

  if (/\b\d+(?:[.,]\d+)?\b/u.test(value)) {
    throw new Error("A2 qualitative narrative cannot introduce numeric claims");
  }

  return value.trim();
}

export async function runProductionA2(input: {
  snapshot: ProjectAnalysisSnapshotV1;
  requestId: string;
  trigger?: A2ProductionResultV1["trigger"];
  narrativeGateway?: A2NarrativeGateway;
}): Promise<A2ProductionResultV1> {
  const snapshot = projectAnalysisSnapshotV1Schema.parse(input.snapshot);
  const analysis = analyzeProjectSnapshot(snapshot);
  const contextMemory = buildA2ContextMemory(snapshot);
  const drafts = buildProductionRecommendationDrafts(snapshot, analysis);
  let aiStatus: A2ProductionResultV1["aiStatus"] =
    input.narrativeGateway === undefined ? "NOT_REQUESTED" : "COMPLETED";
  let aiError: string | null = null;

  if (input.narrativeGateway !== undefined) {
    try {
      const enriched = await input.narrativeGateway.enrich({
        snapshot,
        analysis,
        drafts,
        contextMemory,
      });

      for (const draft of drafts) {
        const narrative = enriched[draft.recommendationId];

        if (narrative?.title !== undefined) {
          draft.title = qualitativeNarrative(narrative.title);
        }

        if (narrative?.summary !== undefined) {
          draft.summary = qualitativeNarrative(narrative.summary);
        }

        if (narrative?.rootCause !== undefined) {
          draft.rootCause =
            narrative.rootCause === null ? null : qualitativeNarrative(narrative.rootCause);
        }

        recommendationDraftV1Schema.parse(draft);
      }
    } catch (error) {
      aiStatus = "AI_UNAVAILABLE";
      aiError = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
    }
  }

  return a2ProductionResultV1Schema.parse({
    schemaVersion: 1,
    runId: stableId("a2-run", `${snapshot.snapshotId}:${input.requestId}`),
    requestId: input.requestId,
    trigger: input.trigger ?? "MANUAL",
    snapshotId: snapshot.snapshotId,
    analysis,
    contextMemory,
    drafts,
    aiStatus,
    aiError,
  });
}

export const recommendationReviewDecisionSchema = z.enum([
  "PENDING_REVIEW",
  "APPROVED",
  "EDITED",
  "DISCARDED",
]);

export const recommendationReviewRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    draft: recommendationDraftV1Schema,
    decision: recommendationReviewDecisionSchema,
    reviewedBy: contractIdentifierSchema.nullable(),
    reviewedAt: contractIsoDateTimeSchema.nullable(),
    decisionReason: z.string().trim().min(1).max(2_000).nullable(),
    originalDraftSha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: contractIsoDateTimeSchema,
    updatedAt: contractIsoDateTimeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.decision !== "PENDING_REVIEW" &&
      (record.reviewedBy === null || record.reviewedAt === null || record.decisionReason === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Reviewed recommendations require audit metadata",
        path: ["decision"],
      });
    }
  });

export type RecommendationReviewRecordV1 = z.infer<typeof recommendationReviewRecordV1Schema>;

export class FileRecommendationDraftStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = path.resolve(directory);
  }

  #target(recommendationId: string) {
    if (!/^[A-Za-z0-9._-]+$/u.test(recommendationId)) {
      throw new Error("Unsafe recommendation ID");
    }

    return path.join(this.#directory, `${recommendationId}.json`);
  }

  async #write(record: RecommendationReviewRecordV1) {
    await mkdir(this.#directory, { recursive: true });
    const target = this.#target(record.draft.recommendationId);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  async save(
    draftInput: RecommendationDraftV1,
    now = new Date().toISOString(),
  ): Promise<RecommendationReviewRecordV1> {
    const draft = recommendationDraftV1Schema.parse(draftInput);

    try {
      const existing = await this.get(draft.recommendationId);

      if (
        existing.originalDraftSha256 !==
        createHash("sha256").update(JSON.stringify(draft)).digest("hex")
      ) {
        throw new Error("Recommendation ID already exists with different content");
      }

      return existing;
    } catch (error) {
      const missing =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT";

      if (!missing) {
        throw error;
      }
    }

    const record = recommendationReviewRecordV1Schema.parse({
      schemaVersion: 1,
      draft,
      decision: "PENDING_REVIEW",
      reviewedBy: null,
      reviewedAt: null,
      decisionReason: null,
      originalDraftSha256: createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
      createdAt: now,
      updatedAt: now,
    });
    await this.#write(record);
    return record;
  }

  async get(recommendationId: string): Promise<RecommendationReviewRecordV1> {
    return recommendationReviewRecordV1Schema.parse(
      JSON.parse(await readFile(this.#target(recommendationId), "utf8")),
    );
  }

  async list(): Promise<RecommendationReviewRecordV1[]> {
    await mkdir(this.#directory, { recursive: true });
    const names = (await readdir(this.#directory)).filter((name) => name.endsWith(".json")).sort();

    return Promise.all(
      names.map(async (name) =>
        recommendationReviewRecordV1Schema.parse(
          JSON.parse(await readFile(path.join(this.#directory, name), "utf8")),
        ),
      ),
    );
  }

  async decide(input: {
    recommendationId: string;
    decision: Exclude<z.infer<typeof recommendationReviewDecisionSchema>, "PENDING_REVIEW">;
    reviewedBy: string;
    reason: string;
    editedDraft?: RecommendationDraftV1;
    reviewedAt?: string;
  }): Promise<RecommendationReviewRecordV1> {
    const existing = await this.get(input.recommendationId);

    if (existing.decision !== "PENDING_REVIEW") {
      return existing;
    }

    if (input.decision === "EDITED" && input.editedDraft === undefined) {
      throw new Error("EDITED decision requires an edited draft");
    }

    const draft =
      input.editedDraft === undefined
        ? existing.draft
        : recommendationDraftV1Schema.parse(input.editedDraft);
    const reviewedAt = input.reviewedAt ?? new Date().toISOString();
    const record = recommendationReviewRecordV1Schema.parse({
      ...existing,
      draft,
      decision: input.decision,
      reviewedBy: input.reviewedBy,
      reviewedAt,
      decisionReason: input.reason,
      updatedAt: reviewedAt,
    });
    await this.#write(record);
    return record;
  }
}

export function a2TriggerId(input: {
  trigger: "MANUAL" | "EVENT" | "NIGHTLY" | "SCHEDULED";
  projectId: string;
  asOf: string;
  eventId?: string;
}) {
  if (input.trigger === "EVENT" && input.eventId === undefined) {
    throw new Error("EVENT trigger requires eventId");
  }

  return ["a2", input.trigger.toLowerCase(), input.projectId, input.eventId ?? input.asOf].join(
    ":",
  );
}

function localTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

export function calculateNightlyCatchUpRuns(input: {
  lastSuccessfulAt: string;
  now: string;
  timezone: string;
  localHour: number;
  maxRuns?: number;
}) {
  if (!Number.isInteger(input.localHour) || input.localHour < 0 || input.localHour > 23) {
    throw new Error("Nightly local hour must be 0-23");
  }

  const start = Date.parse(input.lastSuccessfulAt);
  const end = Date.parse(input.now);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new Error("Invalid nightly catch-up interval");
  }

  const dates = new Map<string, string>();

  for (let timestamp = start + 3_600_000; timestamp <= end; timestamp += 3_600_000) {
    const instant = new Date(timestamp);
    const local = localTimeParts(instant, input.timezone);

    if (local.hour === input.localHour) {
      dates.set(local.date, instant.toISOString());
    }
  }

  return [...dates.values()].slice(-(input.maxRuns ?? 31));
}
