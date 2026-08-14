import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/prisma.js";
import { createA3DocumentBundle } from "../../src/reporting/document.js";
import {
  loadA3DocumentDraft,
  persistA3DocumentBundle,
  reviewA3DocumentDraft,
} from "../../src/reporting/persistence.js";
import { buildProjectReportFixture } from "./fixtures.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("A3 document persistence and approval", () => {
  it("persists one idempotent bundle and approves a scoped draft", async () => {
    const fixture = buildProjectReportFixture();
    const requestId = `request-a3-${randomUUID()}`;
    const bundle = createA3DocumentBundle(fixture.projectReport, { requestId });
    let runId: string | null = null;

    try {
      const persisted = await persistA3DocumentBundle(bundle, {
        trigger: "ON_DEMAND",
        provider: "deterministic",
        modelId: "handlebars-v1",
        artifactDirectory: "data/reports/test",
      });
      runId = persisted.runId;
      const reused = await persistA3DocumentBundle(bundle, {
        trigger: "ON_DEMAND",
        provider: "deterministic",
        modelId: "handlebars-v1",
      });

      expect(persisted.reused).toBe(false);
      expect(persisted.draftIds).toHaveLength(3);
      expect(reused).toMatchObject({
        runId,
        reused: true,
      });

      const draft = await loadA3DocumentDraft({
        tenantId: fixture.data.tenantId,
        draftId: persisted.draftIds[0]!,
      });
      const reviewed = await reviewA3DocumentDraft({
        tenantId: fixture.data.tenantId,
        draftId: draft.id,
        decision: "APPROVE",
        reviewedBy: "test-reviewer",
        note: "Тестээр батлав.",
      });

      expect(draft.status).toBe("PENDING_APPROVAL");
      expect(reviewed.status).toBe("APPROVED");

      const storedRun = await prisma.agentRun.findUnique({
        where: { id: runId! },
        include: { documentDrafts: true },
      });
      expect(storedRun).toMatchObject({
        agentType: "A3_DOCUMENT",
        status: "COMPLETED",
      });
      expect(storedRun?.documentDrafts).toHaveLength(3);
    } finally {
      await prisma.a3DocumentDraft.deleteMany({
        where: { requestId },
      });

      if (runId) {
        await prisma.agentRun.deleteMany({
          where: { id: runId },
        });
      }
    }
  });
});
