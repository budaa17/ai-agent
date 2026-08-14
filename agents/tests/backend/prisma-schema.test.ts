import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildWatchPhase9OpenApi } from "../../src/backend/index.js";
import type { PrismaClient } from "@prisma/client";
import { PrismaPhase8ReadRepository, phase9AgentReadModelHash } from "../../src/backend/index.js";
import { buildPhase8GoldenFixture } from "../../src/orchestration/index.js";

describe("BuildWatch Phase 9 canonical Prisma and API contracts", () => {
  it("contains every Phase 9 canonical migration wave model", async () => {
    const schema = await readFile(resolve("prisma/schema.prisma"), "utf8");
    const requiredModels = [
      "User",
      "ProjectMember",
      "RefreshSession",
      "DesignDocument",
      "DrawingRevision",
      "DrawingPage",
      "DrawingScale",
      "DesignElement",
      "ElementGeometry",
      "ElementSourceRef",
      "QuantityTakeoffVersion",
      "QuantityTakeoffItem",
      "TakeoffAdjustment",
      "MaterialCatalog",
      "MaterialAlias",
      "NormCatalog",
      "NormCatalogVersion",
      "WorkNorm",
      "ProductivityRate",
      "PriceCatalog",
      "PriceCatalogEntry",
      "EstimateVersion",
      "EstimateLine",
      "EstimateAssumption",
      "EstimateScenario",
      "ScheduleVersion",
      "ScheduleActivity",
      "ScheduleDependency",
      "ResourceRequirement",
      "Crew",
      "CrewAvailability",
      "Equipment",
      "EquipmentAvailability",
      "DailyWorkPlan",
      "DailyWorkPlanItem",
      "DailyPlanResource",
      "DailyPlanMaterial",
      "DailyPlanPrecondition",
      "DailyReport",
      "ProgressEntry",
      "AttendanceEntry",
      "StockMovement",
      "PhotoEvidence",
      "PhotoEvidenceLink",
      "PhotoQualityAssessment",
      "PhotoDuplicateFinding",
      "ProgressVerification",
      "ProgressVerificationIssue",
      "DailyVariance",
      "ForecastSnapshot",
      "ForecastWorkItem",
      "ForecastDriver",
      "RecoveryScenario",
      "ReviewTask",
      "ReviewDecision",
      "ReviewCorrection",
      "ApprovalMatrix",
      "AuditLog",
      "OutboxEvent",
      "IdempotencyRecord",
      "AppliedCommand",
    ];
    requiredModels.forEach((model) => expect(schema).toContain(`model ${model} {`));
    expect(schema).toContain("@@unique([tenantId, id])");
    expect(schema).toContain("objectKey");
  });

  it("ships non-destructive migration invariants and partial invitation uniqueness", async () => {
    const migration = await readFile(
      resolve(
        "prisma/migrations/20260803160000_buildwatch_v22_phase9_canonical_backend/migration.sql",
      ),
      "utf8",
    );
    expect(migration).not.toMatch(/DROP TABLE|DROP TYPE/);
    expect(migration).toContain("buildwatch_guard_immutable_version");
    expect(migration).toContain("buildwatch_reject_append_only_mutation");
    expect(migration).toContain("TenantInvitation_one_pending_email_key");
    expect(migration.match(/CREATE TRIGGER/g) ?? []).toHaveLength(18);
    expect((migration.match(/CREATE TABLE/g) ?? []).length).toBeGreaterThanOrEqual(70);
  });

  it("publishes stable auth, approval, comparison, forecast, audit, and artifact OpenAPI paths", () => {
    const paths = Object.keys(buildWatchPhase9OpenApi.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/v1/auth/login",
        "/v1/auth/refresh",
        "/v1/invitations",
        "/v1/projects",
        "/v1/projects/{projectId}/reviews/{reviewTaskId}/decisions",
        "/v1/projects/{projectId}/approved-commands",
        "/v1/projects/{projectId}/versions/compare",
        "/v1/projects/{projectId}/forecast/latest",
        "/v1/projects/{projectId}/audit",
        "/v1/projects/{projectId}/artifacts/{artifactId}/signed-url",
      ]),
    );
  });

  it("loads Phase 8 tool records only through a tenant/project-scoped Prisma read model", async () => {
    const fixture = buildPhase8GoldenFixture();
    const record = fixture.records.find(
      (candidate) =>
        candidate.toolName === "getDesignDocuments" &&
        candidate.tenantId === fixture.a0Request.tenantId,
    )!;
    const findMany = vi.fn(async () => [
      {
        id: "read-model-row-001",
        tenantId: record.tenantId,
        projectId: record.projectId,
        toolName: record.toolName,
        recordId: record.recordId,
        versionId: record.versionId,
        effectiveAt: new Date(record.effectiveAt),
        artifactIds: record.artifactIds,
        catalogVersionIds: record.catalogVersionIds,
        sourceRefs: record.sourceRefs,
        data: record.data,
        sourceHash: phase9AgentReadModelHash(record),
        createdAt: new Date(record.effectiveAt),
        updatedAt: new Date(record.effectiveAt),
      },
    ]);
    const repository = new PrismaPhase8ReadRepository(
      { agentToolReadModel: { findMany } } as unknown as Pick<PrismaClient, "agentToolReadModel">,
      { tenantId: record.tenantId, projectIds: [record.projectId] },
    );
    const output = await repository.list("getDesignDocuments");
    expect(output).toEqual([record]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: record.tenantId,
          projectId: { in: [record.projectId] },
          toolName: "getDesignDocuments",
        },
      }),
    );
  });
});
