import { Prisma, type PrismaClient } from "@prisma/client";
import type { PlatformOverviewQueryResult } from "./platform-overview-read-model.js";

/**
 * Read side of the Phase 5 drill-down endpoints. Like the overview read model,
 * this is the only place allowed to run cross-tenant aggregates: the generic
 * tenant repositories keep their tenant filter and are never wildcarded.
 */

type DatabaseInteger = bigint | number;

export interface PlatformDrilldownRange {
  asOf: Date;
  from: Date;
  to: Date;
  stuckBefore: Date;
  rolling15From: Date;
  monthStart: Date;
}

/** Bounded scan so a pathological tenant count can never load unbounded rows. */
export const PLATFORM_TENANT_SCAN_LIMIT = 500;
export const PLATFORM_AGENT_SCAN_LIMIT = 100;
export const PLATFORM_BREAKDOWN_LIMIT = 25;

export interface PlatformTenantListRow {
  tenantId: string;
  name: string;
  createdAt: Date;
  activeAccounts: DatabaseInteger;
  suspendedAccounts: DatabaseInteger;
  loggedIn24h: DatabaseInteger;
  loggedIn7d: DatabaseInteger;
  neverLoggedIn: DatabaseInteger;
  totalProjects: DatabaseInteger;
  activeProjects: DatabaseInteger;
  storageBytes: DatabaseInteger;
  fileCount: DatabaseInteger;
  quarantinedFiles: DatabaseInteger;
  runs: DatabaseInteger;
  completed: DatabaseInteger;
  failed: DatabaseInteger;
  degraded: DatabaseInteger;
  rejected: DatabaseInteger;
  terminal: DatabaseInteger;
  stuck: DatabaseInteger;
  rollingTerminal: DatabaseInteger;
  rollingNonCompletion: DatabaseInteger;
  oldestRollingFailureAt: Date | null;
  oldestStuckAt: Date | null;
  mtdCostMicroUsd: DatabaseInteger;
  reviewWaiting: DatabaseInteger;
  reviewBreached: DatabaseInteger;
  reviewWithoutDueAt: DatabaseInteger;
  oldestWaitingAt: Date | null;
  oldestBreachedDueAt: Date | null;
  outboxStalled: DatabaseInteger;
  outboxDeadLetter: DatabaseInteger;
  notificationFailed: DatabaseInteger;
  lastActivityAt: Date | null;
}

export interface PlatformTenantAgentRow {
  agentType: string;
  runs: DatabaseInteger;
  terminal: DatabaseInteger;
  completed: DatabaseInteger;
  failed: DatabaseInteger;
  degraded: DatabaseInteger;
  rejected: DatabaseInteger;
  stuck: DatabaseInteger;
  lastSuccessAt: Date | null;
  costMicroUsd: DatabaseInteger;
}

export interface PlatformAgentListRow {
  agentType: string;
  runs: DatabaseInteger;
  terminal: DatabaseInteger;
  completed: DatabaseInteger;
  failed: DatabaseInteger;
  degraded: DatabaseInteger;
  rejected: DatabaseInteger;
  running: DatabaseInteger;
  stuck: DatabaseInteger;
  oldestStuckAt: Date | null;
  rollingTerminal: DatabaseInteger;
  rollingNonCompletion: DatabaseInteger;
  oldestRollingFailureAt: Date | null;
  p50LatencyMs: DatabaseInteger | null;
  p95LatencyMs: DatabaseInteger | null;
  retriedRuns: DatabaseInteger;
  lastSuccessAt: Date | null;
  costMicroUsd: DatabaseInteger;
}

export interface PlatformAgentFailureRow {
  failureCategory: string;
  count: DatabaseInteger;
  lastObservedAt: Date | null;
}

export interface PlatformAgentTenantRow {
  tenantId: string;
  tenantName: string;
  runs: DatabaseInteger;
  terminal: DatabaseInteger;
  completed: DatabaseInteger;
  failed: DatabaseInteger;
  degraded: DatabaseInteger;
  rejected: DatabaseInteger;
  costMicroUsd: DatabaseInteger;
}

export interface PlatformAgentModelRow {
  provider: string;
  modelId: string;
  runs: DatabaseInteger;
  costMicroUsd: DatabaseInteger;
  inputTokens: DatabaseInteger;
  outputTokens: DatabaseInteger;
}

export interface PlatformAgentDetailData {
  failures: PlatformAgentFailureRow[];
  tenants: PlatformAgentTenantRow[];
  models: PlatformAgentModelRow[];
}

export interface PlatformAgentRunRow {
  runId: string;
  tenantId: string;
  tenantName: string;
  projectId: string;
  agentType: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "DEGRADED" | "REJECTED";
  failureCategory: string;
  trigger: string;
  provider: string;
  modelId: string;
  promptVersion: string;
  startedAt: Date;
  completedAt: Date | null;
  latencyMs: DatabaseInteger;
  retryCount: DatabaseInteger;
  estimatedCostMicroUsd: DatabaseInteger;
  actualCostMicroUsd: DatabaseInteger | null;
}

export interface PlatformAgentRunDetailRow extends PlatformAgentRunRow {
  requestId: string | null;
  eventId: string | null;
  traceId: string | null;
  toolBundleVersion: string;
  outputSchemaVersion: DatabaseInteger;
  dataSnapshotVersion: string;
  outputSha256: string | null;
  contentLoggingEnabled: boolean;
  asOf: Date;
  inputTokens: DatabaseInteger;
  outputTokens: DatabaseInteger;
  cachedInputTokens: DatabaseInteger;
  reasoningTokens: DatabaseInteger;
  /** Only the shape of the validation payload is read, never its content. */
  validationState: "PASSED" | "FAILED" | "UNKNOWN";
  validationIssueCount: DatabaseInteger | null;
}

export interface PlatformAgentToolCallRow {
  id: string;
  toolName: string;
  status: string;
  stepNumber: DatabaseInteger;
  durationMs: DatabaseInteger | null;
  occurredAt: Date | null;
}

export interface PlatformAgentRunDiagnosticsData {
  run: PlatformAgentRunDetailRow;
  toolCalls: PlatformAgentToolCallRow[];
  toolCallTotal: DatabaseInteger;
}

export interface PlatformReviewBucketRow {
  bucket: "UNDER_24H" | "H24_TO_72H" | "D3_TO_D7" | "OVER_7D";
  waiting: DatabaseInteger;
  breached: DatabaseInteger;
}

export interface PlatformReviewTenantRow {
  tenantId: string;
  tenantName: string;
  waiting: DatabaseInteger;
  breached: DatabaseInteger;
  oldestWaitingAt: Date | null;
}

