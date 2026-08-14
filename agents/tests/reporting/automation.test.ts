import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/prisma.js";
import { runAutomatedA3Documents } from "../../src/reporting/automation.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("automated A3 document pipeline", () => {
  it("writes artifacts and persists pending approval drafts", async () => {
    const requestId = `request-a3-auto-${randomUUID()}`;
    const outputDirectory = await mkdtemp(join(tmpdir(), "a3-documents-"));
    let runId: string | null = null;

    try {
      const result = await runAutomatedA3Documents({
        tenantId: "tenant-demo",
        projectRef: "project-atlas",
        asOf: "2026-03-01T00:00:00.000Z",
        answerKeyPath: "data/answer-key.json",
        requestId,
        trigger: "REQUEST",
        outputDirectory,
        noPdf: true,
        analysisOnly: true,
      });
      runId = result.persisted.runId;

      expect(result.bundle.documents).toHaveLength(3);
      expect(result.persisted.draftIds).toHaveLength(3);
      expect(result.paths.pdf).toBeNull();
      await expect(stat(join(outputDirectory, "official-letter.md"))).resolves.toEqual(
        expect.objectContaining({ size: expect.any(Number) }),
      );

      const pending = await prisma.a3DocumentDraft.count({
        where: {
          requestId,
          status: "PENDING_APPROVAL",
        },
      });
      expect(pending).toBe(3);
      const artifactPaths = await prisma.a3DocumentDraft.findMany({
        where: { requestId },
        select: { artifactPath: true },
      });
      expect(artifactPaths.every((item) => item.artifactPath === null)).toBe(true);
    } finally {
      await prisma.a3DocumentDraft.deleteMany({
        where: { requestId },
      });

      if (runId) {
        await prisma.agentRun.deleteMany({
          where: { id: runId },
        });
      }

      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
