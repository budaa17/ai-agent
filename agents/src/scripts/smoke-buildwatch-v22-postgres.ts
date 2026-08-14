import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { createPhase9ProductionRuntime, resolvePhase9BackendConfig } from "../backend/index.js";
import { prisma } from "../prisma.js";

const migrationName = "20260803160000_buildwatch_v22_phase9_canonical_backend";

const requiredTables = [
  "User",
  "UserCredential",
  "TenantInvitation",
  "ProjectMember",
  "RefreshSession",
  "FileAsset",
  "DesignDocument",
  "DrawingRevision",
  "DrawingPage",
  "DrawingScale",
  "DesignElement",
  "ElementGeometry",
  "ElementSourceRef",
  "QuantityTakeoffVersion",
  "QuantityTakeoffItem",
  "MaterialCatalog",
  "NormCatalog",
  "PriceCatalog",
  "EstimateVersion",
  "ScheduleVersion",
  "BaselineVersion",
  "DailyWorkPlan",
  "DailyReport",
  "StockMovement",
  "PhotoEvidence",
  "ProgressVerification",
  "ForecastSnapshot",
  "RecoveryScenario",
  "ApprovalMatrix",
  "ReviewTask",
  "ReviewDecision",
  "IdempotencyRecord",
  "AppliedCommand",
  "AuditLog",
  "OutboxEvent",
  "ConsumedEvent",
  "Notification",
  "AgentToolReadModel",
] as const;

const requiredTriggers = [
  "DrawingRevision_immutable_version",
  "QuantityTakeoffVersion_immutable_version",
  "MaterialCatalogVersion_immutable_version",
  "NormCatalogVersion_immutable_version",
  "PriceCatalogVersion_immutable_version",
  "EstimateVersion_immutable_version",
  "ScheduleVersion_immutable_version",
  "BaselineVersion_immutable_version",
  "DailyWorkPlan_immutable_version",
  "DailyReport_immutable_version",
  "ProgressVerification_immutable_version",
  "RecoveryScenario_immutable_version",
  "StockMovement_append_only",
  "CostEntry_append_only",
  "AuditLog_append_only",
  "ReviewDecision_append_only",
  "AppliedCommand_append_only",
  "ConsumedEvent_append_only",
] as const;

type Check = {
  name: string;
  passed: boolean;
  evidence: string;
};