export interface PlatformReviewTargetRow {
  targetType: string;
  waiting: DatabaseInteger;
  breached: DatabaseInteger;
}

export interface PlatformReviewTotalsRow {
  waiting: DatabaseInteger;
  breached: DatabaseInteger;
  withoutDueAt: DatabaseInteger;
  draft: DatabaseInteger;
  oldestWaitingAt: Date | null;
  oldestBreachedDueAt: Date | null;
}

export interface PlatformReviewThroughputRow {
  decided: DatabaseInteger;
  approved: DatabaseInteger;
  rejected: DatabaseInteger;
  emergencyOverrides: DatabaseInteger;
  corrected: DatabaseInteger;
}

interface PlatformReviewDecisionAggregateRow {
  decided: DatabaseInteger;
  approved: DatabaseInteger;
  rejected: DatabaseInteger;
  emergencyOverrides: DatabaseInteger;
}

export interface PlatformReviewSummaryData {
  totals: PlatformReviewTotalsRow | null;
  buckets: PlatformReviewBucketRow[];
  tenants: PlatformReviewTenantRow[];
  targets: PlatformReviewTargetRow[];
  throughput: PlatformReviewThroughputRow | null;
}

export interface PlatformReviewBacklogRow {
  reviewTaskId: string;
  tenantId: string;
  tenantName: string;
  projectId: string;
  targetType: string;
  targetVersion: DatabaseInteger;
  assignedRole: string;
  assignedUserId: string | null;
  status: string;
  createdAt: Date;
  dueAt: Date | null;
}

export interface PlatformUsageGroupRow {
  key: string;
  label: string;
  runs: DatabaseInteger;
  costMicroUsd: DatabaseInteger;
  actualMicroUsd: DatabaseInteger;
  estimatedMicroUsd: DatabaseInteger;
  actualRunCount: DatabaseInteger;
  estimatedRunCount: DatabaseInteger;
  inputTokens: DatabaseInteger;
  outputTokens: DatabaseInteger;
  cachedInputTokens: DatabaseInteger;
  reasoningTokens: DatabaseInteger;
}

export interface PlatformOutboxTypeRow {
  eventType: string;
  pending: DatabaseInteger;
  stalled: DatabaseInteger;
  failed: DatabaseInteger;
  deadLetter: DatabaseInteger;
  oldestEvidenceAt: Date | null;
}

export interface PlatformDeliveryTenantRow {
  tenantId: string;
  tenantName: string;
  outboxStalled: DatabaseInteger;
  outboxDeadLetter: DatabaseInteger;
  notificationFailed: DatabaseInteger;
  artifactQuarantined: DatabaseInteger;
}

export interface PlatformSystemDetailData {
  outboxByType: PlatformOutboxTypeRow[];
  tenantImpact: PlatformDeliveryTenantRow[];
}

export interface PlatformAuditRow {
  id: string;
  actorPrincipalId: string | null;
  actorDisplayName: string | null;
  actorRole: string | null;
  tenantId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  result: "SUCCESS" | "DENIED" | "FAILED";
  reason: string | null;
  correlationId: string;
  beforeHash: string | null;
  afterHash: string | null;
  occurredAt: Date;
}

export interface PlatformKeysetPage {
  limit: number;
  cursorAt: Date | null;
  cursorId: string | null;
  order: "ASC" | "DESC";
}

export interface PlatformAgentRunFilter extends PlatformKeysetPage {
  tenantId: string | null;
  agentType: string | null;
  status: string | null;
  outcome: "TERMINAL" | "NON_COMPLETION" | null;
  failureCategory: string | null;
  stuck: boolean;
}

export interface PlatformReviewBacklogFilter extends PlatformKeysetPage {
  tenantId: string | null;
  sla: "ALL" | "BREACHED" | "DUE_SOON" | "NO_DUE_DATE";
  targetType: string | null;
}

export interface PlatformAuditFilter extends PlatformKeysetPage {
  tenantId: string | null;
  actorId: string | null;
  source: "ALL" | "PLATFORM" | "TENANT";
  actorRole: string | null;
  action: string | null;
  result: string | null;
}

export interface PlatformDrilldownReadModel {
  queryTenantList(
    range: PlatformDrilldownRange,
    input: { search: string | null; tenantId: string | null },
  ): Promise<PlatformOverviewQueryResult<PlatformTenantListRow[]>>;
  queryTenantAgents(
    range: PlatformDrilldownRange,
    tenantId: string,
  ): Promise<PlatformOverviewQueryResult<PlatformTenantAgentRow[]>>;
  queryAgentList(
    range: PlatformDrilldownRange,
    tenantId: string | null,
  ): Promise<PlatformOverviewQueryResult<PlatformAgentListRow[]>>;
  queryAgentDetail(
    range: PlatformDrilldownRange,
    agentType: string,
    tenantId: string | null,
  ): Promise<PlatformOverviewQueryResult<PlatformAgentDetailData>>;
  queryAgentRuns(
    range: PlatformDrilldownRange,
    filter: PlatformAgentRunFilter,
  ): Promise<PlatformOverviewQueryResult<PlatformAgentRunRow[]>>;
  queryAgentRunDiagnostics(
    range: PlatformDrilldownRange,
    runId: string,
  ): Promise<PlatformOverviewQueryResult<PlatformAgentRunDiagnosticsData | null>>;
  queryReviewSummary(
    range: PlatformDrilldownRange,
    tenantId: string | null,
  ): Promise<PlatformOverviewQueryResult<PlatformReviewSummaryData>>;
  queryReviewBacklog(
    range: PlatformDrilldownRange,
    filter: PlatformReviewBacklogFilter,
  ): Promise<PlatformOverviewQueryResult<PlatformReviewBacklogRow[]>>;
  queryUsage(
    range: PlatformDrilldownRange,
    input: {
      tenantId: string | null;
      agentType: string | null;
      groupBy: "TENANT" | "AGENT_TYPE" | "MODEL";
    },
  ): Promise<PlatformOverviewQueryResult<PlatformUsageGroupRow[]>>;
  querySystemDetail(
    range: PlatformDrilldownRange,
    tenantId: string | null,
  ): Promise<PlatformOverviewQueryResult<PlatformSystemDetailData>>;
  queryAuditLogs(
    range: PlatformDrilldownRange,
    filter: PlatformAuditFilter,
  ): Promise<PlatformOverviewQueryResult<PlatformAuditRow[]>>;
}

function liveQuery<T>(data: T, now: () => Date): PlatformOverviewQueryResult<T> {
  return { data, source: "LIVE_QUERY", freshAt: now() };
}

/**
 * Keyset pagination: `(sortColumn, id)` is compared as a tuple so pages never
 * skip or repeat a row when two records share a timestamp.
 */
