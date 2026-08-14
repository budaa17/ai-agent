import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  LocalPhase10ArtifactStorage,
  Phase10FrontendService,
  type Phase10Workspace,
  type Phase9AuthenticatedPrincipal,
  type Phase9ProjectService,
} from "../../src/backend/index.js";

const principal: Phase9AuthenticatedPrincipal = {
  userId: "user-1",
  tenantId: "tenant-1",
  tenantRole: "PROJECT_MANAGER",
  sessionId: "session-1",
  tokenVersion: 1,
};

function workspace(): Phase10Workspace {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-03T00:00:00.000Z",
    role: "PROJECT_MANAGER",
    permissions: ["PROJECT_READ", "CHAT_READ"],
    project: {
      id: "project-1",
      code: "ATLAS",
      name: "Atlas",
      description: null,
      location: null,
      status: "ACTIVE",
      plannedStart: "2026-01-01T00:00:00.000Z",
      plannedEnd: "2026-12-31T00:00:00.000Z",
      budgetMnt: "1000000.00",
      actualCostMnt: "450000.00",
      rowVersion: 1,
    },
    dashboard: {
      plannedProgressPercent: 60,
      actualProgressPercent: 52,
      projectedFinish: "2027-01-10T00:00:00.000Z",
      projectedDelayDays: "10.0000",
      costVarianceMnt: "-550000.00",
      criticalActivityCount: 2,
      openAlertCount: 1,
    },
    workItems: [],
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
    alerts: [],
  };
}

describe("BuildWatch Phase 10 frontend service", () => {
  it("A4 budget/cost claim бүрийг тусдаа canonical source-той холбоно", async () => {
    const projects = {
      requireProject: vi.fn(async () => ({ role: "PROJECT_MANAGER" })),
    } as unknown as Phase9ProjectService;
    const service = new Phase10FrontendService({} as PrismaClient, projects, {} as never);
    vi.spyOn(service, "workspace").mockResolvedValue(workspace());
    const answer = await service.answerA4(principal, "project-1", {
      question: "Төсөв болон зардал хэд вэ?",
    });
    expect(answer.status).toBe("ANSWERED");
    expect(answer.claims).toHaveLength(2);
    expect(answer.sources.map((source) => source.field)).toEqual(["budgetMnt", "actualCostMnt"]);
    const sourceIds = new Set(answer.sources.map((source) => source.sourceId));
    expect(
      answer.claims.every((claim) => claim.sourceIds.every((sourceId) => sourceIds.has(sourceId))),
    ).toBe(true);
  });

  it("canonical evidence байхгүй асуултад зохиомол хариулт өгөхгүй", async () => {
    const projects = {
      requireProject: vi.fn(async () => ({ role: "PROJECT_MANAGER" })),
    } as unknown as Phase9ProjectService;
    const service = new Phase10FrontendService({} as PrismaClient, projects, {} as never);
    vi.spyOn(service, "workspace").mockResolvedValue(workspace());
    const answer = await service.answerA4(principal, "project-1", {
      question: "Маргааш бороо орох уу?",
    });
    expect(answer).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", claims: [], sources: [] });
  });

  it("artifact name дахь path traversal-ийг basename болгож root-оос гадагш бичихгүй", async () => {
    const root = await mkdtemp(join(tmpdir(), "buildwatch-phase10-"));
    try {
      const storage = new LocalPhase10ArtifactStorage(root);
      const written = await storage.put({
        tenantId: "tenant-1",
        projectId: "project-1",
        artifactId: "asset-1",
        originalFileName: "../../outside.png",
        mediaType: "image/png",
        body: Buffer.from("safe-bytes"),
      });
      const target = resolve(root, ...written.objectKey.split("/"));
      expect(target.startsWith(`${resolve(root)}${sep}`)).toBe(true);
      expect(await readFile(target, "utf8")).toBe("safe-bytes");
      await written.remove();
      await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
