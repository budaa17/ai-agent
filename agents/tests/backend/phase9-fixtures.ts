import { createServer } from "node:http";
import { createHash } from "node:crypto";
import {
  InMemoryPhase9ObjectStore,
  InMemoryPhase9Store,
  Phase9ArtifactService,
  Phase9AuthService,
  Phase9ApprovedCommandService,
  Phase9ProjectService,
  Phase9ReviewService,
  Phase9TokenService,
  createPhase9Api,
  hashPhase9Password,
  type Phase9StoreState,
} from "../../src/backend/index.js";

export const phase9TestNow = new Date("2026-08-03T08:00:00.000Z");
export const phase9TestPassword = "BuildWatch-Test-Password-2026!";
export const phase9TestSecret = "buildwatch-phase9-test-secret-0123456789abcdef";
export const phase9ArtifactBody = Buffer.from("authorized buildwatch artifact", "utf8");

export async function buildPhase9TestFixture() {
  const passwordHash = await hashPhase9Password(phase9TestPassword);
  const artifactSha = createHash("sha256").update(phase9ArtifactBody).digest("hex");
  const state: Partial<Phase9StoreState> = {
    tenants: [
      { id: "tenant-alpha", slug: "alpha", name: "Alpha Construction" },
      { id: "tenant-private", slug: "private", name: "Private Construction" },
    ],
    users: [
      {
        id: "user-admin-alpha",
        tenantId: "tenant-alpha",
        email: "admin@alpha.test",
        emailNormalized: "admin@alpha.test",
        displayName: "Alpha Admin",
        tenantRole: "COMPANY_ADMIN",
        status: "ACTIVE",
        tokenVersion: 1,
        emailVerifiedAt: phase9TestNow.toISOString(),
        lastLoginAt: null,
      },
      {
        id: "user-manager-alpha",
        tenantId: "tenant-alpha",
        email: "manager@alpha.test",
        emailNormalized: "manager@alpha.test",
        displayName: "Alpha Manager",
        tenantRole: "OBSERVER",
        status: "ACTIVE",
        tokenVersion: 1,
        emailVerifiedAt: phase9TestNow.toISOString(),
        lastLoginAt: null,
      },
      {
        id: "user-engineer-alpha",
        tenantId: "tenant-alpha",
        email: "engineer@alpha.test",
        emailNormalized: "engineer@alpha.test",
        displayName: "Alpha Engineer",
        tenantRole: "OBSERVER",
        status: "ACTIVE",
        tokenVersion: 1,
        emailVerifiedAt: phase9TestNow.toISOString(),
        lastLoginAt: null,
      },
      {
        id: "user-manager-private",
        tenantId: "tenant-private",
        email: "manager@private.test",
        emailNormalized: "manager@private.test",
        displayName: "Private Manager",
        tenantRole: "COMPANY_ADMIN",
        status: "ACTIVE",
        tokenVersion: 1,
        emailVerifiedAt: phase9TestNow.toISOString(),
        lastLoginAt: null,
      },
    ],
    credentials: [
      "user-admin-alpha",
      "user-manager-alpha",
      "user-engineer-alpha",
      "user-manager-private",
    ].map((userId) => ({
      userId,
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
      passwordChangedAt: phase9TestNow.toISOString(),
    })),
    projects: [
      {
        id: "project-alpha-main",
        tenantId: "tenant-alpha",
        code: "ALPHA-001",
        name: "Alpha Main",
        status: "ACTIVE",
        plannedStart: "2026-01-01T00:00:00.000Z",
        plannedEnd: "2026-12-31T00:00:00.000Z",
        rowVersion: 1,
      },
      {
        id: "project-alpha-second",
        tenantId: "tenant-alpha",
        code: "ALPHA-002",
        name: "Alpha Second",
        status: "PLANNED",
        plannedStart: "2026-03-01T00:00:00.000Z",
        plannedEnd: "2027-02-28T00:00:00.000Z",
        rowVersion: 1,
      },
      {
        id: "project-private-only",
        tenantId: "tenant-private",
        code: "PRIVATE-001",
        name: "TENANT-PRIVATE-ONLY",
        status: "ACTIVE",
        plannedStart: "2026-01-01T00:00:00.000Z",
        plannedEnd: "2026-09-01T00:00:00.000Z",
        rowVersion: 1,
      },
    ],
    memberships: [
      {
        id: "member-manager-alpha",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        userId: "user-manager-alpha",
        role: "PROJECT_MANAGER",
        active: true,
      },
      {
        id: "member-engineer-alpha",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        userId: "user-engineer-alpha",
        role: "ENGINEER",
        active: true,
      },
      {
        id: "member-manager-private",
        tenantId: "tenant-private",
        projectId: "project-private-only",
        userId: "user-manager-private",
        role: "PROJECT_MANAGER",
        active: true,
      },
    ],
    reviewTasks: [
      {
        id: "review-alpha-baseline",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        targetType: "BASELINE",
        targetId: "baseline-alpha-v1",
        targetVersion: 1,
        status: "REVIEW_REQUIRED",
        sourceHash: "a".repeat(64),
        createdByUserId: "user-engineer-alpha",
        assignedRole: "PROJECT_MANAGER",
        assignedUserId: "user-manager-alpha",
        rowVersion: 1,
      },
      {
        id: "review-alpha-self",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        targetType: "DAILY_REPORT",
        targetId: "report-alpha-v1",
        targetVersion: 1,
        status: "REVIEW_REQUIRED",
        sourceHash: "b".repeat(64),
        createdByUserId: "user-manager-alpha",
        assignedRole: "PROJECT_MANAGER",
        assignedUserId: "user-manager-alpha",
        rowVersion: 1,
      },
    ],
    fileAssets: [
      {
        id: "artifact-alpha-001",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        bucket: "phase9-test",
        objectKey: "alpha/artifact.txt",
        originalFileName: "artifact.txt",
        mediaType: "text/plain; charset=utf-8",
        sizeBytes: phase9ArtifactBody.length,
        sha256: artifactSha,
        status: "AVAILABLE",
      },
      {
        id: "artifact-private-001",
        tenantId: "tenant-private",
        projectId: "project-private-only",
        bucket: "phase9-test",
        objectKey: "private/secret.txt",
        originalFileName: "TENANT-PRIVATE-ONLY.txt",
        mediaType: "text/plain",
        sizeBytes: 19,
        sha256: "c".repeat(64),
        status: "AVAILABLE",
      },
    ],
    versionSnapshots: [
      {
        id: "baseline-alpha-v1",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        targetType: "BASELINE",
        versionNumber: 1,
        status: "APPROVED",
        sourceHash: "a".repeat(64),
        content: {
          budget: "1000000.00",
          finish: "2026-12-31",
          quantityVersionId: "quantity-alpha-v1",
          estimateVersionId: "estimate-alpha-v1",
          scheduleVersionId: "schedule-alpha-v1",
        },
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "quantity-alpha-v1",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        targetType: "QUANTITY_TAKEOFF",
        versionNumber: 1,
        status: "APPROVED",
        sourceHash: "q".repeat(64),
        content: { items: [] },
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "estimate-alpha-v1",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        targetType: "ESTIMATE",
        versionNumber: 1,
        status: "APPROVED",
        sourceHash: "e".repeat(64),
        content: { quantityVersionId: "quantity-alpha-v1", lines: [] },
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "schedule-alpha-v1",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        targetType: "SCHEDULE",
        versionNumber: 1,
        status: "APPROVED",
        sourceHash: "s".repeat(64),
        content: { activities: [] },
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "baseline-alpha-v2",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        targetType: "BASELINE",
        versionNumber: 2,
        status: "DRAFT",
        sourceHash: "d".repeat(64),
        content: { budget: "1100000.00", finish: "2027-01-15" },
        createdAt: "2026-08-02T00:00:00.000Z",
      },
    ],
    forecastSnapshots: [
      {
        id: "forecast-alpha-001",
        tenantId: "tenant-alpha",
        projectId: "project-alpha-main",
        asOf: "2026-08-03T00:00:00.000Z",
        status: "AT_RISK",
        projectedFinish: "2027-01-10T00:00:00.000Z",
        delayDays: "10.0000",
        confidence: "0.8800",
        methodVersion: "rolling-v1",
        thresholdVersion: "threshold-v1",
        sourceHash: "e".repeat(64),
        drivers: [{ code: "PRODUCTIVITY", contribution: "7.0" }],
      },
    ],
    auditLogs: [
      {
        id: "audit-private-marker",
        tenantId: "tenant-private",
        projectId: "project-private-only",
        actorUserId: "user-manager-private",
        actorRole: "PROJECT_MANAGER",
        action: "TENANT-PRIVATE-ONLY",
        entityType: "PROJECT",
        entityId: "project-private-only",
        reason: null,
        correlationId: "private-correlation",
        sourceVersion: null,
        beforeHash: null,
        afterHash: null,
        metadata: { marker: "TENANT-PRIVATE-ONLY" },
        occurredAt: phase9TestNow.toISOString(),
      },
    ],
  };
  const store = new InMemoryPhase9Store(state);
  const now = () => new Date(phase9TestNow);
  const tokens = new Phase9TokenService({
    secret: phase9TestSecret,
    issuer: "buildwatch-api",
    audience: "buildwatch-web",
    now,
  });
  const auth = new Phase9AuthService(store, tokens, undefined, now);
  const projects = new Phase9ProjectService(store, phase9TestSecret);
  const commands = new Phase9ApprovedCommandService(store, now);
  const reviews = new Phase9ReviewService(store, now);
  const artifacts = new Phase9ArtifactService(store, phase9TestSecret, "http://127.0.0.1", now);
  const objectStore = new InMemoryPhase9ObjectStore({
    "alpha/artifact.txt": phase9ArtifactBody,
  });
  const app = createPhase9Api({
    auth,
    projects,
    commands,
    reviews,
    artifacts,
    objectStore,
  });
  return { store, tokens, auth, projects, commands, reviews, artifacts, objectStore, app };
}

export async function startPhase9TestServer(app: ReturnType<typeof createPhase9Api>) {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Test server address missing");
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function loginPhase9(baseUrl: string, tenantSlug: string, email: string) {
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "phase9-test-login" },
    body: JSON.stringify({
      tenantSlug,
      email,
      password: phase9TestPassword,
      deviceName: "vitest",
    }),
  });
  if (!response.ok) throw new Error(`Test login failed: ${response.status}`);
  return (await response.json()) as { accessToken: string; refreshToken: string };
}