function keysetPredicate(
  column: Prisma.Sql,
  idColumn: Prisma.Sql,
  page: PlatformKeysetPage,
): Prisma.Sql {
  if (page.cursorAt === null || page.cursorId === null) return Prisma.empty;
  return page.order === "DESC"
    ? Prisma.sql`AND (${column}, ${idColumn}) < (${page.cursorAt}, ${page.cursorId})`
    : Prisma.sql`AND (${column}, ${idColumn}) > (${page.cursorAt}, ${page.cursorId})`;
}

function keysetOrder(column: Prisma.Sql, idColumn: Prisma.Sql, order: "ASC" | "DESC"): Prisma.Sql {
  return order === "DESC"
    ? Prisma.sql`ORDER BY ${column} DESC, ${idColumn} DESC`
    : Prisma.sql`ORDER BY ${column} ASC, ${idColumn} ASC`;
}

export class PrismaPlatformDrilldownReadModel implements PlatformDrilldownReadModel {
  constructor(
    private readonly client: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async queryTenantList(
    range: PlatformDrilldownRange,
    input: { search: string | null; tenantId: string | null },
  ) {
    const idFilter =
      input.tenantId === null ? Prisma.empty : Prisma.sql`AND t.id = ${input.tenantId}`;
    const searchFilter =
      input.search === null
        ? Prisma.empty
        : Prisma.sql`AND (t.name ILIKE ${`%${input.search}%`} OR t.slug ILIKE ${`%${input.search}%`})`;
    const day7 = new Date(range.asOf.getTime() - 7 * 24 * 60 * 60 * 1_000);
    const day1 = new Date(range.asOf.getTime() - 24 * 60 * 60 * 1_000);
    const stalledBefore = new Date(range.asOf.getTime() - 10 * 60_000);
    const rows = await this.client.$queryRaw<PlatformTenantListRow[]>(Prisma.sql`
      WITH scoped AS (
        SELECT t.id, t.name, t."createdAt", t."updatedAt"
        FROM "Tenant" t
        WHERE TRUE ${idFilter} ${searchFilter}
        ORDER BY t.id ASC
        LIMIT ${PLATFORM_TENANT_SCAN_LIMIT}
      ), users AS (
        SELECT u."tenantId",
          COUNT(*) FILTER (WHERE u.status='ACTIVE' AND u."deletedAt" IS NULL) AS "activeAccounts",
          COUNT(*) FILTER (WHERE u.status='SUSPENDED' AND u."deletedAt" IS NULL) AS "suspendedAccounts",
          COUNT(*) FILTER (WHERE u.status='ACTIVE' AND u."deletedAt" IS NULL AND u."lastLoginAt" >= ${day1}) AS "loggedIn24h",
          COUNT(*) FILTER (WHERE u.status='ACTIVE' AND u."deletedAt" IS NULL AND u."lastLoginAt" >= ${day7}) AS "loggedIn7d",
          COUNT(*) FILTER (WHERE u.status='ACTIVE' AND u."deletedAt" IS NULL AND u."lastLoginAt" IS NULL) AS "neverLoggedIn"
        FROM "User" u JOIN scoped s ON s.id = u."tenantId"
        GROUP BY u."tenantId"
      ), projects AS (
        SELECT p."tenantId",
          COUNT(*) AS "totalProjects",
          COUNT(*) FILTER (WHERE p.status='ACTIVE') AS "activeProjects"
        FROM "Project" p JOIN scoped s ON s.id = p."tenantId"
        GROUP BY p."tenantId"
      ), files AS (
        SELECT f."tenantId",
          COALESCE(SUM(f."sizeBytes") FILTER (WHERE f.status <> 'DELETED'),0)::bigint AS "storageBytes",
          COUNT(*) FILTER (WHERE f.status <> 'DELETED') AS "fileCount",
          COUNT(*) FILTER (WHERE f.status='QUARANTINED') AS "quarantinedFiles"
        FROM "FileAsset" f JOIN scoped s ON s.id = f."tenantId"
        WHERE f."deletedAt" IS NULL
        GROUP BY f."tenantId"
      ), runs AS (
        SELECT ar."tenantId",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to}) AS "runs",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='COMPLETED') AS "completed",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='FAILED') AS "failed",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='DEGRADED') AS "degraded",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='REJECTED') AS "rejected",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED')) AS "terminal",
          COUNT(*) FILTER (WHERE ar.status='RUNNING' AND ar."startedAt" <= ${range.stuckBefore}) AS "stuck",
          MIN(ar."startedAt") FILTER (WHERE ar.status='RUNNING' AND ar."startedAt" <= ${range.stuckBefore}) AS "oldestStuckAt",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.rolling15From} AND ar."startedAt" < ${range.asOf} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED')) AS "rollingTerminal",
          COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.rolling15From} AND ar."startedAt" < ${range.asOf} AND ar.status IN ('FAILED','DEGRADED','REJECTED')) AS "rollingNonCompletion",
          MIN(ar."startedAt") FILTER (WHERE ar."startedAt" >= ${range.rolling15From} AND ar."startedAt" < ${range.asOf} AND ar.status IN ('FAILED','DEGRADED','REJECTED')) AS "oldestRollingFailureAt",
          COALESCE(SUM(CASE WHEN ar."startedAt" >= ${range.monthStart} AND ar."startedAt" < ${range.asOf} THEN COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd") ELSE 0 END),0) AS "mtdCostMicroUsd"
        FROM "AgentRun" ar JOIN scoped s ON s.id = ar."tenantId"
        GROUP BY ar."tenantId"
      ), reviews AS (
        SELECT rt."tenantId",
          COUNT(*) FILTER (WHERE rt.status='REVIEW_REQUIRED') AS "reviewWaiting",
          COUNT(*) FILTER (WHERE rt.status='REVIEW_REQUIRED' AND rt."dueAt" < ${range.asOf}) AS "reviewBreached",
          COUNT(*) FILTER (WHERE rt.status='REVIEW_REQUIRED' AND rt."dueAt" IS NULL) AS "reviewWithoutDueAt",
          MIN(rt."createdAt") FILTER (WHERE rt.status='REVIEW_REQUIRED') AS "oldestWaitingAt",
          MIN(rt."dueAt") FILTER (WHERE rt.status='REVIEW_REQUIRED' AND rt."dueAt" < ${range.asOf}) AS "oldestBreachedDueAt"
        FROM "ReviewTask" rt JOIN scoped s ON s.id = rt."tenantId"
        GROUP BY rt."tenantId"
      ), outbox AS (
        SELECT oe."tenantId",
          COUNT(*) FILTER (WHERE oe.status='PENDING' AND oe."availableAt" <= ${stalledBefore}) AS "outboxStalled",
          COUNT(*) FILTER (WHERE oe.status='DEAD_LETTER') AS "outboxDeadLetter"
        FROM "OutboxEvent" oe JOIN scoped s ON s.id = oe."tenantId"
        GROUP BY oe."tenantId"
      ), notifications AS (
        SELECT n."tenantId", COUNT(*) FILTER (WHERE n.status='FAILED') AS "notificationFailed"
        FROM "Notification" n JOIN scoped s ON s.id = n."tenantId"
        GROUP BY n."tenantId"
      ), activity AS (
        SELECT s.id AS "tenantId", GREATEST(s."createdAt", s."updatedAt") AS at FROM scoped s
        UNION ALL SELECT u."tenantId", u."lastLoginAt" FROM "User" u JOIN scoped s ON s.id=u."tenantId" WHERE u."lastLoginAt" IS NOT NULL
        UNION ALL SELECT ar."tenantId", ar."startedAt" FROM "AgentRun" ar JOIN scoped s ON s.id=ar."tenantId"
        UNION ALL SELECT rt."tenantId", rt."updatedAt" FROM "ReviewTask" rt JOIN scoped s ON s.id=rt."tenantId"
        UNION ALL SELECT oe."tenantId", oe."createdAt" FROM "OutboxEvent" oe JOIN scoped s ON s.id=oe."tenantId"
        UNION ALL SELECT n."tenantId", n."createdAt" FROM "Notification" n JOIN scoped s ON s.id=n."tenantId"
        UNION ALL SELECT f."tenantId", f."createdAt" FROM "FileAsset" f JOIN scoped s ON s.id=f."tenantId" WHERE f."deletedAt" IS NULL AND f.status <> 'DELETED'
        UNION ALL SELECT al."tenantId", al."occurredAt" FROM "AuditLog" al JOIN scoped s ON s.id=al."tenantId"
      ), last_activity AS (
        SELECT activity."tenantId", MAX(activity.at) AS "lastActivityAt" FROM activity GROUP BY activity."tenantId"
      )
      SELECT s.id AS "tenantId", s.name, s."createdAt",
        COALESCE(u."activeAccounts",0) AS "activeAccounts",
        COALESCE(u."suspendedAccounts",0) AS "suspendedAccounts",
        COALESCE(u."loggedIn24h",0) AS "loggedIn24h",
        COALESCE(u."loggedIn7d",0) AS "loggedIn7d",
        COALESCE(u."neverLoggedIn",0) AS "neverLoggedIn",
        COALESCE(p."totalProjects",0) AS "totalProjects",
        COALESCE(p."activeProjects",0) AS "activeProjects",
        COALESCE(f."storageBytes",0) AS "storageBytes",
        COALESCE(f."fileCount",0) AS "fileCount",
        COALESCE(f."quarantinedFiles",0) AS "quarantinedFiles",
        COALESCE(r.runs,0) AS "runs",
        COALESCE(r.completed,0) AS "completed",
        COALESCE(r.failed,0) AS "failed",
        COALESCE(r.degraded,0) AS "degraded",
        COALESCE(r.rejected,0) AS "rejected",
        COALESCE(r.terminal,0) AS "terminal",
        COALESCE(r.stuck,0) AS "stuck",
        COALESCE(r."rollingTerminal",0) AS "rollingTerminal",
        COALESCE(r."rollingNonCompletion",0) AS "rollingNonCompletion",
        r."oldestRollingFailureAt",
        r."oldestStuckAt",
        COALESCE(r."mtdCostMicroUsd",0) AS "mtdCostMicroUsd",
        COALESCE(rv."reviewWaiting",0) AS "reviewWaiting",
        COALESCE(rv."reviewBreached",0) AS "reviewBreached",
        COALESCE(rv."reviewWithoutDueAt",0) AS "reviewWithoutDueAt",
        rv."oldestWaitingAt",
        rv."oldestBreachedDueAt",
        COALESCE(ob."outboxStalled",0) AS "outboxStalled",
        COALESCE(ob."outboxDeadLetter",0) AS "outboxDeadLetter",
        COALESCE(nt."notificationFailed",0) AS "notificationFailed",
        la."lastActivityAt"
      FROM scoped s
      LEFT JOIN users u ON u."tenantId"=s.id
      LEFT JOIN projects p ON p."tenantId"=s.id
      LEFT JOIN files f ON f."tenantId"=s.id
      LEFT JOIN runs r ON r."tenantId"=s.id
      LEFT JOIN reviews rv ON rv."tenantId"=s.id
      LEFT JOIN outbox ob ON ob."tenantId"=s.id
      LEFT JOIN notifications nt ON nt."tenantId"=s.id
      LEFT JOIN last_activity la ON la."tenantId"=s.id
      ORDER BY s.id ASC
    `);
    return liveQuery(rows, this.now);
  }

  async queryTenantAgents(range: PlatformDrilldownRange, tenantId: string) {
    const rows = await this.client.$queryRaw<PlatformTenantAgentRow[]>(Prisma.sql`
      SELECT ar."agentType",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to}) AS "runs",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED')) AS "terminal",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='COMPLETED') AS "completed",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='FAILED') AS "failed",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='DEGRADED') AS "degraded",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='REJECTED') AS "rejected",
        COUNT(*) FILTER (WHERE ar.status='RUNNING' AND ar."startedAt" <= ${range.stuckBefore}) AS "stuck",
        MAX(ar."completedAt") FILTER (WHERE ar.status='COMPLETED') AS "lastSuccessAt",
        COALESCE(SUM(CASE WHEN ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} THEN COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd") ELSE 0 END),0) AS "costMicroUsd"
      FROM "AgentRun" ar
      WHERE ar."tenantId" = ${tenantId}
      GROUP BY ar."agentType"
      ORDER BY ar."agentType" ASC
      LIMIT ${PLATFORM_AGENT_SCAN_LIMIT}
    `);
    return liveQuery(rows, this.now);
  }

  async queryAgentList(range: PlatformDrilldownRange, tenantId: string | null) {
    const tenantFilter =
      tenantId === null ? Prisma.empty : Prisma.sql`AND ar."tenantId" = ${tenantId}`;
    const rows = await this.client.$queryRaw<PlatformAgentListRow[]>(Prisma.sql`
      SELECT ar."agentType",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to}) AS "runs",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED')) AS "terminal",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='COMPLETED') AS "completed",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='FAILED') AS "failed",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='DEGRADED') AS "degraded",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='REJECTED') AS "rejected",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status='RUNNING') AS "running",
        COUNT(*) FILTER (WHERE ar.status='RUNNING' AND ar."startedAt" <= ${range.stuckBefore}) AS "stuck",
        MIN(ar."startedAt") FILTER (WHERE ar.status='RUNNING' AND ar."startedAt" <= ${range.stuckBefore}) AS "oldestStuckAt",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.rolling15From} AND ar."startedAt" < ${range.asOf} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED')) AS "rollingTerminal",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.rolling15From} AND ar."startedAt" < ${range.asOf} AND ar.status IN ('FAILED','DEGRADED','REJECTED')) AS "rollingNonCompletion",
        MIN(ar."startedAt") FILTER (WHERE ar."startedAt" >= ${range.rolling15From} AND ar."startedAt" < ${range.asOf} AND ar.status IN ('FAILED','DEGRADED','REJECTED')) AS "oldestRollingFailureAt",
        percentile_disc(0.5) WITHIN GROUP (ORDER BY ar."latencyMs") FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED') AND ar."latencyMs" > 0) AS "p50LatencyMs",
        percentile_disc(0.95) WITHIN GROUP (ORDER BY ar."latencyMs") FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED') AND ar."latencyMs" > 0) AS "p95LatencyMs",
        COUNT(*) FILTER (WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} AND ar."retryCount" > 0) AS "retriedRuns",
        MAX(ar."completedAt") FILTER (WHERE ar.status='COMPLETED') AS "lastSuccessAt",
        COALESCE(SUM(CASE WHEN ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to} THEN COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd") ELSE 0 END),0) AS "costMicroUsd"
      FROM "AgentRun" ar
      WHERE TRUE ${tenantFilter}
      GROUP BY ar."agentType"
      ORDER BY ar."agentType" ASC
      LIMIT ${PLATFORM_AGENT_SCAN_LIMIT}
    `);
    return liveQuery(rows, this.now);
  }

  async queryAgentDetail(
    range: PlatformDrilldownRange,
    agentType: string,
    tenantId: string | null,
  ) {
    const tenantFilter =
      tenantId === null ? Prisma.empty : Prisma.sql`AND ar."tenantId" = ${tenantId}`;
    const [failures, tenants, models] = await Promise.all([
      this.client.$queryRaw<PlatformAgentFailureRow[]>(Prisma.sql`
        SELECT ar."failureCategory", COUNT(*) AS "count", MAX(ar."startedAt") AS "lastObservedAt"
        FROM "AgentRun" ar
        WHERE ar."agentType" = ${agentType}
          AND ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to}
          AND ar.status IN ('FAILED','DEGRADED','REJECTED')
          ${tenantFilter}
        GROUP BY ar."failureCategory"
        ORDER BY COUNT(*) DESC, ar."failureCategory" ASC
        LIMIT ${PLATFORM_BREAKDOWN_LIMIT}
      `),
      this.client.$queryRaw<PlatformAgentTenantRow[]>(Prisma.sql`
        SELECT ar."tenantId", t.name AS "tenantName",
          COUNT(*) AS "runs",
          COUNT(*) FILTER (WHERE ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED')) AS "terminal",
          COUNT(*) FILTER (WHERE ar.status='COMPLETED') AS "completed",
          COUNT(*) FILTER (WHERE ar.status='FAILED') AS "failed",
          COUNT(*) FILTER (WHERE ar.status='DEGRADED') AS "degraded",
          COUNT(*) FILTER (WHERE ar.status='REJECTED') AS "rejected",
          COALESCE(SUM(COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd")),0) AS "costMicroUsd"
        FROM "AgentRun" ar JOIN "Tenant" t ON t.id = ar."tenantId"
        WHERE ar."agentType" = ${agentType}
          AND ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to}
          ${tenantFilter}
        GROUP BY ar."tenantId", t.name
        ORDER BY COUNT(*) DESC, ar."tenantId" ASC
        LIMIT ${PLATFORM_BREAKDOWN_LIMIT}
      `),
      this.client.$queryRaw<PlatformAgentModelRow[]>(Prisma.sql`
        SELECT ar.provider, ar."modelId",
          COUNT(*) AS "runs",
          COALESCE(SUM(COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd")),0) AS "costMicroUsd",
          COALESCE(SUM(ar."inputTokens"),0) AS "inputTokens",
          COALESCE(SUM(ar."outputTokens"),0) AS "outputTokens"
        FROM "AgentRun" ar
        WHERE ar."agentType" = ${agentType}
          AND ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to}
          ${tenantFilter}
        GROUP BY ar.provider, ar."modelId"
        ORDER BY COUNT(*) DESC, ar.provider ASC, ar."modelId" ASC
        LIMIT ${PLATFORM_BREAKDOWN_LIMIT}
      `),
    ]);
    return liveQuery({ failures, tenants, models }, this.now);
  }

  async queryAgentRuns(range: PlatformDrilldownRange, filter: PlatformAgentRunFilter) {
    const conditions = [
      filter.tenantId === null ? Prisma.empty : Prisma.sql`AND ar."tenantId" = ${filter.tenantId}`,
      filter.agentType === null
        ? Prisma.empty
        : Prisma.sql`AND ar."agentType" = ${filter.agentType}`,
      filter.status === null
        ? Prisma.empty
        : Prisma.sql`AND ar.status = ${filter.status}::"AgentRunStatus"`,
      filter.outcome === "TERMINAL"
        ? Prisma.sql`AND ar.status IN ('COMPLETED','FAILED','DEGRADED','REJECTED')`
        : filter.outcome === "NON_COMPLETION"
          ? Prisma.sql`AND ar.status IN ('FAILED','DEGRADED','REJECTED')`
          : Prisma.empty,
      filter.failureCategory === null
        ? Prisma.empty
        : Prisma.sql`AND ar."failureCategory" = ${filter.failureCategory}`,
      filter.stuck
        ? Prisma.sql`AND ar.status = 'RUNNING' AND ar."startedAt" <= ${range.stuckBefore}`
        : Prisma.empty,
      keysetPredicate(Prisma.sql`ar."startedAt"`, Prisma.sql`ar.id`, filter),
    ];
    const rows = await this.client.$queryRaw<PlatformAgentRunRow[]>(Prisma.sql`
      SELECT ar.id AS "runId", ar."tenantId", t.name AS "tenantName", ar."projectId",
        ar."agentType", ar.status::text AS status, ar."failureCategory", ar."trigger",
        ar.provider, ar."modelId", ar."promptVersion",
        ar."startedAt", ar."completedAt", ar."latencyMs", ar."retryCount",
        ar."estimatedCostMicroUsd", ar."actualCostMicroUsd"
      FROM "AgentRun" ar JOIN "Tenant" t ON t.id = ar."tenantId"
      WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to}
        ${Prisma.join(conditions, " ")}
      ${keysetOrder(Prisma.sql`ar."startedAt"`, Prisma.sql`ar.id`, filter.order)}
      LIMIT ${filter.limit}
    `);
    return liveQuery(rows, this.now);
  }

  async queryAgentRunDiagnostics(_range: PlatformDrilldownRange, runId: string) {
    const runs = await this.client.$queryRaw<PlatformAgentRunDetailRow[]>(Prisma.sql`
      SELECT ar.id AS "runId", ar."tenantId", t.name AS "tenantName", ar."projectId",
        ar."agentType", ar.status::text AS status, ar."failureCategory", ar."trigger",
        ar.provider, ar."modelId", ar."promptVersion",
        ar."startedAt", ar."completedAt", ar."latencyMs", ar."retryCount",
        ar."estimatedCostMicroUsd", ar."actualCostMicroUsd",
        ar."requestId", ar."eventId", ar."traceId",
        ar."toolBundleVersion", ar."outputSchemaVersion", ar."dataSnapshotVersion",
        ar."outputSha256", ar."contentLoggingEnabled", ar."asOf",
        ar."inputTokens", ar."outputTokens", ar."cachedInputTokens", ar."reasoningTokens",
        CASE
          WHEN ar.validation IS NULL THEN 'UNKNOWN'
          WHEN jsonb_typeof(to_jsonb(ar.validation) -> 'ok') = 'boolean'
            THEN CASE WHEN (to_jsonb(ar.validation) ->> 'ok')::boolean THEN 'PASSED' ELSE 'FAILED' END
          ELSE 'UNKNOWN'
        END AS "validationState",
        CASE
          WHEN jsonb_typeof(to_jsonb(ar.validation) -> 'issues') = 'array'
            THEN jsonb_array_length(to_jsonb(ar.validation) -> 'issues')
          ELSE NULL
        END AS "validationIssueCount"
      FROM "AgentRun" ar JOIN "Tenant" t ON t.id = ar."tenantId"
      WHERE ar.id = ${runId}
      LIMIT 1
    `);
    const run = runs.at(0);
    if (run === undefined) return liveQuery(null, this.now);
    const [toolCalls, totals] = await Promise.all([
      this.client.$queryRaw<PlatformAgentToolCallRow[]>(Prisma.sql`
        SELECT tc.id, tc."toolName", tc.status::text AS status, tc."stepNumber",
          tc."durationMs", tc."occurredAt"
        FROM "AgentToolCall" tc
        WHERE tc."agentRunId" = ${runId}
        ORDER BY tc."stepNumber" ASC, tc.id ASC
        LIMIT 50
      `),
      this.client.$queryRaw<{ total: DatabaseInteger }[]>(Prisma.sql`
        SELECT COUNT(*) AS total FROM "AgentToolCall" tc WHERE tc."agentRunId" = ${runId}
      `),
    ]);
    return liveQuery({ run, toolCalls, toolCallTotal: totals.at(0)?.total ?? 0 }, this.now);
  }

  async queryReviewSummary(range: PlatformDrilldownRange, tenantId: string | null) {
    const taskFilter =
      tenantId === null ? Prisma.empty : Prisma.sql`AND rt."tenantId" = ${tenantId}`;
    const decisionFilter =
      tenantId === null ? Prisma.empty : Prisma.sql`AND rd."tenantId" = ${tenantId}`;
    const correctionFilter =
      tenantId === null ? Prisma.empty : Prisma.sql`AND rc."tenantId" = ${tenantId}`;
    const h24 = new Date(range.asOf.getTime() - 24 * 60 * 60 * 1_000);
    const h72 = new Date(range.asOf.getTime() - 72 * 60 * 60 * 1_000);
    const d7 = new Date(range.asOf.getTime() - 7 * 24 * 60 * 60 * 1_000);
    const [totalsRows, buckets, tenants, targets, decisionRows, correctionRows] = await Promise.all(
      [
        this.client.$queryRaw<PlatformReviewTotalsRow[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE rt.status='REVIEW_REQUIRED') AS "waiting",
          COUNT(*) FILTER (WHERE rt.status='REVIEW_REQUIRED' AND rt."dueAt" < ${range.asOf}) AS "breached",
          COUNT(*) FILTER (WHERE rt.status='REVIEW_REQUIRED' AND rt."dueAt" IS NULL) AS "withoutDueAt",
          COUNT(*) FILTER (WHERE rt.status='DRAFT') AS "draft",
          MIN(rt."createdAt") FILTER (WHERE rt.status='REVIEW_REQUIRED') AS "oldestWaitingAt",
          MIN(rt."dueAt") FILTER (WHERE rt.status='REVIEW_REQUIRED' AND rt."dueAt" < ${range.asOf}) AS "oldestBreachedDueAt"
        FROM "ReviewTask" rt WHERE TRUE ${taskFilter}
      `),
        this.client.$queryRaw<PlatformReviewBucketRow[]>(Prisma.sql`
        SELECT bucket,
          COUNT(*) AS "waiting",
          COUNT(*) FILTER (WHERE "dueAt" IS NOT NULL AND "dueAt" < ${range.asOf}) AS "breached"
        FROM (
          SELECT rt."dueAt",
            CASE
              WHEN rt."createdAt" >= ${h24} THEN 'UNDER_24H'
              WHEN rt."createdAt" >= ${h72} THEN 'H24_TO_72H'
              WHEN rt."createdAt" >= ${d7} THEN 'D3_TO_D7'
              ELSE 'OVER_7D'
            END AS bucket
          FROM "ReviewTask" rt
          WHERE rt.status='REVIEW_REQUIRED' ${taskFilter}
        ) aged
        GROUP BY bucket
        LIMIT 4
      `),
        this.client.$queryRaw<PlatformReviewTenantRow[]>(Prisma.sql`
        SELECT rt."tenantId", t.name AS "tenantName",
          COUNT(*) AS "waiting",
          COUNT(*) FILTER (WHERE rt."dueAt" < ${range.asOf}) AS "breached",
          MIN(rt."createdAt") AS "oldestWaitingAt"
        FROM "ReviewTask" rt JOIN "Tenant" t ON t.id = rt."tenantId"
        WHERE rt.status='REVIEW_REQUIRED' ${taskFilter}
        GROUP BY rt."tenantId", t.name
        ORDER BY COUNT(*) FILTER (WHERE rt."dueAt" < ${range.asOf}) DESC, COUNT(*) DESC, rt."tenantId" ASC
        LIMIT ${PLATFORM_BREAKDOWN_LIMIT}
      `),
        this.client.$queryRaw<PlatformReviewTargetRow[]>(Prisma.sql`
        SELECT rt."targetType"::text AS "targetType",
          COUNT(*) AS "waiting",
          COUNT(*) FILTER (WHERE rt."dueAt" < ${range.asOf}) AS "breached"
        FROM "ReviewTask" rt
        WHERE rt.status='REVIEW_REQUIRED' ${taskFilter}
        GROUP BY rt."targetType"
        ORDER BY COUNT(*) DESC, rt."targetType"::text ASC
        LIMIT ${PLATFORM_BREAKDOWN_LIMIT}
      `),
        this.client.$queryRaw<PlatformReviewDecisionAggregateRow[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE rd.decision IN ('APPROVE','REJECT')) AS "decided",
          COUNT(*) FILTER (WHERE rd.decision='APPROVE') AS "approved",
          COUNT(*) FILTER (WHERE rd.decision='REJECT') AS "rejected",
          COUNT(*) FILTER (WHERE rd."emergencyOverride" = TRUE) AS "emergencyOverrides"
        FROM "ReviewDecision" rd
        WHERE rd."decidedAt" >= ${range.from} AND rd."decidedAt" < ${range.to} ${decisionFilter}
      `),
        this.client.$queryRaw<{ corrected: DatabaseInteger }[]>(Prisma.sql`
        SELECT COUNT(DISTINCT rc."reviewTaskId") AS "corrected"
        FROM "ReviewCorrection" rc
        WHERE rc."correctedAt" >= ${range.from} AND rc."correctedAt" < ${range.to} ${correctionFilter}
      `),
      ],
    );
    const decided = decisionRows.at(0);
    return liveQuery(
      {
        totals: totalsRows.at(0) ?? null,
        buckets,
        tenants,
        targets,
        throughput:
          decided === undefined
            ? null
            : { ...decided, corrected: correctionRows.at(0)?.corrected ?? 0 },
      },
      this.now,
    );
  }

