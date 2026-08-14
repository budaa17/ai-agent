import { Phase9ApiError } from "./contracts.js";
import {
  PLATFORM_QUALITY_MINIMUM_SAMPLE,
  platformQualityQuerySchema,
  platformQualityResponseSchema,
  type PlatformQualityMetric,
  type PlatformQualityResponse,
} from "./platform-advanced-contracts.js";
import type {
  PlatformHumanFeedbackRow,
  PlatformOfflineEvaluationRow,
  PlatformProductionValidationRow,
  PlatformQualityRange,
  PlatformQualityReadModel,
} from "./platform-quality-read-model.js";
import { PLATFORM_QUALITY_RELEASE_LIMIT } from "./platform-quality-read-model.js";
import type { PlatformOverviewSectionContext } from "./platform-overview-contracts.js";
import {
  DAY_MS,
  domainFromSettled,
  iso,
  nonnegativeInteger,
  roundedPercent,
  safeAgentType,
  type Domain,
} from "./platform-read-support.js";

/**
 * Phase 8 AI quality.
 *
 * Three metrics, never one score. Each carries its own window, sample size and
 * source, and each refuses to publish a percentage below the minimum sample —
 * a suite of three cases passing twice is not "67% quality".
 */

const windowDays: Readonly<Record<"7d" | "30d" | "90d", number>> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

interface MetricInput {
  kind: PlatformQualityMetric["kind"];
  label: string;
  definition: string;
  passed: number;
  total: number;
  previousPassed: number;
  previousTotal: number;
  freshAt: Date | null;
  source: string | null;
  available: boolean;
}

function metric(input: MetricInput, range: PlatformQualityRange): PlatformQualityMetric {
  const window = {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    timeZone: "UTC" as const,
  };
  if (!input.available) {
    return {
      kind: input.kind,
      label: input.label,
      definition: input.definition,
      state: "UNKNOWN",
      valuePercent: null,
      passed: null,
      total: null,
      sampleSize: 0,
      minimumSample: PLATFORM_QUALITY_MINIMUM_SAMPLE,
      window,
      freshAt: null,
      previousValuePercent: null,
      deltaPercentagePoints: null,
      source: input.source,
    };
  }
  const state =
    input.total === 0
      ? "NO_DATA"
      : input.total < PLATFORM_QUALITY_MINIMUM_SAMPLE
        ? "INSUFFICIENT_SAMPLE"
        : "AVAILABLE";
  const valuePercent = state === "AVAILABLE" ? roundedPercent(input.passed, input.total) : null;
  const previousValuePercent =
    input.previousTotal >= PLATFORM_QUALITY_MINIMUM_SAMPLE
      ? roundedPercent(input.previousPassed, input.previousTotal)
      : null;
  return {
    kind: input.kind,
    label: input.label,
    definition: input.definition,
    state,
    valuePercent,
    passed: input.passed,
    total: input.total,
    sampleSize: input.total,
    minimumSample: PLATFORM_QUALITY_MINIMUM_SAMPLE,
    window,
    freshAt: iso(input.freshAt),
    previousValuePercent,
    deltaPercentagePoints:
      valuePercent === null || previousValuePercent === null
        ? null
        : Math.round((valuePercent - previousValuePercent) * 10) / 10,
    source: input.source,
  };
}

const offlineDefinition =
  "Passed cases divided by scored cases in the persisted evaluation suite history.";
const productionDefinition =
  "Agent runs whose recorded validation reported ok, divided by runs that produced a validation verdict.";
const humanDefinition =
  "Reviewer decisions accepted without correction, divided by all reviewed agent outputs.";

function offlineMetric(
  row: PlatformOfflineEvaluationRow | undefined,
  range: PlatformQualityRange,
  available: boolean,
): PlatformQualityMetric {
  return metric(
    {
      kind: "OFFLINE_EVALUATION",
      label: "Offline evaluation",
      definition: offlineDefinition,
      passed: nonnegativeInteger(row?.passedCount),
      total: nonnegativeInteger(row?.caseCount),
      previousPassed: nonnegativeInteger(row?.previousPassedCount),
      previousTotal: nonnegativeInteger(row?.previousCaseCount),
      freshAt: row?.latestCompletedAt ?? null,
      source:
        row?.suiteKey == null
          ? null
          : `${row.suiteKey}@${row.suiteVersion ?? "unknown"}`.slice(0, 200),
      available,
    },
    range,
  );
}

function productionMetric(
  row: PlatformProductionValidationRow | undefined,
  range: PlatformQualityRange,
  available: boolean,
): PlatformQualityMetric {
  return metric(
    {
      kind: "PRODUCTION_VALIDATION",
      label: "Production validation",
      definition: productionDefinition,
      passed: nonnegativeInteger(row?.passed),
      total: nonnegativeInteger(row?.evaluated),
      previousPassed: nonnegativeInteger(row?.previousPassed),
      previousTotal: nonnegativeInteger(row?.previousEvaluated),
      freshAt: row?.lastSeenAt ?? null,
      source: "AgentRun.validation",
      available,
    },
    range,
  );
}

