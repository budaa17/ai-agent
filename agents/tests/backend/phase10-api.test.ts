import {
  Phase9ApiError,
  createPhase9Api,
  requireTenantPermission,
  type Phase10FrontendService,
  type Phase9AuthenticatedPrincipal,
} from "../../src/backend/index.js";
import {
  buildPhase9TestFixture,
  loginPhase9,
  phase9TestNow,
  startPhase9TestServer,
} from "./phase9-fixtures.js";

function workspaceFixture(projectId: string) {
  return {
    schemaVersion: 1 as const,
    generatedAt: phase9TestNow.toISOString(),
    role: "PROJECT_MANAGER" as const,
    permissions: ["PROJECT_READ", "REPORT_SUBMIT", "ARTIFACT_UPLOAD", "CHAT_READ"] as const,
    project: {
      id: projectId,
      code: "ALPHA-001",
      name: "Alpha Main",
      description: null,
      location: null,
      status: "ACTIVE" as const,
      plannedStart: "2026-01-01T00:00:00.000Z",
      plannedEnd: "2026-12-31T00:00:00.000Z",
      budgetMnt: "1000000.00",
      actualCostMnt: "450000.00",
      rowVersion: 1,
    },
    dashboard: {
      plannedProgressPercent: 58,
      actualProgressPercent: 52,
      projectedFinish: "2027-01-10T00:00:00.000Z",
      projectedDelayDays: "10.0000",
      costVarianceMnt: "-550000.00",
      criticalActivityCount: 2,
      openAlertCount: 1,
    },
    workItems: [{ id: "work-alpha-1", code: "BW-017", name: "Foundation" }],
    dependencies: [],
    design: { documents: [], revisions: [], pages: [], scales: [], elements: [] },
    commercial: {
      quantityVersions: [],
      quantityItems: [],
      estimateVersions: [],
      estimateLines: [],
      estimateAssumptions: [],
      baselines: [],
    },
    schedule: { versions: [], activities: [], dependencies: [] },
    resources: { crews: [], equipment: [] },
    operations: {
      plans: [],
      planItems: [],
      reports: [],
      progress: [],
      attendance: [],
      photos: [],
      verifications: [],
      variances: [],
    },
    forecast: { snapshots: [], workItems: [], drivers: [], recoveryScenarios: [] },
    reviews: [],
    artifacts: [],
    assistants: { a1Drafts: [], a3Drafts: [] },
    alerts: [{ id: "alert-1", type: "VERIFICATION", severity: "HIGH", title: "Evidence gap" }],
  };
}

