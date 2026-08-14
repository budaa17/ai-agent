import { performance } from "node:perf_hooks";
import { Prisma, type PrismaClient } from "@prisma/client";

export type PlatformOverviewSource = "LIVE_QUERY" | "LIVE_PROBE" | "SNAPSHOT";

export interface PlatformOverviewQueryResult<T> {
  data: T;
  source: PlatformOverviewSource;
  freshAt: Date | null;
}

export interface PlatformOverviewReadInput {
  asOf: Date;
  selectedFrom: Date;
  selectedTo: Date;
  previousFrom: Date;
  monthStart: Date;
  previousMonthStart: Date;
  previousMonthComparableTo: Date;
  rolling15From: Date;
  stuckBefore: Date;
  scanFrom: Date;
  tenantId: string | null;
  agentType: string | null;
}

type DatabaseInteger = bigint | number;

export interface PlatformAgentAggregateRow {
  scopeKind: "GLOBAL" | "TENANT" | "AGENT";
  tenantId: string | null;
  agentType: string | null;
  runs: DatabaseInteger;
  completed: DatabaseInteger;
  failed: DatabaseInteger;
  degraded: DatabaseInteger;
  rejected: DatabaseInteger;
  terminal: DatabaseInteger;
  previousCompleted: DatabaseInteger;
  previousTerminal: DatabaseInteger;
  rollingTerminal: DatabaseInteger;
  rollingNonCompletion: DatabaseInteger;
  rollingProviderFailures: DatabaseInteger;
  oldestRollingFailureAt: Date | null;
  p50LatencyMs: DatabaseInteger | null;
  p95LatencyMs: DatabaseInteger | null;
  retriedRuns: DatabaseInteger;
  lastSuccessAt: Date | null;
  mtdCostMicroUsd: DatabaseInteger;
  mtdActualMicroUsd: DatabaseInteger;
  mtdEstimatedMicroUsd: DatabaseInteger;
  mtdActualRunCount: DatabaseInteger;
  mtdEstimatedRunCount: DatabaseInteger;
  previousMonthCostMicroUsd: DatabaseInteger;
  previousMonthRunCount: DatabaseInteger;
  /** Cost in the selected window, for the Phase 8 anomaly rule. */
  windowCostMicroUsd: DatabaseInteger;
  windowCostRunCount: DatabaseInteger;
  /** The same length of window immediately before it, as the baseline. */
  previousWindowCostMicroUsd: DatabaseInteger;
  previousWindowCostRunCount: DatabaseInteger;
}

export interface PlatformStuckAggregateRow {
  scopeKind: "GLOBAL" | "TENANT" | "AGENT";
  tenantId: string | null;
  agentType: string | null;
  stuck: DatabaseInteger;
  oldestStuckAt: Date | null;
}

export interface PlatformAgentMetricsData {
  aggregates: PlatformAgentAggregateRow[];
  stuck: PlatformStuckAggregateRow[];
}

export interface PlatformReviewAggregateRow {
  scopeKind: "GLOBAL" | "TENANT";
  tenantId: string | null;
  waiting: DatabaseInteger;
  breached: DatabaseInteger;
  withoutDueAt: DatabaseInteger;
  oldestWaitingAt: Date | null;
  oldestBreachedDueAt: Date | null;
}

export interface PlatformTenantBaseRow {
  tenantId: string;
  name: string;
  activeAccounts: DatabaseInteger;
  loggedIn24h: DatabaseInteger;
  storageBytes: DatabaseInteger;
  lastActivityAt: Date | null;
}

export interface PlatformSystemAggregateRow {
  kind: "OUTBOX" | "NOTIFICATION" | "FILE";
  scopeKind: "GLOBAL" | "TENANT";
  tenantId: string | null;
  pendingCount: DatabaseInteger;
  stalledCount: DatabaseInteger;
  failedCount: DatabaseInteger;
  deadLetterCount: DatabaseInteger;
  quarantinedCount: DatabaseInteger;
  oldestEvidenceAt: Date | null;
}

export interface PlatformPostgresProbeData {
  latencyMs: number;
  checkedAt: Date;
}