function humanMetric(
  row: PlatformHumanFeedbackRow | undefined,
  range: PlatformQualityRange,
  available: boolean,
): PlatformQualityMetric {
  return metric(
    {
      kind: "HUMAN_FEEDBACK",
      label: "Human feedback",
      definition: humanDefinition,
      passed: nonnegativeInteger(row?.accepted),
      total: nonnegativeInteger(row?.reviewed),
      previousPassed: nonnegativeInteger(row?.previousAccepted),
      previousTotal: nonnegativeInteger(row?.previousReviewed),
      freshAt: row?.lastReviewedAt ?? null,
      source: "AgentFeedback",
      available,
    },
    range,
  );
}

function sectionContext(
  domain: Domain<unknown>,
  appliedFilters: ("TENANT_ID" | "AGENT_TYPE")[],
): PlatformOverviewSectionContext {
  return {
    state: domain.available ? "AVAILABLE" : domain.stale ? "PARTIAL" : "UNKNOWN",
    freshness: domain.freshness,
    appliedFilters,
  };
}

/** A grouping-set row with a null release is the agent-level rollup. */
function isAgentLevel(row: { agentRelease: string | null }): boolean {
  return row.agentRelease === null;
}

export class PlatformQualityService {
  constructor(
    private readonly readModel: PlatformQualityReadModel,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async quality(rawQuery: unknown): Promise<PlatformQualityResponse> {
    const asOf = new Date(this.now());
    const query = platformQualityQuerySchema.parse(rawQuery);
    const windowKey = query.window ?? "30d";
    const days = windowDays[windowKey];
    const range: PlatformQualityRange = {
      asOf,
      from: new Date(asOf.getTime() - days * DAY_MS),
      to: asOf,
      previousFrom: new Date(asOf.getTime() - 2 * days * DAY_MS),
    };
    const agentType = query.agentType ?? null;
    if (agentType !== null && safeAgentType(agentType) === null) {
      throw new Phase9ApiError("VALIDATION_FAILED", 400, "Agent type is not valid");
    }

    const [settled] = await Promise.allSettled([
      this.readModel.queryQuality(range, agentType),
    ]);
    const generatedAt = new Date(this.now());
    const quality = domainFromSettled(settled, generatedAt);
    const available = quality.available;
    const data = available
      ? quality.data
      : { offline: [], production: [], humanFeedback: [], history: [] };
    const problems = available
      ? []
      : [
          {
            section: "AGENTS" as const,
            code: quality.stale ? ("SOURCE_STALE" as const) : ("SOURCE_UNAVAILABLE" as const),
            message: "Quality metrics are temporarily unavailable.",
            retryable: true,
          },
        ];
    const appliedFilters = (agentType === null ? [] : ["AGENT_TYPE"]) as (
      | "TENANT_ID"
      | "AGENT_TYPE"
    )[];
    const context = sectionContext(quality, appliedFilters);

    // Platform-wide totals: sum the agent-level rollups, never the release rows,
    // so a run is not counted twice.
    const totals = (rows: { agentRelease: string | null }[]) => rows.filter(isAgentLevel);
    const sum = <T>(rows: T[], pick: (row: T) => bigint | number | null | undefined) =>
      rows.reduce((accumulator, row) => accumulator + nonnegativeInteger(pick(row)), 0);

    const offlineAgents = totals(data.offline) as PlatformOfflineEvaluationRow[];
    const productionAgents = totals(data.production) as PlatformProductionValidationRow[];
    const humanAgents = totals(data.humanFeedback) as PlatformHumanFeedbackRow[];

    const platformOffline = offlineMetric(
      {
        agentType: "*",
        agentRelease: null,
        caseCount: sum(offlineAgents, (row) => row.caseCount),
        passedCount: sum(offlineAgents, (row) => row.passedCount),
        runCount: sum(offlineAgents, (row) => row.runCount),
        previousCaseCount: sum(offlineAgents, (row) => row.previousCaseCount),
        previousPassedCount: sum(offlineAgents, (row) => row.previousPassedCount),
        latestCompletedAt:
          offlineAgents
            .map((row) => row.latestCompletedAt)
            .filter((value): value is Date => value !== null)
            .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
        suiteKey: offlineAgents.at(0)?.suiteKey ?? null,
        suiteVersion: offlineAgents.at(0)?.suiteVersion ?? null,
      },
      range,
      available,
    );
    const platformProduction = productionMetric(
      {
        agentType: "*",
        agentRelease: null,
        promptVersion: null,
        modelId: null,
        provider: null,
        evaluated: sum(productionAgents, (row) => row.evaluated),
        passed: sum(productionAgents, (row) => row.passed),
        previousEvaluated: sum(productionAgents, (row) => row.previousEvaluated),
        previousPassed: sum(productionAgents, (row) => row.previousPassed),
        runs: sum(productionAgents, (row) => row.runs),
        firstSeenAt: null,
        lastSeenAt:
          productionAgents
            .map((row) => row.lastSeenAt)
            .filter((value): value is Date => value !== null)
            .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
      },
      range,
      available,
    );
    const platformHuman = humanMetric(
      {
        agentType: "*",
        agentRelease: null,
        reviewed: sum(humanAgents, (row) => row.reviewed),
        accepted: sum(humanAgents, (row) => row.accepted),
        previousReviewed: sum(humanAgents, (row) => row.previousReviewed),
        previousAccepted: sum(humanAgents, (row) => row.previousAccepted),
        lastReviewedAt:
          humanAgents
            .map((row) => row.lastReviewedAt)
            .filter((value): value is Date => value !== null)
            .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
      },
      range,
      available,
    );

    const agentTypes = [
      ...new Set([
        ...offlineAgents.map((row) => row.agentType),
        ...productionAgents.map((row) => row.agentType),
        ...humanAgents.map((row) => row.agentType),
      ]),
    ]
      .map((value) => safeAgentType(value))
      .filter((value): value is string => value !== null)
      .sort()
      .slice(0, 50);

    const byAgent = agentTypes.map((agent) => ({
      agentType: agent,
      offline:
        offlineAgents.find((row) => row.agentType === agent) === undefined
          ? null
          : offlineMetric(
              offlineAgents.find((row) => row.agentType === agent),
              range,
              available,
            ),
      production:
        productionAgents.find((row) => row.agentType === agent) === undefined
          ? null
          : productionMetric(
              productionAgents.find((row) => row.agentType === agent),
              range,
              available,
            ),
      humanFeedback:
        humanAgents.find((row) => row.agentType === agent) === undefined
          ? null
          : humanMetric(humanAgents.find((row) => row.agentType === agent), range, available),
      detailHref: `/platform/agents/${encodeURIComponent(agent)}`,
    }));

    // Release comparison is anchored on production rows, which are the only
    // source that always carries provider and model identity.
    const releaseRows = data.production.filter((row) => !isAgentLevel(row));
    const releases = releaseRows
      .map((row) => {
        const release = row.agentRelease;
        const agent = safeAgentType(row.agentType);
        if (release === null || agent === null || row.firstSeenAt === null) return null;
        return {
          agentRelease: release.slice(0, 200),
          promptVersion: (row.promptVersion ?? "legacy").slice(0, 60),
          modelId: (row.modelId ?? "unknown").slice(0, 120),
          provider: (row.provider ?? "unknown").slice(0, 60),
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastSeenAt: (row.lastSeenAt ?? row.firstSeenAt).toISOString(),
          offline: (() => {
            const found = data.offline.find(
              (candidate) =>
                candidate.agentType === row.agentType && candidate.agentRelease === release,
            );
            return found === undefined ? null : offlineMetric(found, range, available);
          })(),
          production: productionMetric(row, range, available),
          humanFeedback: (() => {
            const found = data.humanFeedback.find(
              (candidate) =>
                candidate.agentType === row.agentType && candidate.agentRelease === release,
            );
            return found === undefined ? null : humanMetric(found, range, available);
          })(),
          runs: nonnegativeInteger(row.runs),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort(
        (left, right) =>
          Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) ||
          left.agentRelease.localeCompare(right.agentRelease),
      );

    return platformQualityResponseSchema.parse({
      schemaVersion: "platform-quality.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: asOf.toISOString(),
      partial: problems.length > 0,
      problems,
      filters: { window: windowKey, agentType },
      metrics: {
        context,
        items: [platformOffline, platformProduction, platformHuman],
      },
      byAgent: { context, items: byAgent },
      releases: {
        context,
        total: releases.length,
        truncated: releases.length > PLATFORM_QUALITY_RELEASE_LIMIT,
        items: releases.slice(0, PLATFORM_QUALITY_RELEASE_LIMIT),
      },
      evaluationHistory: {
        context,
        total: data.history.length,
        items: data.history.map((row) => {
          const caseCount = nonnegativeInteger(row.caseCount);
          const passedCount = nonnegativeInteger(row.passedCount);
          return {
            runId: row.id,
            suiteKey: row.suiteKey.slice(0, 120),
            suiteVersion: row.suiteVersion.slice(0, 60),
            agentType: safeAgentType(row.agentType) ?? "unknown",
            agentRelease: row.agentRelease.slice(0, 200),
            caseCount,
            passedCount,
            failedCount: nonnegativeInteger(row.failedCount),
            skippedCount: nonnegativeInteger(row.skippedCount),
            scorePercent:
              caseCount >= PLATFORM_QUALITY_MINIMUM_SAMPLE
                ? roundedPercent(passedCount, caseCount)
                : null,
            completedAt: row.completedAt.toISOString(),
            sourceRef: row.sourceRef === null ? null : row.sourceRef.slice(0, 200) || null,
          };
        }),
      },
    });
  }
}
