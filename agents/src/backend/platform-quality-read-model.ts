import { Prisma, type PrismaClient } from "@prisma/client";
import type { PlatformOverviewQueryResult } from "./platform-overview-read-model.js";

/**
 * Read side of the Phase 8 AI quality module. The three metrics come from three
 * genuinely different sources and are never mixed:
 *
 * - offline evaluation  → `PlatformEvaluationRun` (persisted suite history)
 * - production validation → `AgentRun.validation` shape only, never its content
 * - human feedback      → `AgentFeedback` (reviewer rejections and corrections)
 */

type DatabaseInteger = bigint | number;

export interface PlatformQualityRange {
  asOf: Date;
  from: Date;
  to: Date;
  previousFrom: Date;
}

export const PLATFORM_QUALITY_RELEASE_LIMIT = 25;
export const PLATFORM_QUALITY_HISTORY_LIMIT = 50;

export interface PlatformOfflineEvaluationRow {
  agentType: string;
  agentRelease: string | null;
  caseCount: DatabaseInteger;
  passedCount: DatabaseInteger;
  runCount: DatabaseInteger;
  previousCaseCount: DatabaseInteger;
  previousPassedCount: DatabaseInteger;
  latestCompletedAt: Date | null;
  suiteKey: string | null;
  suiteVersion: string | null;
}