async function main() {
  const checks: Check[] = [];
  const migrationRows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE migration_name = ${migrationName}
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  `;
  checks.push({
    name: "canonical-migration-applied",
    passed: migrationRows.length === 1,
    evidence: `${migrationRows.length}/1 migration row`,
  });

  const tableRows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const tableNames = new Set(tableRows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !tableNames.has(table));
  checks.push({
    name: "canonical-tables-present",
    passed: missingTables.length === 0,
    evidence:
      missingTables.length === 0
        ? `${requiredTables.length}/${requiredTables.length} required tables`
        : `missing: ${missingTables.join(", ")}`,
  });

  const triggerRows = await prisma.$queryRaw<Array<{ trigger_name: string }>>`
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
  `;
  const triggerNames = new Set(triggerRows.map((row) => row.trigger_name));
  const missingTriggers = requiredTriggers.filter((trigger) => !triggerNames.has(trigger));
  checks.push({
    name: "database-invariant-triggers-present",
    passed: missingTriggers.length === 0,
    evidence:
      missingTriggers.length === 0
        ? `${requiredTriggers.length}/${requiredTriggers.length} required triggers`
        : `missing: ${missingTriggers.join(", ")}`,
  });

  const transactionMarker = randomUUID();
  const transactionSentinel = new Error("PHASE9_EXPECTED_TRANSACTION_ROLLBACK");
  let rollbackRaised = false;
  try {
    await prisma.$transaction(
      async (transaction) => {
        await transaction.tenant.create({
          data: {
            id: transactionMarker,
            slug: `phase9-smoke-${transactionMarker}`,
            name: "Phase 9 transaction smoke tenant",
          },
        });
        await transaction.project.create({
          data: {
            id: transactionMarker,
            tenantId: transactionMarker,
            code: "PHASE9-SMOKE",
            name: "Phase 9 transaction smoke project",
            plannedStart: new Date("2026-08-03T00:00:00.000Z"),
            plannedEnd: new Date("2026-08-04T00:00:00.000Z"),
            budget: "1.00",
          },
        });
        await transaction.outboxEvent.create({
          data: {
            id: transactionMarker,
            tenantId: transactionMarker,
            projectId: transactionMarker,
            eventType: "PHASE9_SMOKE",
            aggregateType: "PROJECT",
            aggregateId: transactionMarker,
            aggregateVersion: 1,
            idempotencyKey: transactionMarker,
            payload: { marker: transactionMarker },
            headers: { source: "phase9-postgres-smoke" },
          },
        });
        throw transactionSentinel;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    rollbackRaised = error === transactionSentinel;
    if (!rollbackRaised) throw error;
  }
  const [rolledBackTenants, rolledBackEvents] = await Promise.all([
    prisma.tenant.count({ where: { id: transactionMarker } }),
    prisma.outboxEvent.count({ where: { id: transactionMarker } }),
  ]);
  checks.push({
    name: "serializable-transaction-outbox-rollback",
    passed: rollbackRaised && rolledBackTenants === 0 && rolledBackEvents === 0,
    evidence: `rollback=${rollbackRaised} tenantRows=${rolledBackTenants} outboxRows=${rolledBackEvents}`,
  });

  const appendOnlyMarker = randomUUID();
  let appendOnlyProtected = false;
  try {
    await prisma.$transaction(
      async (transaction) => {
        await transaction.tenant.create({
          data: {
            id: appendOnlyMarker,
            slug: `phase9-append-${appendOnlyMarker}`,
            name: "Phase 9 append-only smoke tenant",
          },
        });
        await transaction.auditLog.create({
          data: {
            id: appendOnlyMarker,
            tenantId: appendOnlyMarker,
            action: "PHASE9_APPEND_ONLY_PROBE",
            entityType: "TENANT",
            entityId: appendOnlyMarker,
            correlationId: appendOnlyMarker,
            metadata: { source: "phase9-postgres-smoke" },
          },
        });
        await transaction.auditLog.update({
          where: { id: appendOnlyMarker },
          data: { reason: "mutation must be rejected" },
        });
        throw new Error("PHASE9_APPEND_ONLY_TRIGGER_MISSING");
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    appendOnlyProtected = String(error).includes("BUILDWATCH_APPEND_ONLY_RECORD");
    if (!appendOnlyProtected && !String(error).includes("PHASE9_APPEND_ONLY_TRIGGER_MISSING")) {
      throw error;
    }
  }
  checks.push({
    name: "append-only-audit-enforced",
    passed: appendOnlyProtected,
    evidence: appendOnlyProtected
      ? "AuditLog UPDATE rejected by PostgreSQL trigger"
      : "AuditLog UPDATE was not rejected",
  });

  const runtime = createPhase9ProductionRuntime(
    prisma,
    resolvePhase9BackendConfig({
      NODE_ENV: "test",
      PHASE9_API_HOST: "127.0.0.1",
      PHASE9_API_PORT: "4180",
      PHASE9_PUBLIC_BASE_URL: "http://127.0.0.1:4180",
      PHASE9_JWT_SECRET: "phase9-postgres-smoke-jwt-secret-001",
      PHASE9_CURSOR_SECRET: "phase9-postgres-smoke-cursor-secret-001",
      PHASE9_ARTIFACT_SIGNING_SECRET: "phase9-postgres-smoke-artifact-secret-001",
      PHASE9_EMAIL_VERIFICATION_SECRET: "phase9-postgres-smoke-email-secret-001",
      PHASE9_ARTIFACT_ROOT: "data/artifacts",
    }),
  );
  const server = createServer(runtime.app);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const [readinessResponse, openApiResponse] = await Promise.all([
      fetch(`${baseUrl}/health/ready`),
      fetch(`${baseUrl}/openapi.json`),
    ]);
    const readiness = (await readinessResponse.json()) as { status?: string };
    const openApi = (await openApiResponse.json()) as { openapi?: string };
    checks.push({
      name: "production-api-database-readiness",
      passed: readinessResponse.status === 200 && readiness.status === "ready",
      evidence: `status=${readinessResponse.status} body=${readiness.status ?? "missing"}`,
    });
    checks.push({
      name: "production-openapi-contract",
      passed: openApiResponse.status === 200 && openApi.openapi === "3.1.0",
      evidence: `status=${openApiResponse.status} openapi=${openApi.openapi ?? "missing"}`,
    });
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
    });
  }

  const passed = checks.every((check) => check.passed);
  const report = {
    schemaVersion: 1,
    suite: "BUILDWATCH_V22_PHASE9_POSTGRES",
    generatedAt: new Date().toISOString(),
    passed,
    checks,
  };
  const output = resolve(process.cwd(), "data/evaluations/buildwatch-v22-phase9-postgres.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Phase 9 PostgreSQL smoke: ${passed ? "PASS" : "FAIL"} (${checks.filter((check) => check.passed).length}/${checks.length})\nReport: ${output}\n`,
  );
  if (!passed) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Phase 9 PostgreSQL smoke failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