  async queryReviewBacklog(range: PlatformDrilldownRange, filter: PlatformReviewBacklogFilter) {
    const dueSoon = new Date(range.asOf.getTime() + 24 * 60 * 60 * 1_000);
    const conditions = [
      filter.tenantId === null ? Prisma.empty : Prisma.sql`AND rt."tenantId" = ${filter.tenantId}`,
      filter.targetType === null
        ? Prisma.empty
        : Prisma.sql`AND rt."targetType" = ${filter.targetType}::"ReviewTargetType"`,
      filter.sla === "BREACHED"
        ? Prisma.sql`AND rt."dueAt" IS NOT NULL AND rt."dueAt" < ${range.asOf}`
        : filter.sla === "DUE_SOON"
          ? Prisma.sql`AND rt."dueAt" IS NOT NULL AND rt."dueAt" >= ${range.asOf} AND rt."dueAt" < ${dueSoon}`
          : filter.sla === "NO_DUE_DATE"
            ? Prisma.sql`AND rt."dueAt" IS NULL`
            : Prisma.empty,
      keysetPredicate(Prisma.sql`rt."createdAt"`, Prisma.sql`rt.id`, filter),
    ];
    const rows = await this.client.$queryRaw<PlatformReviewBacklogRow[]>(Prisma.sql`
      SELECT rt.id AS "reviewTaskId", rt."tenantId", t.name AS "tenantName", rt."projectId",
        rt."targetType"::text AS "targetType", rt."targetVersion",
        rt."assignedRole"::text AS "assignedRole", rt."assignedUserId",
        rt.status::text AS status, rt."createdAt", rt."dueAt"
      FROM "ReviewTask" rt JOIN "Tenant" t ON t.id = rt."tenantId"
      WHERE rt.status = 'REVIEW_REQUIRED'
        ${Prisma.join(conditions, " ")}
      ${keysetOrder(Prisma.sql`rt."createdAt"`, Prisma.sql`rt.id`, filter.order)}
      LIMIT ${filter.limit}
    `);
    return liveQuery(rows, this.now);
  }

