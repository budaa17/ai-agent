import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  LocalPhase10ArtifactStorage,
  Phase10FrontendService,
  Phase9ApiError,
  Phase9ProjectService,
  PrismaPhase9Store,
  type Phase9AuthenticatedPrincipal,
} from "../backend/index.js";
import { prisma } from "../prisma.js";

const fixture = {
  tenantId: "phase10-smoke-tenant",
  tenantSlug: "phase10-smoke",
  adminUserId: "phase10-smoke-admin",
  supervisorUserId: "phase10-smoke-supervisor",
  projectId: "phase10-smoke-project",
  workItemId: "phase10-smoke-work-item",
  otherTenantId: "phase10-smoke-other-tenant",
  projectKey: "phase10-smoke-project-create-v1",
  artifactKey: "phase10-smoke-artifact-upload-v1",
  reportKey: "phase10-smoke-daily-report-v1",
} as const;

type Check = {
  name: string;
  passed: boolean;
  evidence: string;
};

function addCheck(checks: Check[], name: string, passed: boolean, evidence: string): void {
  checks.push({ name, passed, evidence });
}

async function prepareFixture(): Promise<void> {
  await prisma.tenant.upsert({
    where: { id: fixture.tenantId },
    update: {
      slug: fixture.tenantSlug,
      name: "BuildWatch Phase 10 PostgreSQL smoke",
    },
    create: {
      id: fixture.tenantId,
      slug: fixture.tenantSlug,
      name: "BuildWatch Phase 10 PostgreSQL smoke",
    },
  });
  await prisma.tenant.upsert({
    where: { id: fixture.otherTenantId },
    update: { name: "BuildWatch Phase 10 isolation smoke" },
    create: {
      id: fixture.otherTenantId,
      slug: "phase10-smoke-other",
      name: "BuildWatch Phase 10 isolation smoke",
    },
  });
  await prisma.user.upsert({
    where: { id: fixture.adminUserId },
    update: {
      email: "phase10-admin@smoke.invalid",
      emailNormalized: "phase10-admin@smoke.invalid",
      displayName: "Phase 10 smoke admin",
      tenantRole: "COMPANY_ADMIN",
      status: "ACTIVE",
      deletedAt: null,
    },
    create: {
      id: fixture.adminUserId,
      tenantId: fixture.tenantId,
      email: "phase10-admin@smoke.invalid",
      emailNormalized: "phase10-admin@smoke.invalid",
      displayName: "Phase 10 smoke admin",
      tenantRole: "COMPANY_ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date("2026-08-03T00:00:00.000Z"),
    },
  });
  await prisma.user.upsert({
    where: { id: fixture.supervisorUserId },
    update: {
      email: "phase10-supervisor@smoke.invalid",
      emailNormalized: "phase10-supervisor@smoke.invalid",
      displayName: "Phase 10 smoke supervisor",
      tenantRole: "SITE_SUPERVISOR",
      status: "ACTIVE",
      deletedAt: null,
    },
    create: {
      id: fixture.supervisorUserId,
      tenantId: fixture.tenantId,
      email: "phase10-supervisor@smoke.invalid",
      emailNormalized: "phase10-supervisor@smoke.invalid",
      displayName: "Phase 10 smoke supervisor",
      tenantRole: "SITE_SUPERVISOR",
      status: "ACTIVE",
      emailVerifiedAt: new Date("2026-08-03T00:00:00.000Z"),
    },
  });
  await prisma.project.upsert({
    where: { id: fixture.projectId },
    update: {
      code: "P10-SMOKE",
      name: "Phase 10 field operations smoke",
      description: "Durable idempotent smoke fixture",
      location: "Ulaanbaatar",
      status: "ACTIVE",
      plannedStart: new Date("2026-08-01T00:00:00.000Z"),
      plannedEnd: new Date("2026-12-31T00:00:00.000Z"),
      budget: "2000000.00",
      actualCost: "650000.00",
    },
    create: {
      id: fixture.projectId,
      tenantId: fixture.tenantId,
      code: "P10-SMOKE",
      name: "Phase 10 field operations smoke",
      description: "Durable idempotent smoke fixture",
      location: "Ulaanbaatar",
      status: "ACTIVE",
      plannedStart: new Date("2026-08-01T00:00:00.000Z"),
      plannedEnd: new Date("2026-12-31T00:00:00.000Z"),
      budget: "2000000.00",
      actualCost: "650000.00",
    },
  });
  await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId: fixture.projectId,
        userId: fixture.supervisorUserId,
      },
    },
    update: { role: "SITE_SUPERVISOR", active: true },
    create: {
      id: "phase10-smoke-membership",
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      userId: fixture.supervisorUserId,
      role: "SITE_SUPERVISOR",
      active: true,
    },
  });
  await prisma.workItem.upsert({
    where: {
      projectId_code: {
        projectId: fixture.projectId,
        code: "P10-WI-001",
      },
    },
    update: {
      name: "Phase 10 concrete work",
      status: "IN_PROGRESS",
      progressPercent: 42,
      budget: "2000000.00",
      actualCost: "650000.00",
      isCritical: true,
    },
    create: {
      id: fixture.workItemId,
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      code: "P10-WI-001",
      name: "Phase 10 concrete work",
      status: "IN_PROGRESS",
      priority: "HIGH",
      plannedStart: new Date("2026-08-01T00:00:00.000Z"),
      plannedEnd: new Date("2026-08-31T00:00:00.000Z"),
      progressPercent: 42,
      budget: "2000000.00",
      actualCost: "650000.00",
      isCritical: true,
    },
  });
}

