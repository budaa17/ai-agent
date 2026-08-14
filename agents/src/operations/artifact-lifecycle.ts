import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Prisma, type FileAsset, type PrismaClient } from "@prisma/client";

export type Phase11LifecycleDecision = {
  artifactId: string;
  action: "WOULD_DELETE" | "DELETED" | "SKIPPED" | "FAILED";
  reason: string;
};

export interface Phase11ObjectDeleter {
  delete(asset: Pick<FileAsset, "bucket" | "objectKey">): Promise<void>;
}

export class LocalPhase11ObjectDeleter implements Phase11ObjectDeleter {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async delete(asset: Pick<FileAsset, "bucket" | "objectKey">): Promise<void> {
    if (asset.bucket !== "local" || isAbsolute(asset.objectKey)) {
      throw new Error("Unsupported or unsafe artifact object location");
    }
    const target = resolve(this.#root, ...asset.objectKey.split("/"));
    const relativePath = relative(this.#root, target);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error("Artifact lifecycle path escaped its configured root");
    }
    await rm(target, { force: true });
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function runPhase11ArtifactLifecycle(
  client: PrismaClient,
  options: {
    apply: boolean;
    artifactRoot: string;
    now?: Date;
    limit?: number;
    deleter?: Phase11ObjectDeleter;
  },
): Promise<Phase11LifecycleDecision[]> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Lifecycle limit must be between 1 and 1000");
  }
  const candidates = await client.fileAsset.findMany({
    where: {
      status: "AVAILABLE",
      deletedAt: null,
      retentionUntil: { lte: now },
    },
    orderBy: [{ retentionUntil: "asc" }, { id: "asc" }],
    take: limit,
  });
  if (!options.apply) {
    return candidates.map((asset) => ({
      artifactId: asset.id,
      action: "WOULD_DELETE",
      reason: "RETENTION_EXPIRED",
    }));
  }

  const deleter = options.deleter ?? new LocalPhase11ObjectDeleter(options.artifactRoot);
  const decisions: Phase11LifecycleDecision[] = [];
  for (const asset of candidates) {
    const correlationId = `phase11-lifecycle-${randomUUID()}`;
    const quarantined = await client.$transaction(
      async (transaction) => {
        const updated = await transaction.fileAsset.updateMany({
          where: {
            id: asset.id,
            tenantId: asset.tenantId,
            projectId: asset.projectId,
            status: "AVAILABLE",
            retentionUntil: { lte: now },
          },
          data: { status: "QUARANTINED" },
        });
        if (updated.count !== 1) return false;
        await transaction.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId: asset.tenantId,
            projectId: asset.projectId,
            actorUserId: null,
            actorRole: null,
            action: "ARTIFACT_QUARANTINED",
            entityType: "FILE_ASSET",
            entityId: asset.id,
            reason: "RETENTION_EXPIRED",
            correlationId,
            sourceVersion: "buildwatch-v22-phase11-lifecycle-v1",
            beforeHash: asset.sha256,
            afterHash: null,
            metadata: json({ retentionUntil: asset.retentionUntil?.toISOString() ?? null }),
          },
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!quarantined) {
      decisions.push({
        artifactId: asset.id,
        action: "SKIPPED",
        reason: "CONCURRENT_STATE_CHANGE",
      });
      continue;
    }
    try {
      await deleter.delete(asset);
      await client.$transaction(
        async (transaction) => {
          await transaction.fileAsset.update({
            where: { id: asset.id },
            data: { status: "DELETED", deletedAt: now },
          });
          await transaction.auditLog.create({
            data: {
              id: randomUUID(),
              tenantId: asset.tenantId,
              projectId: asset.projectId,
              actorUserId: null,
              actorRole: null,
              action: "ARTIFACT_DELETED",
              entityType: "FILE_ASSET",
              entityId: asset.id,
              reason: "RETENTION_EXPIRED",
              correlationId,
              sourceVersion: "buildwatch-v22-phase11-lifecycle-v1",
              beforeHash: asset.sha256,
              afterHash: null,
              metadata: json({ objectDeleted: true }),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      decisions.push({ artifactId: asset.id, action: "DELETED", reason: "RETENTION_EXPIRED" });
    } catch (error) {
      await client.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: asset.tenantId,
          projectId: asset.projectId,
          actorUserId: null,
          actorRole: null,
          action: "ARTIFACT_DELETE_FAILED",
          entityType: "FILE_ASSET",
          entityId: asset.id,
          reason: "OBJECT_DELETE_FAILED",
          correlationId,
          sourceVersion: "buildwatch-v22-phase11-lifecycle-v1",
          beforeHash: asset.sha256,
          afterHash: null,
          metadata: json({ errorName: error instanceof Error ? error.name : "UnknownError" }),
        },
      });
      decisions.push({ artifactId: asset.id, action: "FAILED", reason: "OBJECT_DELETE_FAILED" });
    }
  }
  return decisions;
}