  async queryUsage(
    range: PlatformDrilldownRange,
    input: {
      tenantId: string | null;
      agentType: string | null;
      groupBy: "TENANT" | "AGENT_TYPE" | "MODEL";
    },
  ) {
    const tenantFilter =
      input.tenantId === null ? Prisma.empty : Prisma.sql`AND ar."tenantId" = ${input.tenantId}`;
    const agentFilter =
      input.agentType === null ? Prisma.empty : Prisma.sql`AND ar."agentType" = ${input.agentType}`;
    const groupKey =
      input.groupBy === "TENANT"
        ? Prisma.sql`ar."tenantId"`
        : input.groupBy === "AGENT_TYPE"
          ? Prisma.sql`ar."agentType"`
          : Prisma.sql`ar.provider || ':' || ar."modelId"`;
    const groupLabel =
      input.groupBy === "TENANT" ? Prisma.sql`MAX(t.name)` : Prisma.sql`MAX(${groupKey})`;
    const rows = await this.client.$queryRaw<PlatformUsageGroupRow[]>(Prisma.sql`
      SELECT ${groupKey} AS "key", ${groupLabel} AS "label",
        COUNT(*) AS "runs",
        COALESCE(SUM(COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd")),0) AS "costMicroUsd",
        COALESCE(SUM(CASE WHEN ar."actualCostMicroUsd" IS NOT NULL THEN ar."actualCostMicroUsd" ELSE 0 END),0) AS "actualMicroUsd",
        COALESCE(SUM(CASE WHEN ar."actualCostMicroUsd" IS NULL THEN ar."estimatedCostMicroUsd" ELSE 0 END),0) AS "estimatedMicroUsd",
        COUNT(*) FILTER (WHERE ar."actualCostMicroUsd" IS NOT NULL) AS "actualRunCount",
        COUNT(*) FILTER (WHERE ar."actualCostMicroUsd" IS NULL) AS "estimatedRunCount",
        COALESCE(SUM(ar."inputTokens"),0) AS "inputTokens",
        COALESCE(SUM(ar."outputTokens"),0) AS "outputTokens",
        COALESCE(SUM(ar."cachedInputTokens"),0) AS "cachedInputTokens",
        COALESCE(SUM(ar."reasoningTokens"),0) AS "reasoningTokens"
      FROM "AgentRun" ar JOIN "Tenant" t ON t.id = ar."tenantId"
      WHERE ar."startedAt" >= ${range.from} AND ar."startedAt" < ${range.to}
        ${tenantFilter} ${agentFilter}
      GROUP BY ${groupKey}
      ORDER BY COALESCE(SUM(COALESCE(ar."actualCostMicroUsd", ar."estimatedCostMicroUsd")),0) DESC, ${groupKey} ASC
      LIMIT 50
    `);
    return liveQuery(rows, this.now);
  }