async function main(): Promise<void> {
  const checks: Check[] = [];
  await prisma.$queryRaw`SELECT 1`;
  await prepareFixture();

  const projects = new Phase9ProjectService(
    new PrismaPhase9Store(prisma),
    "phase10-postgres-smoke-cursor-secret-001",
  );
  const frontend = new Phase10FrontendService(
    prisma,
    projects,
    new LocalPhase10ArtifactStorage(
      resolve(process.cwd(), "data/artifacts/phase10-postgres-smoke"),
    ),
    () => new Date("2026-08-03T12:00:00.000Z"),
  );
  const admin: Phase9AuthenticatedPrincipal = {
    userId: fixture.adminUserId,
    tenantId: fixture.tenantId,
    tenantRole: "COMPANY_ADMIN",
    sessionId: "phase10-smoke-admin-session",
    tokenVersion: 1,
  };
  const supervisor: Phase9AuthenticatedPrincipal = {
    userId: fixture.supervisorUserId,
    tenantId: fixture.tenantId,
    tenantRole: "SITE_SUPERVISOR",
    sessionId: "phase10-smoke-supervisor-session",
    tokenVersion: 1,
  };
  const outsider: Phase9AuthenticatedPrincipal = {
    userId: "phase10-smoke-outsider",
    tenantId: fixture.otherTenantId,
    tenantRole: "COMPANY_ADMIN",
    sessionId: "phase10-smoke-outsider-session",
    tokenVersion: 1,
  };

  const workspace = await frontend.workspace(supervisor, fixture.projectId);
  addCheck(
    checks,
    "tenant-scoped-production-workspace",
    workspace.project.id === fixture.projectId &&
      workspace.role === "SITE_SUPERVISOR" &&
      workspace.workItems.length >= 1 &&
      workspace.dashboard.actualProgressPercent === 42,
    `project=${workspace.project.code} role=${workspace.role} workItems=${workspace.workItems.length} progress=${workspace.dashboard.actualProgressPercent}`,
  );

  let isolationCode = "NO_ERROR";
  try {
    await frontend.workspace(outsider, fixture.projectId);
  } catch (error) {
    isolationCode =
      error instanceof Phase9ApiError ? `${error.status}:${error.code}` : String(error);
  }
  addCheck(
    checks,
    "cross-tenant-project-isolation",
    isolationCode === "404:PROJECT_NOT_FOUND",
    `result=${isolationCode}`,
  );

  const projectRequest = {
    code: "P10-CREATED",
    name: "Phase 10 idempotent project",
    description: "Created through Phase10FrontendService",
    location: "Ulaanbaatar",
    plannedStart: "2026-08-03",
    plannedEnd: "2027-08-03",
    budgetMnt: "5000000.00",
    timezone: "Asia/Ulaanbaatar",
  };
  const createdProject = await frontend.createProject(
    admin,
    fixture.projectKey,
    projectRequest,
    "phase10-smoke-project-correlation",
  );
  const replayedProject = await frontend.createProject(
    admin,
    fixture.projectKey,
    projectRequest,
    "phase10-smoke-project-correlation-replay",
  );
  const projectSideEffects = await Promise.all([
    prisma.project.count({ where: { id: createdProject.projectId } }),
    prisma.idempotencyRecord.count({
      where: { tenantId: fixture.tenantId, key: fixture.projectKey },
    }),
    prisma.outboxEvent.count({
      where: {
        tenantId: fixture.tenantId,
        idempotencyKey: `outbox:${fixture.tenantId}:${fixture.projectKey}`,
      },
    }),
  ]);
  addCheck(
    checks,
    "project-create-idempotency",
    createdProject.projectId === replayedProject.projectId &&
      replayedProject.replayed &&
      projectSideEffects.every((count) => count === 1),
    `project=${createdProject.projectId} replay=${replayedProject.replayed} rows=${projectSideEffects.join("/")}`,
  );

  const artifactBody = Buffer.from("buildwatch-phase10-postgres-smoke-image", "utf8");
  const artifactSha256 = createHash("sha256").update(artifactBody).digest("hex");
  const uploadedArtifact = await frontend.uploadArtifact(
    supervisor,
    fixture.projectId,
    fixture.artifactKey,
    {
      body: artifactBody,
      originalFileName: "phase10-progress.png",
      mediaType: "image/png",
      suppliedSha256: artifactSha256,
    },
    "phase10-smoke-artifact-correlation",
  );
  const replayedArtifact = await frontend.uploadArtifact(
    supervisor,
    fixture.projectId,
    fixture.artifactKey,
    {
      body: artifactBody,
      originalFileName: "phase10-progress.png",
      mediaType: "image/png",
      suppliedSha256: artifactSha256,
    },
    "phase10-smoke-artifact-correlation-replay",
  );
  const artifactSideEffects = await Promise.all([
    prisma.fileAsset.count({ where: { id: uploadedArtifact.artifactId } }),
    prisma.idempotencyRecord.count({
      where: { tenantId: fixture.tenantId, key: fixture.artifactKey },
    }),
    prisma.outboxEvent.count({
      where: {
        tenantId: fixture.tenantId,
        idempotencyKey: `outbox:${fixture.tenantId}:${fixture.artifactKey}`,
      },
    }),
  ]);
  addCheck(
    checks,
    "artifact-upload-checksum-idempotency",
    uploadedArtifact.artifactId === replayedArtifact.artifactId &&
      uploadedArtifact.sha256 === artifactSha256 &&
      replayedArtifact.replayed &&
      artifactSideEffects.every((count) => count === 1),
    `artifact=${uploadedArtifact.artifactId} sha256=${uploadedArtifact.sha256.slice(0, 12)} replay=${replayedArtifact.replayed} rows=${artifactSideEffects.join("/")}`,
  );

  const reportRequest = {
    reportDate: "2026-08-03",
    timezone: "Asia/Ulaanbaatar",
    narrative: "Phase 10 PostgreSQL mobile report smoke",
    weather: { condition: "CLEAR", temperatureC: 24 },
    sourceDraftId: null,
    progress: [
      {
        workItemId: fixture.workItemId,
        planItemId: null,
        quantity: "12.5",
        unit: "m3",
        progressPercent: 42,
        sourceRefs: [{ type: "FIELD_NOTE", id: "phase10-smoke-note" }],
      },
    ],
    attendance: [
      {
        crewId: null,
        trade: "Concrete",
        workerCount: 6,
        hoursPerWorker: 8,
        laborRateMnt: "15000.00",
        sourceRefs: [{ type: "ATTENDANCE", id: "phase10-smoke-attendance" }],
      },
    ],
    photos: [
      {
        fileAssetId: uploadedArtifact.artifactId,
        capturedAt: "2026-08-03T10:00:00.000Z",
        planItemId: null,
        latitude: 47.9189,
        longitude: 106.9176,
        orientation: 90,
      },
    ],
  };
  const report = await frontend.submitDailyReport(
    supervisor,
    fixture.projectId,
    fixture.reportKey,
    reportRequest,
    "phase10-smoke-report-correlation",
  );
  const replayedReport = await frontend.submitDailyReport(
    supervisor,
    fixture.projectId,
    fixture.reportKey,
    reportRequest,
    "phase10-smoke-report-correlation-replay",
  );
  const reportSideEffects = await Promise.all([
    prisma.dailyReport.count({ where: { id: report.reportId } }),
    prisma.reviewTask.count({ where: { id: report.reviewTaskId } }),
    prisma.photoEvidence.count({
      where: { dailyReportId: report.reportId, fileAssetId: uploadedArtifact.artifactId },
    }),
    prisma.idempotencyRecord.count({
      where: { tenantId: fixture.tenantId, key: fixture.reportKey },
    }),
    prisma.outboxEvent.count({
      where: {
        tenantId: fixture.tenantId,
        idempotencyKey: `outbox:${fixture.tenantId}:${fixture.reportKey}`,
      },
    }),
  ]);
  addCheck(
    checks,
    "offline-report-review-outbox-idempotency",
    report.reportId === replayedReport.reportId &&
      report.reviewTaskId === replayedReport.reviewTaskId &&
      replayedReport.replayed &&
      reportSideEffects.every((count) => count === 1),
    `report=${report.reportId} review=${report.reviewTaskId} replay=${replayedReport.replayed} rows=${reportSideEffects.join("/")}`,
  );

  const answer = await frontend.answerA4(admin, fixture.projectId, {
    question: "Төслийн төсөв, бодит зардал болон явц хэд вэ?",
  });
  const sourceFields = new Set(answer.sources.map((source) => source.field));
  const allClaimsGrounded = answer.claims.every(
    (claim) =>
      claim.sourceIds.length > 0 &&
      claim.sourceIds.every((sourceId) =>
        answer.sources.some((source) => source.sourceId === sourceId),
      ),
  );
  addCheck(
    checks,
    "a4-read-only-source-grounding",
    answer.status === "ANSWERED" &&
      sourceFields.has("budgetMnt") &&
      sourceFields.has("actualCostMnt") &&
      sourceFields.has("actualProgressPercent") &&
      allClaimsGrounded,
    `status=${answer.status} claims=${answer.claims.length} sources=${answer.sources.length} fields=${[...sourceFields].sort().join(",")}`,
  );

  const refreshedWorkspace = await frontend.workspace(supervisor, fixture.projectId);
  addCheck(
    checks,
    "workspace-reflects-persisted-report",
    refreshedWorkspace.operations.reports.some((candidate) => candidate.id === report.reportId) &&
      refreshedWorkspace.operations.photos.some(
        (candidate) => candidate.fileAssetId === uploadedArtifact.artifactId,
      ) &&
      refreshedWorkspace.reviews.some((candidate) => candidate.id === report.reviewTaskId),
    `reports=${refreshedWorkspace.operations.reports.length} photos=${refreshedWorkspace.operations.photos.length} reviews=${refreshedWorkspace.reviews.length}`,
  );

  const passed = checks.every((check) => check.passed);
  const output = resolve(process.cwd(), "data/evaluations/buildwatch-v22-phase10-postgres.json");
  const result = {
    schemaVersion: 1,
    suite: "BUILDWATCH_V22_PHASE10_POSTGRES",
    generatedAt: new Date().toISOString(),
    passed,
    fixture: {
      tenantId: fixture.tenantId,
      projectId: fixture.projectId,
      durableAndIdempotent: true,
    },
    checks,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Phase 10 PostgreSQL smoke: ${passed ? "PASS" : "FAIL"} (${checks.filter((check) => check.passed).length}/${checks.length})\nReport: ${output}\n`,
  );
  if (!passed) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Phase 10 PostgreSQL smoke failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