export interface PlatformAuditScalarRow {
  id: string;
  actorPrincipalId: string | null;
  actorDisplayName: string | null;
  actorRole: string | null;
  tenantId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  result: "SUCCESS" | "DENIED" | "FAILED";
  occurredAt: Date;
  correlationId: string;
}

export interface PlatformOverviewReadModel {
  queryAgentMetrics(
    input: PlatformOverviewReadInput,
  ): Promise<PlatformOverviewQueryResult<PlatformAgentMetricsData>>;
  queryReviewMetrics(
    input: PlatformOverviewReadInput,
  ): Promise<PlatformOverviewQueryResult<PlatformReviewAggregateRow[]>>;
  queryTenantBase(
    input: PlatformOverviewReadInput,
  ): Promise<PlatformOverviewQueryResult<PlatformTenantBaseRow[]>>;
  querySystemAggregates(
    input: PlatformOverviewReadInput,
  ): Promise<PlatformOverviewQueryResult<PlatformSystemAggregateRow[]>>;
  probePostgres(): Promise<PlatformOverviewQueryResult<PlatformPostgresProbeData>>;
  queryRecentAudit(
    input: PlatformOverviewReadInput,
  ): Promise<PlatformOverviewQueryResult<PlatformAuditScalarRow[]>>;
}

function liveQuery<T>(data: T, now: () => Date): PlatformOverviewQueryResult<T> {
  return { data, source: "LIVE_QUERY", freshAt: now() };
}

