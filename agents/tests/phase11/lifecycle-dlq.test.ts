import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  LocalPhase11ObjectDeleter,
  replayPhase11OutboxEvent,
  runPhase11ArtifactLifecycle,
} from "../../src/operations/index.js";

describe("BuildWatch Phase 11 lifecycle and DLQ operations", () => {
  it("dry-runs first, then quarantines, deletes, and audits an expired artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "buildwatch-lifecycle-"));
    const objectKey = "tenant-1/project-1/artifact.png";
    const target = join(root, ...objectKey.split("/"));
    const auditActions: string[] = [];
    const statuses: string[] = [];
    const asset = {
      id: "artifact-1",
      tenantId: "tenant-1",
      projectId: "project-1",
      bucket: "local",
      objectKey,
      originalFileName: "artifact.png",
      mediaType: "image/png",
      sizeBytes: 4,
      sha256: "a".repeat(64),
      status: "AVAILABLE",
      uploadedByUserId: "user-1",
      retentionUntil: new Date("2026-08-01T00:00:00.000Z"),
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      deletedAt: null,
    };
    const transaction = {
      fileAsset: {
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: { data: { status: string } }) => {
          statuses.push(data.status);
          return asset;
        },
      },
      auditLog: {
        create: async ({ data }: { data: { action: string } }) => {
          auditActions.push(data.action);
          return data;
        },
      },
    };
    const client = {
      fileAsset: { findMany: async () => [asset] },
      auditLog: transaction.auditLog,
      $transaction: async (work: (value: typeof transaction) => unknown) => work(transaction),
    } as unknown as PrismaClient;
    try {
      await mkdir(join(root, "tenant-1", "project-1"), { recursive: true });
      await writeFile(target, "data");
      const dryRun = await runPhase11ArtifactLifecycle(client, {
        apply: false,
        artifactRoot: root,
        now: new Date("2026-08-04T00:00:00.000Z"),
      });
      expect(dryRun).toEqual([
        { artifactId: "artifact-1", action: "WOULD_DELETE", reason: "RETENTION_EXPIRED" },
      ]);
      expect(await readFile(target, "utf8")).toBe("data");

      const applied = await runPhase11ArtifactLifecycle(client, {
        apply: true,
        artifactRoot: root,
        now: new Date("2026-08-04T00:00:00.000Z"),
      });
      expect(applied).toEqual([
        { artifactId: "artifact-1", action: "DELETED", reason: "RETENTION_EXPIRED" },
      ]);
      expect(statuses).toEqual(["DELETED"]);
      expect(auditActions).toEqual(["ARTIFACT_QUARANTINED", "ARTIFACT_DELETED"]);
      await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses object paths outside the artifact root", async () => {
    const root = await mkdtemp(join(tmpdir(), "buildwatch-lifecycle-path-"));
    try {
      const deleter = new LocalPhase11ObjectDeleter(root);
      await expect(
        deleter.delete({ bucket: "local", objectKey: "../outside.txt" }),
      ).rejects.toThrow("escaped");
      await expect(deleter.delete({ bucket: "s3", objectKey: "tenant/file" })).rejects.toThrow(
        "Unsupported",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("replays only an explicitly scoped dead-letter and writes an audit record", async () => {
    const event = {
      id: "event-1",
      tenantId: "tenant-1",
      projectId: "project-1",
      status: "DEAD_LETTER",
      retryCount: 8,
      lastErrorCode: "publisher-failed",
    };
    const updates: unknown[] = [];
    const audits: unknown[] = [];
    const transaction = {
      outboxEvent: {
        updateMany: async (input: unknown) => {
          updates.push(input);
          return { count: 1 };
        },
      },
      auditLog: {
        create: async (input: unknown) => {
          audits.push(input);
          return input;
        },
      },
    };
    const client = {
      outboxEvent: { findUnique: async () => event },
      $transaction: async (work: (value: typeof transaction) => unknown) => work(transaction),
    } as unknown as PrismaClient;

    const dryRun = await replayPhase11OutboxEvent(client, {
      eventId: "event-1",
      tenantId: "tenant-1",
      projectId: "project-1",
      reason: "Verified publisher outage has been resolved",
      apply: false,
    });
    expect(dryRun).toMatchObject({ applied: false, status: "DEAD_LETTER" });
    expect(updates).toHaveLength(0);

    const applied = await replayPhase11OutboxEvent(client, {
      eventId: "event-1",
      tenantId: "tenant-1",
      projectId: "project-1",
      reason: "Verified publisher outage has been resolved",
      apply: true,
    });
    expect(applied).toMatchObject({ applied: true, status: "PENDING" });
    expect(updates).toHaveLength(1);
    expect(audits).toHaveLength(1);
    await expect(
      replayPhase11OutboxEvent(client, {
        eventId: "event-1",
        tenantId: "tenant-private",
        projectId: "project-1",
        reason: "Attempted replay using a mismatched tenant scope",
        apply: true,
      }),
    ).rejects.toThrow("scope does not match");
  });
});