describe("BuildWatch Phase 10 frontend HTTP contract", () => {
  it("serves session/workspace and returns non-disclosing 404 for project IDOR", async () => {
    const fixture = await buildPhase9TestFixture();
    const frontend = {
      workspace: async (principal: Phase9AuthenticatedPrincipal, projectId: string) => {
        await fixture.projects.requireProject(principal, projectId, "PROJECT_READ");
        return workspaceFixture(projectId);
      },
    } as unknown as Phase10FrontendService;
    const app = createPhase9Api({ ...fixture, frontend });
    const runtime = await startPhase9TestServer(app);
    try {
      const pair = await loginPhase9(runtime.baseUrl, "alpha", "manager@alpha.test");
      const headers = { authorization: `Bearer ${pair.accessToken}` };
      const session = await fetch(`${runtime.baseUrl}/v1/session`, { headers });
      expect(session.status).toBe(200);
      expect((await session.json()) as object).toMatchObject({
        schemaVersion: 1,
        user: { id: "user-manager-alpha", tenantId: "tenant-alpha" },
        projectMemberships: [
          expect.objectContaining({ projectId: "project-alpha-main", role: "PROJECT_MANAGER" }),
        ],
      });
      const workspace = await fetch(`${runtime.baseUrl}/v1/projects/project-alpha-main/workspace`, {
        headers,
      });
      expect(workspace.status).toBe(200);
      expect((await workspace.json()) as object).toMatchObject({
        project: { code: "ALPHA-001" },
        dashboard: { actualProgressPercent: 52 },
      });

      const privateWorkspace = await fetch(
        `${runtime.baseUrl}/v1/projects/project-private-only/workspace`,
        { headers },
      );
      expect(privateWorkspace.status).toBe(404);
      const privateBody = JSON.stringify(await privateWorkspace.json());
      expect(privateBody).not.toContain("tenant-private");
      expect(privateBody).not.toContain("TENANT-PRIVATE-ONLY");
    } finally {
      await runtime.close();
    }
  });

  it("wires binary upload, offline-idempotent daily draft, and source-backed A4 routes", async () => {
    const fixture = await buildPhase9TestFixture();
    const calls: {
      report?: unknown;
      upload?: { size: number; mediaType: string; originalFileName: string };
      a0?: unknown;
      question?: unknown;
    } = {};
    const frontend = {
      submitDailyReport: async (
        principal: Phase9AuthenticatedPrincipal,
        projectId: string,
        idempotencyKey: string,
        input: unknown,
      ) => {
        await fixture.projects.requireProject(principal, projectId, "REPORT_SUBMIT");
        if (idempotencyKey !== "offline-report-1")
          throw new Phase9ApiError("IDEMPOTENCY_CONFLICT", 409, "Unexpected key");
        calls.report = input;
        return {
          reportId: "report-1",
          reviewTaskId: "review-report-1",
          status: "REVIEW_REQUIRED" as const,
          sourceHash: "a".repeat(64),
          rowVersion: 1,
          eventId: "event-1",
          auditId: "audit-1",
          createdAt: phase9TestNow.toISOString(),
          replayed: false,
        };
      },
      uploadArtifact: async (
        principal: Phase9AuthenticatedPrincipal,
        projectId: string,
        _key: string,
        input: { body: Buffer; mediaType: string; originalFileName: string },
      ) => {
        await fixture.projects.requireProject(principal, projectId, "ARTIFACT_UPLOAD");
        calls.upload = {
          size: input.body.length,
          mediaType: input.mediaType,
          originalFileName: input.originalFileName,
        };
        return {
          artifactId: "asset-1",
          originalFileName: "progress.png",
          mediaType: input.mediaType,
          sizeBytes: input.body.length,
          sha256: "b".repeat(64),
          status: "AVAILABLE" as const,
          eventId: "event-asset-1",
          createdAt: phase9TestNow.toISOString(),
          replayed: false,
        };
      },
      processA0Intake: async (
        principal: Phase9AuthenticatedPrincipal,
        projectId: string,
        idempotencyKey: string,
        input: unknown,
      ) => {
        await fixture.projects.requireProject(principal, projectId, "DESIGN_READ");
        expect(idempotencyKey).toBe("a0-package-1");
        calls.a0 = input;
        return {
          schemaVersion: 1 as const,
          runId: "a0-run-1",
          requestId: "a0-request-1",
          status: "REVIEW_REQUIRED" as const,
          quantityVersionId: "quantity-v1",
          estimateVersionId: "estimate-v1",
          scheduleVersionId: "schedule-v1",
          baselineVersionId: "baseline-v1",
          reviewTaskIds: {
            quantity: "review-quantity-v1",
            estimate: "review-estimate-v1",
            schedule: "review-schedule-v1",
            baseline: "review-baseline-v1",
          },
          counts: {
            documents: 4,
            quantityItems: 18,
            materialRequirements: 27,
            estimateLines: 18,
            scheduleActivities: 18,
            scheduleDependencies: 23,
          },
          estimateTotalMnt: "164342000.00",
          plannedStart: "2026-08-03",
          plannedFinish: "2026-11-07",
          criticalActivityCodes: ["WBS-01"],
          warnings: [],
          eventId: "event-a0-1",
          auditId: "audit-a0-1",
          createdAt: phase9TestNow.toISOString(),
          replayed: false,
        };
      },
      answerA4: async (
        principal: Phase9AuthenticatedPrincipal,
        projectId: string,
        input: unknown,
      ) => {
        await fixture.projects.requireProject(principal, projectId, "CHAT_READ");
        calls.question = input;
        return {
          schemaVersion: 1 as const,
          status: "ANSWERED" as const,
          answer: "Төслийн төсөв 1,000,000 ₮.",
          claims: [{ text: "Төсөв 1,000,000 ₮", sourceIds: ["project-budget"] }],
          sources: [
            {
              sourceId: "project-budget",
              entityType: "Project",
              entityId: projectId,
              field: "budget",
              value: "1000000.00",
            },
          ],
          toolNames: ["get_project_summary"],
        };
      },
    } as unknown as Phase10FrontendService;
    const runtime = await startPhase9TestServer(createPhase9Api({ ...fixture, frontend }));
    try {
      const pair = await loginPhase9(runtime.baseUrl, "alpha", "manager@alpha.test");
      const authorization = `Bearer ${pair.accessToken}`;
      const report = await fetch(
        `${runtime.baseUrl}/v1/projects/project-alpha-main/daily-report-drafts`,
        {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json",
            "Idempotency-Key": "offline-report-1",
          },
          body: JSON.stringify({
            reportDate: "2026-08-03",
            progress: [{ workItemId: "work-alpha-1", quantity: "10", unit: "м3" }],
          }),
        },
      );
      expect(report.status).toBe(201);
      expect((await report.json()) as object).toMatchObject({
        status: "REVIEW_REQUIRED",
        reviewTaskId: "review-report-1",
      });

      const upload = await fetch(`${runtime.baseUrl}/v1/projects/project-alpha-main/artifacts`, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "image/png",
          "x-file-name": "progress.png",
          "Idempotency-Key": "asset-upload-1",
        },
        body: Buffer.from("png-binary"),
      });
      expect(upload.status).toBe(201);
      expect(calls.upload).toEqual({
        size: 10,
        mediaType: "image/png",
        originalFileName: "progress.png",
      });

      const unicodeFileName = "Барилгын зураг №1.pdf";
      const unicodeUpload = await fetch(
        `${runtime.baseUrl}/v1/projects/project-alpha-main/artifacts`,
        {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/pdf",
            "x-file-name": encodeURIComponent(unicodeFileName),
            "x-file-name-encoding": "percent",
            "Idempotency-Key": "asset-upload-unicode-1",
          },
          body: Buffer.from("pdf-binary"),
        },
      );
      expect(unicodeUpload.status).toBe(201);
      expect(calls.upload).toEqual({
        size: 10,
        mediaType: "application/pdf",
        originalFileName: unicodeFileName,
      });

      const a0 = await fetch(`${runtime.baseUrl}/v1/projects/project-alpha-main/a0-intakes`, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
          "Idempotency-Key": "a0-package-1",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          requestId: "a0-request-1",
          revisionCode: "R0",
          effectiveDate: "2026-08-03",
          artifacts: [
            { artifactId: "price-1", role: "MATERIAL_PRICE_CATALOG" },
            { artifactId: "norm-1", role: "MATERIAL_NORMS" },
            { artifactId: "boq-1", role: "BOQ_WORK_ITEMS" },
            { artifactId: "wbs-1", role: "WBS_DEPENDENCIES" },
          ],
        }),
      });
      expect(a0.status).toBe(201);
      expect((await a0.json()) as object).toMatchObject({
        status: "REVIEW_REQUIRED",
        counts: { quantityItems: 18, scheduleDependencies: 23 },
      });

      const chat = await fetch(`${runtime.baseUrl}/v1/projects/project-alpha-main/chat`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ question: "Төсөв хэд вэ?" }),
      });
      expect(chat.status).toBe(200);
      expect((await chat.json()) as object).toMatchObject({
        status: "ANSWERED",
        sources: [expect.objectContaining({ field: "budget" })],
      });
      expect(calls.report).toMatchObject({ reportDate: "2026-08-03" });
      expect(calls.question).toEqual({ question: "Төсөв хэд вэ?" });
      expect(calls.a0).toMatchObject({ requestId: "a0-request-1", revisionCode: "R0" });
    } finally {
      await runtime.close();
    }
  });

  it("allows tenant admin project creation but rejects project-only manager", async () => {
    const fixture = await buildPhase9TestFixture();
    const frontend = {
      createProject: async (
        principal: Phase9AuthenticatedPrincipal,
        idempotencyKey: string,
        input: unknown,
      ) => {
        requireTenantPermission(principal, "PROJECT_MANAGE");
        expect(idempotencyKey).toBe("project-create-1");
        expect(input).toMatchObject({ code: "NEW-001" });
        return {
          projectId: "project-new",
          code: "NEW-001",
          status: "PLANNED" as const,
          eventId: "event-new",
          auditId: "audit-new",
          createdAt: phase9TestNow.toISOString(),
          replayed: false,
        };
      },
    } as unknown as Phase10FrontendService;
    const runtime = await startPhase9TestServer(createPhase9Api({ ...fixture, frontend }));
    const request = async (token: string) =>
      fetch(`${runtime.baseUrl}/v1/projects`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "Idempotency-Key": "project-create-1",
        },
        body: JSON.stringify({
          code: "NEW-001",
          name: "New",
          plannedStart: "2026-08-03",
          plannedEnd: "2027-08-03",
          budgetMnt: "1000000",
        }),
      });
    try {
      const manager = await loginPhase9(runtime.baseUrl, "alpha", "manager@alpha.test");
      expect((await request(manager.accessToken)).status).toBe(403);
      const admin = await loginPhase9(runtime.baseUrl, "alpha", "admin@alpha.test");
      const response = await request(admin.accessToken);
      expect(response.status).toBe(201);
      expect((await response.json()) as object).toMatchObject({ projectId: "project-new" });
    } finally {
      await runtime.close();
    }
  });
});