  async querySystemDetail(range: PlatformDrilldownRange, tenantId: string | null) {
    const stalledBefore = new Date(range.asOf.getTime() - 10 * 60_000);
    const outboxFilter =
      tenantId === null ? Prisma.empty : Prisma.sql`AND oe."tenantId" = ${tenantId}`;
    const tenantFilter = tenantId === null ? Prisma.empty : Prisma.sql`AND t.id = ${tenantId}`;
    const [outboxByType, tenantImpact] = await Promise.all([
      this.client.$queryRaw<PlatformOutboxTypeRow[]>(Prisma.sql`
        SELECT oe."eventType",
          COUNT(*) FILTER (WHERE oe.status='PENDING') AS "pending",
          COUNT(*) FILTER (WHERE oe.status='PENDING' AND oe."availableAt" <= ${stalledBefore}) AS "stalled",
          COUNT(*) FILTER (WHERE oe.status='FAILED') AS "failed",
          COUNT(*) FILTER (WHERE oe.status='DEAD_LETTER') AS "deadLetter",
          LEAST(
            MIN(oe."availableAt") FILTER (WHERE oe.status='PENDING' AND oe."availableAt" <= ${stalledBefore}),
            MIN(oe."createdAt") FILTER (WHERE oe.status IN ('FAILED','DEAD_LETTER'))
          ) AS "oldestEvidenceAt"
        FROM "OutboxEvent" oe
        WHERE oe.status <> 'PUBLISHED' ${outboxFilter}
        GROUP BY oe."eventType"
        ORDER BY COUNT(*) FILTER (WHERE oe.status='DEAD_LETTER') DESC, COUNT(*) DESC, oe."eventType" ASC
        LIMIT ${PLATFORM_BREAKDOWN_LIMIT}
      `),
      this.client.$queryRaw<PlatformDeliveryTenantRow[]>(Prisma.sql`
        SELECT t.id AS "tenantId", t.name AS "tenantName",
          COALESCE(ob.stalled,0) AS "outboxStalled",
          COALESCE(ob."deadLetter",0) AS "outboxDeadLetter",
          COALESCE(nt.failed,0) AS "notificationFailed",
          COALESCE(fa.quarantined,0) AS "artifactQuarantined"
        FROM "Tenant" t
        LEFT JOIN (
          SELECT oe."tenantId",
            COUNT(*) FILTER (WHERE oe.status='PENDING' AND oe."availableAt" <= ${stalledBefore}) AS stalled,
            COUNT(*) FILTER (WHERE oe.status='DEAD_LETTER') AS "deadLetter"
          FROM "OutboxEvent" oe GROUP BY oe."tenantId"
        ) ob ON ob."tenantId" = t.id
        LEFT JOIN (
          SELECT n."tenantId", COUNT(*) FILTER (WHERE n.status='FAILED') AS failed
          FROM "Notification" n GROUP BY n."tenantId"
        ) nt ON nt."tenantId" = t.id
        LEFT JOIN (
          SELECT f."tenantId", COUNT(*) FILTER (WHERE f.status='QUARANTINED' AND f."deletedAt" IS NULL) AS quarantined
          FROM "FileAsset" f GROUP BY f."tenantId"
        ) fa ON fa."tenantId" = t.id
        WHERE (COALESCE(ob.stalled,0) + COALESCE(ob."deadLetter",0) + COALESCE(nt.failed,0) + COALESCE(fa.quarantined,0)) > 0
          ${tenantFilter}
        ORDER BY (COALESCE(ob."deadLetter",0) + COALESCE(nt.failed,0) + COALESCE(fa.quarantined,0)) DESC, t.id ASC
        LIMIT ${PLATFORM_BREAKDOWN_LIMIT}
      `),
    ]);
    return liveQuery({ outboxByType, tenantImpact }, this.now);
  }