export interface PlatformProductionValidationRow {
  agentType: string;
  agentRelease: string | null;
  promptVersion: string | null;
  modelId: string | null;
  provider: string | null;
  evaluated: DatabaseInteger;
  passed: DatabaseInteger;
  previousEvaluated: DatabaseInteger;
  previousPassed: DatabaseInteger;
  runs: DatabaseInteger;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface PlatformHumanFeedbackRow {
  agentType: string;
  agentRelease: string | null;
  reviewed: DatabaseInteger;
  accepted: DatabaseInteger;
  previousReviewed: DatabaseInteger;
  previousAccepted: DatabaseInteger;
  lastReviewedAt: Date | null;
}

export interface PlatformEvaluationHistoryRow {
  id: string;
  suiteKey: string;
  suiteVersion: string;
  agentType: string;
  agentRelease: string;
  caseCount: DatabaseInteger;
  passedCount: DatabaseInteger;
  failedCount: DatabaseInteger;
  skippedCount: DatabaseInteger;
  completedAt: Date;
  sourceRef: string | null;
}

export interface PlatformQualityData {
  offline: PlatformOfflineEvaluationRow[];
  production: PlatformProductionValidationRow[];
  humanFeedback: PlatformHumanFeedbackRow[];
  history: PlatformEvaluationHistoryRow[];
}

export interface PlatformQualityReadModel {
  queryQuality(
    range: PlatformQualityRange,
    agentType: string | null,
  ): Promise<PlatformOverviewQueryResult<PlatformQualityData>>;
}

/** Release identity: prompt and tool bundle are what an agent release means. */
const releaseExpression = Prisma.sql`ar."promptVersion" || '+' || ar."toolBundleVersion"`;

export class PrismaPlatformQualityReadModel implements PlatformQualityReadModel {
  constructor(
    private readonly client: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async queryQuality(range: PlatformQualityRange, agentType: string | null) {
    const evaluationFilter =
      agentType === null ? Prisma.empty : Prisma.sql`AND er."agentType" = ${agentType}`;
    const runFilter =
      agentType === null ? Prisma.empty : Prisma.sql`AND ar."agentType" = ${agentType}`;
    const feedbackFilter =
      agentType === null ? Prisma.empty : Prisma.sql`AND af."agentType" = ${agentType}`;

    const [offline, production, humanFeedback, history] = await Promise.all([
      this.client.$queryRaw<PlatformOfflineEvaluationRow[]>(Prisma.sql`
        SELECT er."agentType",
          er."agentRelease",
          COALESCE(SUM(er."caseCount") FILTER (WHERE er."completedAt" >= ${range.from} AND er."completedAt" < ${range.to}),0) AS "caseCount",
          COALESCE(SUM(er."passedCount") FILTER (WHERE er."completedAt" >= ${range.from} AND er."completedAt" < ${range.to}),0) AS "passedCount",
          COUNT(*) FILTER (WHERE er."completedAt" >= ${range.from} AND er."completedAt" < ${range.to}) AS "runCount",
          COALESCE(SUM(er."caseCount") FILTER (WHERE er."completedAt" >= ${range.previousFrom} AND er."completedAt" < ${range.from}),0) AS "previousCaseCount",
          COALESCE(SUM(er."passedCount") FILTER (WHERE er."completedAt" >= ${range.previousFrom} AND er."completedAt" < ${range.from}),0) AS "previousPassedCount",
          MAX(er."completedAt") AS "latestCompletedAt",
          (ARRAY_AGG(er."suiteKey" ORDER BY er."completedAt" DESC))[1] AS "suiteKey",
          (ARRAY_AGG(er."suiteVersion" ORDER BY er."completedAt" DESC))[1] AS "suiteVersion"
        FROM "PlatformEvaluationRun" er
        WHERE er."completedAt" >= ${range.previousFrom}
          AND er."completedAt" < ${range.to}
          ${evaluationFilter}
        GROUP BY GROUPING SETS ((er."agentType"), (er."agentType", er."agentRelease"))
        LIMIT 200
      `),
      this.client.$queryRaw<PlatformProductionValidationRow[]>(Prisma.sql`
        SELECT ar."agentType",
          CASE WHEN GROUPING(${releaseExpression}) = 0 THEN ${releaseExpression} ELSE NULL END AS "agentRelease",
          CASE WHEN GROUPING(${releaseExpression}) = 0 THEN MAX(ar."promptVersion") ELSE NULL END AS "promptVersion",
          CASE WHEN GROUPING(${releaseExpression}) = 0 THEN MAX(ar."modelId") ELSE NULL END AS "modelId",
          CASE WHEN GROUPING(${releaseExpression}) = 0 THEN MAX(ar.provider) ELSE NULL END AS "provider",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND jsonb_typeof(to_jsonb(ar.validation) -> 'ok') = 'boolean') AS "evaluated",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND (to_jsonb(ar.validation) ->> 'ok')::boolean IS TRUE) AS "passed",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.previousFrom} AND ar."startedAt" < ${range.from} AND jsonb_typeof(to_jsonb(ar.validation) -> 'ok') = 'boolean') AS "previousEvaluated",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.previousFrom} AND ar."startedAt" < ${range.from} AND (to_jsonb(ar.validation) ->> 'ok')::boolean IS TRUE) AS "previousPassed",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to}) AS "runs",
          MIN(ar."startedAt") AS "firstSeenAt",
          MAX(ar."startedAt") AS "lastSeenAt"
        FROM "AgentRun" ar
        WHERE ar."startedAt" >= ${range.previousFrom}
          AND ar."startedAt" < ${range.to}
          ${runFilter}
        GROUP BY GROUPING SETS ((ar."agentType"), (ar."agentType", ${releaseExpression}))
        LIMIT 200
      `),
      this.client.$queryRaw<PlatformHumanFeedbackRow[]>(Prisma.sql`
        SELECT af."agentType",
          CASE WHEN GROUPING(af."promptVersion", af."toolBundleVersion") = 0
            THEN af."promptVersion" || '+' || af."toolBundleVersion" ELSE NULL END AS "agentRelease",
          COUNT(*) FILTER (WHERE af."reviewedAt" >= ${range.from} AND af."reviewedAt" < ${range.to}) AS "reviewed",
          COUNT(*) FILTER (WHERE af."reviewedAt" >= ${range.from} AND af."reviewedAt" < ${range.to} AND af."feedbackType" = 'ACCEPT') AS "accepted",
          COUNT(*) FILTER (WHERE af."reviewedAt" >= ${range.previousFrom} AND af."reviewedAt" < ${range.from}) AS "previousReviewed",
          COUNT(*) FILTER (WHERE af."reviewedAt" >= ${range.previousFrom} AND af."reviewedAt" < ${range.from} AND af."feedbackType" = 'ACCEPT') AS "previousAccepted",
          MAX(af."reviewedAt") AS "lastReviewedAt"
        FROM "AgentFeedback" af
        WHERE af."reviewedAt" >= ${range.previousFrom}
          AND af."reviewedAt" < ${range.to}
          ${feedbackFilter}
        GROUP BY GROUPING SETS ((af."agentType"), (af."agentType", af."promptVersion", af."toolBundleVersion"))
        LIMIT 200
      `),
      this.client.$queryRaw<PlatformEvaluationHistoryRow[]>(Prisma.sql`
        SELECT er.id, er."suiteKey", er."suiteVersion", er."agentType", er."agentRelease",
          er."caseCount", er."passedCount", er."failedCount", er."skippedCount",
          er."completedAt", er."sourceRef"
        FROM "PlatformEvaluationRun" er
        WHERE er."completedAt" >= ${range.from}
          AND er."completedAt" < ${range.to}
          ${evaluationFilter}
        ORDER BY er."completedAt" DESC, er.id DESC
        LIMIT ${PLATFORM_QUALITY_HISTORY_LIMIT}
      `),
    ]);

    return {
      data: { offline, production, humanFeedback, history },
      source: "LIVE_QUERY" as const,
      freshAt: this.now(),
    };
  }
}