export class PrismaPlatformOverviewReadModel implements PlatformOverviewReadModel {
  constructor(
    private readonly client: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async queryAgentMetrics(input: PlatformOverviewReadInput) {
    const tenantFilter =
      input.tenantId === null ? Prisma.empty : Prisma.sql`AND ar."tenantId" = ${input.tenantId}`;
    const agentFilter =
      input.agentType === null ? Prisma.empty : Prisma.sql`AND ar."agentType" = ${input.agentType}`;
    const [aggregates, stuck] = await Promise.all([
      this.client.$queryRaw<PlatformAgentAggregateRow[]>(Prisma.sql`
        SELECT
          CASE
            WHEN GROUPING(ar."tenantId") = 1 AND GROUPING(ar."agentType") = 1 THEN 'GLOBAL'
            WHEN GROUPING(ar."tenantId") = 0 THEN 'TENANT'
            ELSE 'AGENT'
          END AS "scopeKind",
          CASE WHEN GROUPING(ar."tenantId") = 0 THEN ar."tenantId" ELSE NULL END AS "tenantId",
          CASE WHEN GROUPING(ar."agentType") = 0 THEN ar."agentType" ELSE NULL END AS "agentType",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo}) AS "runs",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo} AND ar.status = 'COMPLETED') AS "completed",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo} AND ar.status = 'FAILED') AS "failed",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo} AND ar.status = 'DEGRADED') AS "degraded",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo} AND ar.status = 'REJECTED') AS "rejected",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED')) AS "terminal",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.previousFrom} AND ar."startedAt" < ${input.selectedFrom} AND ar.status = 'COMPLETED') AS "previousCompleted",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.previousFrom} AND ar."startedAt" < ${input.selectedFrom} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED')) AS "previousTerminal",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.rolling15From} AND ar."startedAt" < ${input.asOf} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED')) AS "rollingTerminal",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.rolling15From} AND ar."startedAt" < ${input.asOf} AND ar.status IN ('FAILED','DEGRADED','REJECTED')) AS "rollingNonCompletion",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.rolling15From} AND ar."startedAt" < ${input.asOf} AND ar.status IN ('FAILED','DEGRADED','REJECTED') AND ar."failureCategory" IN ('PROVIDER','RATE_LIMIT','TIMEOUT','CIRCUIT_OPEN')) AS "rollingProviderFailures",
          MIN(ar."startedAt") FILTER (WHERE ar."startedAt" >= ${input.rolling15From} AND ar."startedAt" < ${input.asOf} AND ar.status IN ('FAILED','DEGRADED','REJECTED')) AS "oldestRollingFailureAt",
          percentile_disc(0.5) WITHIN GROUP (ORDER BY ar."latencyMs") FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED') AND ar."latencyMs" > 0) AS "p50LatencyMs",
          percentile_disc(0.95) WITHIN GROUP (ORDER BY ar."latencyMs") FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED') AND ar."latencyMs" > 0) AS "p95LatencyMs",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo} AND ar."retryCount" > 0) AS "retriedRuns",
          MAX(ar."completedAt") FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo} AND ar.status = 'COMPLETED') AS "lastSuccessAt",
          COALESCE(SUM(CASE WHEN ar."startedAt" >= ${input.monthStart} AND ar."startedAt" < ${input.asOf} THEN COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd") ELSE 0 END),0) AS "mtdCostMicroUsd",
          COALESCE(SUM(CASE WHEN ar."startedAt" >= ${input.monthStart} AND ar."startedAt" < ${input.asOf} AND ar."actualCostMicroUsd" IS NOT NULL THEN ar."actualCostMicroUsd" ELSE 0 END),0) AS "mtdActualMicroUsd",
          COALESCE(SUM(CASE WHEN ar."startedAt" >= ${input.monthStart} AND ar."startedAt" < ${input.asOf} AND ar."actualCostMicroUsd" IS NULL THEN ar."estimatedCostMicroUsd" ELSE 0 END),0) AS "mtdEstimatedMicroUsd",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.monthStart} AND ar."startedAt" < ${input.asOf} AND ar."actualCostMicroUsd" IS NOT NULL) AS "mtdActualRunCount",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.monthStart} AND ar."startedAt" < ${input.asOf} AND ar."actualCostMicroUsd" IS NULL) AS "mtdEstimatedRunCount",
          COALESCE(SUM(CASE WHEN ar."startedAt" >= ${input.previousMonthStart} AND ar."startedAt" < ${input.previousMonthComparableTo} THEN COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd") ELSE 0 END),0) AS "previousMonthCostMicroUsd",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.previousMonthStart} AND ar."startedAt" < ${input.previousMonthComparableTo}) AS "previousMonthRunCount",
          COALESCE(SUM(CASE WHEN ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo} THEN COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd") ELSE 0 END),0) AS "windowCostMicroUsd",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.selectedFrom} AND ar."startedAt" < ${input.selectedTo}) AS "windowCostRunCount",
          COALESCE(SUM(CASE WHEN ar."startedAt" >= ${input.previousFrom} AND ar."startedAt" < ${input.selectedFrom} THEN COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd") ELSE 0 END),0) AS "previousWindowCostMicroUsd",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${input.previousFrom} AND ar."startedAt" < ${input.selectedFrom}) AS "previousWindowCostRunCount"
        FROM "AgentRun" ar
        WHERE ar."startedAt" >= ${input.scanFrom}
          AND ar."startedAt" < ${input.asOf}
          ${tenantFilter}
          ${agentFilter}
        GROUP BY GROUPING SETS ((), (ar."tenantId"), (ar."agentType"))
      `),
      this.client.$queryRaw<PlatformStuckAggregateRow[]>(Prisma.sql`
        SELECT
          CASE
            WHEN GROUPING(ar."tenantId") = 1 AND GROUPING(ar."agentType") = 1 THEN 'GLOBAL'
            WHEN GROUPING(ar."tenantId") = 0 THEN 'TENANT'
            ELSE 'AGENT'
          END AS "scopeKind",
          CASE WHEN GROUPING(ar."tenantId") = 0 THEN ar."tenantId" ELSE NULL END AS "tenantId",
          CASE WHEN GROUPING(ar."agentType") = 0 THEN ar."agentType" ELSE NULL END AS "agentType",
          COUNT(*) AS "stuck",
          MIN(ar."startedAt") AS "oldestStuckAt"
        FROM "AgentRun" ar
        WHERE ar.status = 'RUNNING'
          AND ar."startedAt" <= ${input.stuckBefore}
          AND ar."startedAt" < ${input.asOf}
          ${tenantFilter}
          ${agentFilter}
        GROUP BY GROUPING SETS ((), (ar."tenantId"), (ar."agentType"))
      `),
    ]);
    return liveQuery({ aggregates, stuck }, this.now);
  }

  async queryReviewMetrics(input: PlatformOverviewReadInput) {
    const tenantFilter =
      input.tenantId === null ? Prisma.empty : Prisma.sql`AND rt."tenantId" = ${input.tenantId}`;
    const rows = await this.client.$queryRaw<PlatformReviewAggregateRow[]>(Prisma.sql`
      SELECT
        CASE WHEN GROUPING(rt."tenantId") = 1 THEN 'GLOBAL' ELSE 'TENANT' END AS "scopeKind",
        CASE WHEN GROUPING(rt."tenantId") = 0 THEN rt."tenantId" ELSE NULL END AS "tenantId",
        COUNT(*) FILTER (WHERE rt.status = 'REVIEW_REQUIRED') AS "waiting",
        COUNT(*) FILTER (WHERE rt.status = 'REVIEW_REQUIRED' AND rt."dueAt" < ${input.asOf}) AS "breached",
        COUNT(*) FILTER (WHERE rt.status = 'REVIEW_REQUIRED' AND rt."dueAt" IS NULL) AS "withoutDueAt",
        MIN(rt."createdAt") FILTER (WHERE rt.status = 'REVIEW_REQUIRED') AS "oldestWaitingAt",
        MIN(rt."dueAt") FILTER (WHERE rt.status = 'REVIEW_REQUIRED' AND rt."dueAt" < ${input.asOf}) AS "oldestBreachedDueAt"
      FROM "ReviewTask" rt
      WHERE TRUE ${tenantFilter}
      GROUP BY GROUPING SETS ((), (rt."tenantId"))
    `);
    return liveQuery(rows, this.now);
  }

  async queryTenantBase(input: PlatformOverviewReadInput) {
    const tenantFilter =
      input.tenantId === null ? Prisma.empty : Prisma.sql`WHERE t.id = ${input.tenantId}`;
    const activityTenantFilter =
      input.tenantId === null
        ? Prisma.empty
        : Prisma.sql`AND activity."tenantId" = ${input.tenantId}`;
    const rows = await this.client.$queryRaw<PlatformTenantBaseRow[]>(Prisma.sql`
      WITH filtered_tenants AS (
        SELECT t.id, t.name, t."createdAt", t."updatedAt"
        FROM "Tenant" t
        ${tenantFilter}
      ), user_metrics AS (
        SELECT u."tenantId",
          COUNT(*) FILTER (WHERE u.status = 'ACTIVE' AND u."deletedAt" IS NULL) AS "activeAccounts",
          COUNT(*) FILTER (WHERE u.status = 'ACTIVE' AND u."deletedAt" IS NULL AND u."lastLoginAt" >= ${new Date(input.asOf.getTime() - 24 * 60 * 60 * 1_000)} AND u."lastLoginAt" < ${input.asOf}) AS "loggedIn24h"
        FROM "User" u
        JOIN filtered_tenants t ON t.id = u."tenantId"
        GROUP BY u."tenantId"
      ), storage_metrics AS (
        SELECT f."tenantId", COALESCE(SUM(f."sizeBytes"),0)::bigint AS "storageBytes"
        FROM "FileAsset" f
        JOIN filtered_tenants t ON t.id = f."tenantId"
        WHERE f."deletedAt" IS NULL AND f.status <> 'DELETED'
        GROUP BY f."tenantId"
      ), activity AS (
        SELECT t.id AS "tenantId", GREATEST(t."createdAt", t."updatedAt") AS at FROM filtered_tenants t
        UNION ALL SELECT u."tenantId", u."lastLoginAt" FROM "User" u JOIN filtered_tenants t ON t.id=u."tenantId" WHERE u."lastLoginAt" IS NOT NULL
        UNION ALL SELECT ar."tenantId", ar."startedAt" FROM "AgentRun" ar JOIN filtered_tenants t ON t.id=ar."tenantId"
        UNION ALL SELECT rt."tenantId", rt."updatedAt" FROM "ReviewTask" rt JOIN filtered_tenants t ON t.id=rt."tenantId"
        UNION ALL SELECT oe."tenantId", oe."createdAt" FROM "OutboxEvent" oe JOIN filtered_tenants t ON t.id=oe."tenantId"
        UNION ALL SELECT n."tenantId", n."createdAt" FROM "Notification" n JOIN filtered_tenants t ON t.id=n."tenantId"
        UNION ALL SELECT f."tenantId", f."createdAt" FROM "FileAsset" f JOIN filtered_tenants t ON t.id=f."tenantId" WHERE f."deletedAt" IS NULL AND f.status <> 'DELETED'
        UNION ALL SELECT al."tenantId", al."occurredAt" FROM "AuditLog" al JOIN filtered_tenants t ON t.id=al."tenantId"
      ), last_activity AS (
        SELECT activity."tenantId", MAX(activity.at) AS "lastActivityAt"
        FROM activity
        WHERE TRUE ${activityTenantFilter}
        GROUP BY activity."tenantId"
      )
      SELECT t.id AS "tenantId", t.name,
        COALESCE(um."activeAccounts",0) AS "activeAccounts",
        COALESCE(um."loggedIn24h",0) AS "loggedIn24h",
        COALESCE(sm."storageBytes",0) AS "storageBytes",
        la."lastActivityAt"
      FROM filtered_tenants t
      LEFT JOIN user_metrics um ON um."tenantId"=t.id
      LEFT JOIN storage_metrics sm ON sm."tenantId"=t.id
      LEFT JOIN last_activity la ON la."tenantId"=t.id
      ORDER BY t.id ASC
    `);
    return liveQuery(rows, this.now);
  }

  async querySystemAggregates(input: PlatformOverviewReadInput) {
    const rows = await this.client.$queryRaw<PlatformSystemAggregateRow[]>(Prisma.sql`
      SELECT 'OUTBOX' AS kind,
        CASE WHEN GROUPING(oe."tenantId")=1 THEN 'GLOBAL' ELSE 'TENANT' END AS "scopeKind",
        CASE WHEN GROUPING(oe."tenantId")=0 THEN oe."tenantId" ELSE NULL END AS "tenantId",
        COUNT(*) FILTER (WHERE oe.status='PENDING' AND oe."availableAt" <= ${input.asOf}) AS "pendingCount",
        COUNT(*) FILTER (WHERE oe.status='PENDING' AND oe."availableAt" <= ${new Date(input.asOf.getTime() - 10 * 60_000)}) AS "stalledCount",
        COUNT(*) FILTER (WHERE oe.status='FAILED') AS "failedCount",
        COUNT(*) FILTER (WHERE oe.status='DEAD_LETTER') AS "deadLetterCount",
        0::bigint AS "quarantinedCount",
        LEAST(
          MIN(oe."availableAt") FILTER (WHERE oe.status='PENDING' AND oe."availableAt" <= ${new Date(input.asOf.getTime() - 10 * 60_000)}),
          MIN(oe."createdAt") FILTER (WHERE oe.status IN ('FAILED','DEAD_LETTER'))
        ) AS "oldestEvidenceAt"
      FROM "OutboxEvent" oe
      GROUP BY GROUPING SETS ((),(oe."tenantId"))
      UNION ALL
      SELECT 'NOTIFICATION' AS kind,
        CASE WHEN GROUPING(n."tenantId")=1 THEN 'GLOBAL' ELSE 'TENANT' END AS "scopeKind",
        CASE WHEN GROUPING(n."tenantId")=0 THEN n."tenantId" ELSE NULL END AS "tenantId",
        COUNT(*) FILTER (WHERE n.status='PENDING') AS "pendingCount",
        COUNT(*) FILTER (WHERE n.status='PENDING' AND n."createdAt" <= ${new Date(input.asOf.getTime() - 10 * 60_000)}) AS "stalledCount",
        COUNT(*) FILTER (WHERE n.status='FAILED') AS "failedCount",
        0::bigint AS "deadLetterCount",
        0::bigint AS "quarantinedCount",
        LEAST(
          MIN(n."createdAt") FILTER (WHERE n.status='PENDING' AND n."createdAt" <= ${new Date(input.asOf.getTime() - 10 * 60_000)}),
          MIN(n."createdAt") FILTER (WHERE n.status='FAILED')
        ) AS "oldestEvidenceAt"
      FROM "Notification" n
      GROUP BY GROUPING SETS ((),(n."tenantId"))
      UNION ALL
      SELECT 'FILE' AS kind,
        CASE WHEN GROUPING(f."tenantId")=1 THEN 'GLOBAL' ELSE 'TENANT' END AS "scopeKind",
        CASE WHEN GROUPING(f."tenantId")=0 THEN f."tenantId" ELSE NULL END AS "tenantId",
        COUNT(*) FILTER (WHERE f.status='PENDING' AND f."deletedAt" IS NULL) AS "pendingCount",
        COUNT(*) FILTER (WHERE f.status='PENDING' AND f."deletedAt" IS NULL AND f."createdAt" <= ${new Date(input.asOf.getTime() - 15 * 60_000)}) AS "stalledCount",
        0::bigint AS "failedCount",
        0::bigint AS "deadLetterCount",
        COUNT(*) FILTER (WHERE f.status='QUARANTINED' AND f."deletedAt" IS NULL) AS "quarantinedCount",
        LEAST(
          MIN(f."createdAt") FILTER (WHERE f.status='PENDING' AND f."deletedAt" IS NULL AND f."createdAt" <= ${new Date(input.asOf.getTime() - 15 * 60_000)}),
          MIN(f."createdAt") FILTER (WHERE f.status='QUARANTINED' AND f."deletedAt" IS NULL)
        ) AS "oldestEvidenceAt"
      FROM "FileAsset" f
      GROUP BY GROUPING SETS ((),(f."tenantId"))
    `);
    return liveQuery(rows, this.now);
  }

  async probePostgres() {
    const startedAt = performance.now();
    await this.client.$queryRaw(Prisma.sql`SELECT 1 AS "ok"`);
    const checkedAt = this.now();
    return {
      data: { latencyMs: Math.max(0, Math.round(performance.now() - startedAt)), checkedAt },
      source: "LIVE_PROBE" as const,
      freshAt: checkedAt,
    };
  }

  async queryRecentAudit(input: PlatformOverviewReadInput) {
    const platformTenantFilter =
      input.tenantId === null ? Prisma.empty : Prisma.sql`WHERE pal."tenantId" = ${input.tenantId}`;
    const tenantAuditFilter =
      input.tenantId === null ? Prisma.empty : Prisma.sql`WHERE al."tenantId" = ${input.tenantId}`;
    const rows = await this.client.$queryRaw<PlatformAuditScalarRow[]>(Prisma.sql`
      WITH recent_audit AS (
        (
          SELECT 'P:' || pal.id AS id,
            pal."actorPrincipalId",
            pp."displayName" AS "actorDisplayName",
            pal."actorRole"::text AS "actorRole",
            pal."tenantId",
            pal.action,
            pal."entityType",
            pal."entityId",
            pal.result::text AS result,
            pal."occurredAt",
            pal."correlationId"
          FROM "PlatformAuditLog" pal
          LEFT JOIN "PlatformPrincipal" pp ON pp.id = pal."actorPrincipalId"
          ${platformTenantFilter}
          ORDER BY pal."occurredAt" DESC, pal.id DESC
          LIMIT 5
        )
        UNION ALL
        (
          SELECT 'T:' || al.id AS id,
            al."actorUserId" AS "actorPrincipalId",
            u."displayName" AS "actorDisplayName",
            al."actorRole"::text AS "actorRole",
            al."tenantId",
            al.action,
            al."entityType",
            al."entityId",
            'SUCCESS'::text AS result,
            al."occurredAt",
            al."correlationId"
          FROM "AuditLog" al
          LEFT JOIN "User" u ON u.id = al."actorUserId" AND u."tenantId" = al."tenantId"
          ${tenantAuditFilter}
          ORDER BY al."occurredAt" DESC, al.id DESC
          LIMIT 5
        )
      )
      SELECT * FROM recent_audit
      ORDER BY "occurredAt" DESC, id DESC
      LIMIT 5
    `);
    return liveQuery(rows, this.now);
  }
}