  async queryAuditLogs(range: PlatformDrilldownRange, filter: PlatformAuditFilter) {
    const conditions = [
      filter.tenantId === null
        ? Prisma.empty
        : Prisma.sql`AND audit."tenantId" = ${filter.tenantId}`,
      filter.actorId === null
        ? Prisma.empty
        : Prisma.sql`AND audit."actorPrincipalId" = ${filter.actorId}`,
      filter.source === "ALL" ? Prisma.empty : Prisma.sql`AND audit.source = ${filter.source}`,
      filter.actorRole === null
        ? Prisma.empty
        : Prisma.sql`AND audit."actorRole" = ${filter.actorRole}`,
      filter.action === null ? Prisma.empty : Prisma.sql`AND audit.action = ${filter.action}`,
      filter.result === null ? Prisma.empty : Prisma.sql`AND audit.result = ${filter.result}`,
      keysetPredicate(Prisma.sql`audit."occurredAt"`, Prisma.sql`audit.id`, filter),
    ];
    const rows = await this.client.$queryRaw<PlatformAuditRow[]>(Prisma.sql`
      WITH audit AS (
        SELECT 'P:' || pal.id AS id, 'PLATFORM'::text AS source,
          pal."actorPrincipalId",
          pp."displayName" AS "actorDisplayName",
          pal."actorRole"::text AS "actorRole",
          pal."tenantId",
          pal.action,
          pal."entityType",
          pal."entityId",
          pal.result::text AS result,
          pal.reason,
          pal."correlationId",
          pal."beforeHash",
          pal."afterHash",
          pal."occurredAt"
        FROM "PlatformAuditLog" pal
        LEFT JOIN "PlatformPrincipal" pp ON pp.id = pal."actorPrincipalId"
        UNION ALL
        SELECT 'T:' || al.id AS id, 'TENANT'::text AS source,
          al."actorUserId" AS "actorPrincipalId",
          u."displayName" AS "actorDisplayName",
          al."actorRole"::text AS "actorRole",
          al."tenantId",
          al.action,
          al."entityType",
          al."entityId",
          'SUCCESS'::text AS result,
          al.reason,
          al."correlationId",
          al."beforeHash",
          al."afterHash",
          al."occurredAt"
        FROM "AuditLog" al
        LEFT JOIN "User" u ON u.id = al."actorUserId" AND u."tenantId" = al."tenantId"
      )
      SELECT audit.id, audit."actorPrincipalId", audit."actorDisplayName",
        audit."actorRole", audit."tenantId", audit.action, audit."entityType",
        audit."entityId", audit.result, audit.reason, audit."correlationId",
        audit."beforeHash", audit."afterHash", audit."occurredAt"
      FROM audit
      WHERE audit."occurredAt" >= ${range.from} AND audit."occurredAt" < ${range.to}
        ${Prisma.join(conditions, " ")}
      ${keysetOrder(Prisma.sql`audit."occurredAt"`, Prisma.sql`audit.id`, filter.order)}
      LIMIT ${filter.limit}
    `);
    return liveQuery(rows, this.now);
  }
}
