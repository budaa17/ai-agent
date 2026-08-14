import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { Phase9ApiError } from "./contracts.js";
import {
  a1RegistrationContent,
  a1RegistrationLifecycleStatus,
  a1RegistrationSourceHash,
} from "./a1-review.js";
import { projectUpdateExtractionSchema } from "../structuring/schema.js";
import type {
  Phase9AppliedCommandRecord,
  Phase9AuditRecord,
  Phase9ConsumedEventRecord,
  Phase9CredentialRecord,
  Phase9FileAssetRecord,
  Phase9ForecastQueryRecord,
  Phase9IdempotencyRecord,
  Phase9InvitationRecord,
  Phase9NotificationRecord,
  Phase9OutboxRecord,
  Phase9ProjectMemberRecord,
  Phase9ProjectRecord,
  Phase9RefreshSessionRecord,
  Phase9ReviewDecisionRecord,
  Phase9ReviewTaskRecord,
  Phase9Store,
  Phase9StoreTransaction,
  Phase9TenantRecord,
  Phase9UserRecord,
  Phase9VersionSnapshotRecord,
} from "./store.js";

type Phase9PrismaClient = Prisma.TransactionClient;

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function inputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function plainRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as Record<string, unknown>;
}

function tenantRecord(value: { id: string; slug: string; name: string }): Phase9TenantRecord {
  return { id: value.id, slug: value.slug, name: value.name };
}

function userRecord(value: {
  id: string;
  tenantId: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  tenantRole: Phase9UserRecord["tenantRole"];
  status: Phase9UserRecord["status"];
  tokenVersion: number;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
}): Phase9UserRecord {
  return {
    ...value,
    emailVerifiedAt: iso(value.emailVerifiedAt),
    lastLoginAt: iso(value.lastLoginAt),
  };
}

function credentialRecord(value: {
  userId: string;
  passwordHash: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date;
}): Phase9CredentialRecord {
  return {
    ...value,
    lockedUntil: iso(value.lockedUntil),
    passwordChangedAt: value.passwordChangedAt.toISOString(),
  };
}

function invitationRecord(value: {
  id: string;
  tenantId: string;
  emailNormalized: string;
  role: Phase9InvitationRecord["role"];
  projectIds: string[];
  tokenHash: string;
  status: Phase9InvitationRecord["status"];
  expiresAt: Date;
  invitedByUserId: string;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
}): Phase9InvitationRecord {
  return {
    ...value,
    expiresAt: value.expiresAt.toISOString(),
    acceptedAt: iso(value.acceptedAt),
    createdAt: value.createdAt.toISOString(),
  };
}

function membershipRecord(value: {
  id: string;
  tenantId: string;
  projectId: string;
  userId: string;
  role: Phase9ProjectMemberRecord["role"];
  active: boolean;
}): Phase9ProjectMemberRecord {
  return value;
}

function sessionRecord(value: {
  id: string;
  tenantId: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  parentSessionId: string | null;
  replacedById: string | null;
  deviceName: string | null;
  userAgent: string | null;
  ipAddressHash: string | null;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  reuseDetectedAt: Date | null;
  createdAt: Date;
}): Phase9RefreshSessionRecord {
  return {
    ...value,
    expiresAt: value.expiresAt.toISOString(),
    lastUsedAt: iso(value.lastUsedAt),
    revokedAt: iso(value.revokedAt),
    reuseDetectedAt: iso(value.reuseDetectedAt),
    createdAt: value.createdAt.toISOString(),
  };
}

function projectRecord(value: {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  status: Phase9ProjectRecord["status"];
  plannedStart: Date;
  plannedEnd: Date;
  rowVersion: number;
}): Phase9ProjectRecord {
  return {
    ...value,
    plannedStart: value.plannedStart.toISOString(),
    plannedEnd: value.plannedEnd.toISOString(),
  };
}

function reviewTaskRecord(value: {
  id: string;
  tenantId: string;
  projectId: string;
  targetType: Phase9ReviewTaskRecord["targetType"];
  targetId: string;
  targetVersion: number;
  status: Phase9ReviewTaskRecord["status"];
  sourceHash: string;
  createdByUserId: string;
  assignedRole: Phase9ReviewTaskRecord["assignedRole"];
  assignedUserId: string | null;
  rowVersion: number;
}): Phase9ReviewTaskRecord {
  return value;
}

function fileRecord(value: {
  id: string;
  tenantId: string;
  projectId: string;
  bucket: string;
  objectKey: string;
  originalFileName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  status: Phase9FileAssetRecord["status"];
}): Phase9FileAssetRecord {
  return value;
}

function idempotencyRecord(value: {
  id: string;
  tenantId: string;
  projectId: string;
  key: string;
  route: string;
  requestHash: string;
  responseStatus: number;
  responseBody: Prisma.JsonValue;
  actorUserId: string;
  expiresAt: Date;
  createdAt: Date;
}): Phase9IdempotencyRecord {
  return {
    ...value,
    responseBody: plainRecord(value.responseBody),
    expiresAt: value.expiresAt.toISOString(),
    createdAt: value.createdAt.toISOString(),
  };
}

function auditRecord(value: {
  id: string;
  tenantId: string;
  projectId: string | null;
  actorUserId: string | null;
  actorRole: Phase9AuditRecord["actorRole"];
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  correlationId: string;
  sourceVersion: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  metadata: Prisma.JsonValue;
  occurredAt: Date;
}): Phase9AuditRecord {
  return {
    ...value,
    metadata: plainRecord(value.metadata),
    occurredAt: value.occurredAt.toISOString(),
  };
}

function outboxRecord(value: {
  id: string;
  tenantId: string;
  projectId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  idempotencyKey: string;
  payload: Prisma.JsonValue;
  headers: Prisma.JsonValue;
  status: Phase9OutboxRecord["status"];
  availableAt: Date;
  publishedAt: Date | null;
  retryCount: number;
  lastErrorCode: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  createdAt: Date;
}): Phase9OutboxRecord {
  return {
    ...value,
    payload: plainRecord(value.payload),
    headers: plainRecord(value.headers),
    availableAt: value.availableAt.toISOString(),
    publishedAt: iso(value.publishedAt),
    lockedAt: iso(value.lockedAt),
    createdAt: value.createdAt.toISOString(),
  };
}

export class PrismaPhase9StoreTransaction implements Phase9StoreTransaction {
  constructor(private readonly client: Phase9PrismaClient) {}

  async findTenantBySlug(slug: string) {
    const value = await this.client.tenant.findUnique({ where: { slug } });
    return value === null ? null : tenantRecord(value);
  }

  async findTenantById(tenantId: string) {
    const value = await this.client.tenant.findUnique({ where: { id: tenantId } });
    return value === null ? null : tenantRecord(value);
  }

  async findUserByEmail(tenantId: string, emailNormalized: string) {
    const value = await this.client.user.findUnique({
      where: { tenantId_emailNormalized: { tenantId, emailNormalized } },
    });
    return value === null ? null : userRecord(value);
  }

  async findActiveUsersByEmail(emailNormalized: string, limit: number) {
    const values = await this.client.user.findMany({
      where: { emailNormalized, status: "ACTIVE", deletedAt: null },
      orderBy: { tenantId: "asc" },
      take: limit,
    });
    return values.map((value) => userRecord(value));
  }

  async findUserById(tenantId: string, userId: string) {
    const value = await this.client.user.findFirst({ where: { id: userId, tenantId } });
    return value === null ? null : userRecord(value);
  }

  async createUser(record: Phase9UserRecord) {
    await this.client.user.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        email: record.email,
        emailNormalized: record.emailNormalized,
        displayName: record.displayName,
        tenantRole: record.tenantRole,
        status: record.status,
        tokenVersion: record.tokenVersion,
        emailVerifiedAt: record.emailVerifiedAt === null ? null : new Date(record.emailVerifiedAt),
        lastLoginAt: record.lastLoginAt === null ? null : new Date(record.lastLoginAt),
      },
    });
  }

  async updateUser(record: Phase9UserRecord) {
    await this.client.user.update({
      where: { id: record.id },
      data: {
        email: record.email,
        emailNormalized: record.emailNormalized,
        displayName: record.displayName,
        tenantRole: record.tenantRole,
        status: record.status,
        tokenVersion: record.tokenVersion,
        emailVerifiedAt: record.emailVerifiedAt === null ? null : new Date(record.emailVerifiedAt),
        lastLoginAt: record.lastLoginAt === null ? null : new Date(record.lastLoginAt),
      },
    });
  }

  async getCredential(userId: string) {
    const value = await this.client.userCredential.findUnique({ where: { userId } });
    return value === null ? null : credentialRecord(value);
  }

  async createCredential(record: Phase9CredentialRecord) {
    await this.client.userCredential.create({
      data: {
        userId: record.userId,
        passwordHash: record.passwordHash,
        failedLoginCount: record.failedLoginCount,
        lockedUntil: record.lockedUntil === null ? null : new Date(record.lockedUntil),
        passwordChangedAt: new Date(record.passwordChangedAt),
      },
    });
  }

  async updateCredential(record: Phase9CredentialRecord) {
    await this.client.userCredential.update({
      where: { userId: record.userId },
      data: {
        passwordHash: record.passwordHash,
        failedLoginCount: record.failedLoginCount,
        lockedUntil: record.lockedUntil === null ? null : new Date(record.lockedUntil),
        passwordChangedAt: new Date(record.passwordChangedAt),
      },
    });
  }

  async findInvitationByTokenHash(tokenHash: string) {
    const value = await this.client.tenantInvitation.findUnique({ where: { tokenHash } });
    return value === null ? null : invitationRecord(value);
  }

  async createInvitation(record: Phase9InvitationRecord) {
    await this.client.tenantInvitation.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        emailNormalized: record.emailNormalized,
        role: record.role,
        projectIds: record.projectIds,
        tokenHash: record.tokenHash,
        status: record.status,
        expiresAt: new Date(record.expiresAt),
        invitedByUserId: record.invitedByUserId,
        acceptedByUserId: record.acceptedByUserId,
        acceptedAt: record.acceptedAt === null ? null : new Date(record.acceptedAt),
        createdAt: new Date(record.createdAt),
      },
    });
  }

  async updateInvitation(record: Phase9InvitationRecord) {
    await this.client.tenantInvitation.update({
      where: { id: record.id },
      data: {
        status: record.status,
        acceptedByUserId: record.acceptedByUserId,
        acceptedAt: record.acceptedAt === null ? null : new Date(record.acceptedAt),
      },
    });
  }

  async createMembership(record: Phase9ProjectMemberRecord) {
    await this.client.projectMember.upsert({
      where: { projectId_userId: { projectId: record.projectId, userId: record.userId } },
      update: { role: record.role, active: record.active },
      create: record,
    });
  }

  async findMembership(tenantId: string, projectId: string, userId: string) {
    const value = await this.client.projectMember.findFirst({
      where: { tenantId, projectId, userId, active: true },
    });
    return value === null ? null : membershipRecord(value);
  }

  async listMemberships(tenantId: string, userId: string) {
    return (
      await this.client.projectMember.findMany({
        where: { tenantId, userId, active: true },
      })
    ).map(membershipRecord);
  }

  async createSession(record: Phase9RefreshSessionRecord) {
    await this.client.refreshSession.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        userId: record.userId,
        familyId: record.familyId,
        tokenHash: record.tokenHash,
        parentSessionId: record.parentSessionId,
        replacedById: record.replacedById,
        deviceName: record.deviceName,
        userAgent: record.userAgent,
        ipAddressHash: record.ipAddressHash,
        expiresAt: new Date(record.expiresAt),
        lastUsedAt: record.lastUsedAt === null ? null : new Date(record.lastUsedAt),
        revokedAt: record.revokedAt === null ? null : new Date(record.revokedAt),
        reuseDetectedAt: record.reuseDetectedAt === null ? null : new Date(record.reuseDetectedAt),
        createdAt: new Date(record.createdAt),
      },
    });
  }

  async findSession(sessionId: string) {
    const value = await this.client.refreshSession.findUnique({
      where: { id: sessionId },
    });
    return value === null ? null : sessionRecord(value);
  }

  async updateSession(record: Phase9RefreshSessionRecord) {
    await this.client.refreshSession.update({
      where: { id: record.id },
      data: {
        tokenHash: record.tokenHash,
        replacedById: record.replacedById,
        deviceName: record.deviceName,
        userAgent: record.userAgent,
        ipAddressHash: record.ipAddressHash,
        expiresAt: new Date(record.expiresAt),
        lastUsedAt: record.lastUsedAt === null ? null : new Date(record.lastUsedAt),
        revokedAt: record.revokedAt === null ? null : new Date(record.revokedAt),
        reuseDetectedAt: record.reuseDetectedAt === null ? null : new Date(record.reuseDetectedAt),
      },
    });
  }

  async revokeSessionFamily(familyId: string, at: string, reuseDetected: boolean) {
    await this.client.refreshSession.updateMany({
      where: { familyId },
      data: {
        revokedAt: new Date(at),
        ...(reuseDetected ? { reuseDetectedAt: new Date(at) } : {}),
      },
    });
  }

  async getProject(tenantId: string, projectId: string) {
    const value = await this.client.project.findFirst({
      where: { id: projectId, tenantId },
    });
    return value === null ? null : projectRecord(value);
  }

  async listProjects(tenantId: string) {
    return (await this.client.project.findMany({ where: { tenantId } })).map(projectRecord);
  }

  async getReviewTask(tenantId: string, projectId: string, taskId: string) {
    const value = await this.client.reviewTask.findFirst({
      where: { id: taskId, tenantId, projectId },
    });
    return value === null ? null : reviewTaskRecord(value);
  }

  async updateReviewTask(record: Phase9ReviewTaskRecord) {
    const updated = await this.client.reviewTask.updateMany({
      where: {
        id: record.id,
        tenantId: record.tenantId,
        projectId: record.projectId,
        rowVersion: record.rowVersion - 1,
      },
      data: { status: record.status, rowVersion: record.rowVersion },
    });
    if (updated.count !== 1) {
      throw new Phase9ApiError(
        "OPTIMISTIC_LOCK_CONFLICT",
        409,
        "Review task changed before update",
      );
    }
  }

  async getFileAsset(tenantId: string, projectId: string, artifactId: string) {
    const value = await this.client.fileAsset.findFirst({
      where: { id: artifactId, tenantId, projectId, deletedAt: null },
    });
    return value === null ? null : fileRecord(value);
  }

  async getVersionSnapshot(tenantId: string, projectId: string, versionId: string) {
    const candidates: Array<{
      targetType: Phase9VersionSnapshotRecord["targetType"];
      value: Record<string, unknown> | null;
    }> = [
      {
        targetType: "REGISTRATION_DRAFT",
        value: await this.client.registrationDraft.findFirst({
          where: { id: versionId, tenantId, projectId },
        }),
      },
      {
        targetType: "QUANTITY_TAKEOFF",
        value: await this.client.quantityTakeoffVersion.findFirst({
          where: { id: versionId, tenantId, projectId },
          include: { items: { include: { adjustments: true } } },
        }),
      },
      {
        targetType: "ESTIMATE",
        value: await this.client.estimateVersion.findFirst({
          where: { id: versionId, tenantId, projectId },
          include: { lines: true, assumptions: true, scenarios: true },
        }),
      },
      {
        targetType: "SCHEDULE",
        value: await this.client.scheduleVersion.findFirst({
          where: { id: versionId, tenantId, projectId },
          include: { activities: { include: { resourceRequirements: true } } },
        }),
      },
      {
        targetType: "BASELINE",
        value: await this.client.baselineVersion.findFirst({
          where: { id: versionId, tenantId, projectId },
        }),
      },
      {
        targetType: "DAILY_WORK_PLAN",
        value: await this.client.dailyWorkPlan.findFirst({
          where: { id: versionId, tenantId, projectId },
          include: {
            items: {
              include: { resources: true, materials: true, preconditions: true },
            },
          },
        }),
      },
      {
        targetType: "DAILY_REPORT",
        value: await this.client.dailyReport.findFirst({
          where: { id: versionId, tenantId, projectId },
          include: { progressEntries: true, attendanceEntries: true },
        }),
      },
      {
        targetType: "PROGRESS_VERIFICATION",
        value: await this.client.progressVerification.findFirst({
          where: { id: versionId, tenantId, projectId },
          include: { issues: true },
        }),
      },
      {
        targetType: "RECOVERY_SCENARIO",
        value: await this.client.recoveryScenario.findFirst({
          where: { id: versionId, tenantId, projectId },
        }),
      },
    ];
    const found = candidates.find((candidate) => candidate.value !== null);
    if (found?.value === null || found === undefined) return null;
    if (found.targetType === "REGISTRATION_DRAFT") {
      const draft = found.value as Parameters<typeof a1RegistrationContent>[0];
      return {
        id: draft.id,
        tenantId,
        projectId,
        targetType: found.targetType,
        versionNumber: draft.rowVersion,
        status: a1RegistrationLifecycleStatus(draft.status),
        sourceHash: a1RegistrationSourceHash(draft),
        content: a1RegistrationContent(draft),
        createdAt:
          draft.createdAt instanceof Date
            ? draft.createdAt.toISOString()
            : new Date(draft.createdAt).toISOString(),
      };
    }
    const value = plainRecord(found.value);
    return {
      id: String(value.id),
      tenantId,
      projectId,
      targetType: found.targetType,
      versionNumber: Number(value.versionNumber ?? value.targetVersion ?? 1),
      status: value.status as Phase9VersionSnapshotRecord["status"],
      sourceHash: String(value.sourceHash),
      content: value,
      createdAt: String(value.createdAt),
    };
  }

  async updateVersionStatus(
    tenantId: string,
    projectId: string,
    versionId: string,
    targetType: Phase9VersionSnapshotRecord["targetType"],
    status: Phase9VersionSnapshotRecord["status"],
  ) {
    const where = { id: versionId, tenantId, projectId };
    // Each canonical artefact lives in its own table; the review task only
    // knows the target type, so dispatch on it.
    switch (targetType) {
      case "REGISTRATION_DRAFT": {
        const registrationStatus =
          status === "APPROVED"
            ? "APPROVED"
            : status === "APPLIED"
              ? "APPLIED"
              : status === "REJECTED"
                ? "REJECTED"
                : status === "REVIEW_REQUIRED"
                  ? "READY_FOR_REVIEW"
                  : null;
        if (registrationStatus !== null) {
          await this.client.registrationDraft.updateMany({
            where,
            data: {
              status: registrationStatus,
              reviewedAt: ["APPROVED", "APPLIED", "REJECTED"].includes(registrationStatus)
                ? new Date()
                : undefined,
            },
          });
        }
        return;
      }
      case "QUANTITY_TAKEOFF":
        await this.client.quantityTakeoffVersion.updateMany({ where, data: { status } });
        return;
      case "ESTIMATE":
        await this.client.estimateVersion.updateMany({ where, data: { status } });
        return;
      case "SCHEDULE":
        await this.client.scheduleVersion.updateMany({ where, data: { status } });
        return;
      case "BASELINE":
        await this.client.baselineVersion.updateMany({ where, data: { status } });
        return;
      case "DAILY_WORK_PLAN":
        await this.client.dailyWorkPlan.updateMany({ where, data: { status } });
        return;
      case "DAILY_REPORT":
        await this.client.dailyReport.updateMany({ where, data: { status } });
        return;
      case "PROGRESS_VERIFICATION":
        await this.client.progressVerification.updateMany({ where, data: { status } });
        return;
      case "RECOVERY_SCENARIO":
        await this.client.recoveryScenario.updateMany({ where, data: { status } });
        return;
    }
  }

  async materializeAppliedVersion(
    tenantId: string,
    projectId: string,
    version: Phase9VersionSnapshotRecord,
    appliedAt: string,
  ) {
    if (version.targetType === "REGISTRATION_DRAFT") {
      const update = projectUpdateExtractionSchema.parse(version.content.structuredData);
      const workItem =
        update.workItemCode === null
          ? null
          : await this.client.workItem.findFirst({
              where: { tenantId, projectId, code: update.workItemCode },
            });
      if (update.workItemCode !== null && workItem === null) {
        throw new Phase9ApiError(
          "RESOURCE_NOT_FOUND",
          404,
          `Work item ${update.workItemCode} was not found`,
        );
      }
      if (workItem !== null) {
        await this.client.workItem.update({
          where: { id: workItem.id },
          data: {
            name: update.workItemName ?? undefined,
            status: update.status ?? undefined,
            priority: update.priority ?? undefined,
            progressPercent: update.progressPercent ?? undefined,
            plannedStart:
              update.plannedStartDate === null
                ? undefined
                : new Date(`${update.plannedStartDate}T00:00:00.000Z`),
            plannedEnd:
              update.plannedEndDate === null
                ? undefined
                : new Date(`${update.plannedEndDate}T00:00:00.000Z`),
            actualStart:
              update.actualStartDate === null
                ? undefined
                : new Date(`${update.actualStartDate}T00:00:00.000Z`),
            actualEnd:
              update.actualEndDate === null
                ? undefined
                : new Date(`${update.actualEndDate}T00:00:00.000Z`),
            budget: update.budgetMnt ?? undefined,
            actualCost: update.actualCostMnt ?? undefined,
          },
        });
        if (update.predecessorWorkItemCode !== null) {
          const predecessor = await this.client.workItem.findFirst({
            where: { tenantId, projectId, code: update.predecessorWorkItemCode },
          });
          if (predecessor === null) {
            throw new Phase9ApiError(
              "RESOURCE_NOT_FOUND",
              404,
              `Predecessor ${update.predecessorWorkItemCode} was not found`,
            );
          }
          const existing = await this.client.workItemDependency.findFirst({
            where: { tenantId, projectId, predecessorId: predecessor.id, successorId: workItem.id },
          });
          if (existing === null) {
            await this.client.workItemDependency.create({
              data: {
                id: randomUUID(),
                tenantId,
                projectId,
                predecessorId: predecessor.id,
                successorId: workItem.id,
                type: "FINISH_TO_START",
                lagDays: 0,
              },
            });
          }
        }
      } else {
        await this.client.project.updateMany({
          where: { id: projectId, tenantId },
          data: {
            budget: update.budgetMnt ?? undefined,
            actualCost: update.actualCostMnt ?? undefined,
          },
        });
      }
      return;
    }
    if (version.targetType !== "BASELINE") return;

    const baseline = await this.client.baselineVersion.findFirst({
      where: { id: version.id, tenantId, projectId },
      include: {
        estimateVersion: { include: { lines: true } },
        scheduleVersion: { include: { activities: true } },
      },
    });
    if (baseline === null) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Applied baseline was not found");
    }

    const dependencies = await this.client.scheduleDependency.findMany({
      where: { tenantId, projectId, scheduleVersionId: baseline.scheduleVersionId },
    });
    const estimateByCode = new Map(
      baseline.estimateVersion.lines.map((line) => [line.lineCode, line]),
    );
    const workItemIdByActivityId = new Map<string, string>();

    for (const activity of baseline.scheduleVersion.activities) {
      const estimate = estimateByCode.get(activity.code);
      const workItem = await this.client.workItem.upsert({
        where: { projectId_code: { projectId, code: activity.code } },
        create: {
          id: randomUUID(),
          tenantId,
          projectId,
          code: activity.code,
          name: activity.name,
          description: `Baseline version ${baseline.versionNumber}`,
          status: "PLANNED",
          priority: "MEDIUM",
          plannedStart: activity.plannedStart,
          plannedEnd: activity.plannedFinish,
          progressPercent: 0,
          budget: estimate?.amount ?? new Prisma.Decimal(0),
          actualCost: new Prisma.Decimal(0),
          isCritical: activity.isCritical,
        },
        update: {
          name: activity.name,
          description: `Baseline version ${baseline.versionNumber}`,
          plannedStart: activity.plannedStart,
          plannedEnd: activity.plannedFinish,
          budget: estimate?.amount ?? new Prisma.Decimal(0),
          isCritical: activity.isCritical,
        },
      });
      workItemIdByActivityId.set(activity.id, workItem.id);
      await this.client.scheduleActivity.update({
        where: { id: activity.id },
        data: { workItemId: workItem.id },
      });
    }

    await this.client.workItemDependency.deleteMany({ where: { tenantId, projectId } });
    const operationalDependencies = dependencies.flatMap((dependency) => {
      const predecessorId = workItemIdByActivityId.get(dependency.predecessorId);
      const successorId = workItemIdByActivityId.get(dependency.successorId);
      if (predecessorId === undefined || successorId === undefined) return [];
      return [
        {
          id: randomUUID(),
          tenantId,
          projectId,
          predecessorId,
          successorId,
          type: dependency.type,
          lagDays: Math.trunc(dependency.lagMinutes / (8 * 60)),
        },
      ];
    });
    if (operationalDependencies.length > 0) {
      await this.client.workItemDependency.createMany({ data: operationalDependencies });
    }

    const initialPlan = await this.client.dailyWorkPlan.findFirst({
      where: { tenantId, projectId, baselineVersionId: baseline.id },
    });
    if (initialPlan === null) {
      const planId = randomUUID();
      const planDate = baseline.scheduleVersion.plannedStart;
      const planActivities = [...baseline.scheduleVersion.activities]
        .sort(
          (left, right) =>
            left.plannedStart.getTime() - right.plannedStart.getTime() ||
            left.code.localeCompare(right.code),
        )
        .filter((activity) => activity.plannedStart.getTime() <= planDate.getTime())
        .slice(0, 50);
      const selectedActivities =
        planActivities.length > 0
          ? planActivities
          : [...baseline.scheduleVersion.activities]
              .sort((left, right) => left.plannedStart.getTime() - right.plannedStart.getTime())
              .slice(0, 1);
      const sourceHash = createHash("sha256")
        .update(
          JSON.stringify({
            baselineVersionId: baseline.id,
            planDate: planDate.toISOString().slice(0, 10),
            activityIds: selectedActivities.map((activity) => activity.id),
          }),
        )
        .digest("hex");
      await this.client.dailyWorkPlan.create({
        data: {
          id: planId,
          tenantId,
          projectId,
          planDate,
          timezone: baseline.scheduleVersion.timezone,
          status: "REVIEW_REQUIRED",
          baselineVersionId: baseline.id,
          scheduleVersionId: baseline.scheduleVersionId,
          sourceHash,
          idempotencyKey: `baseline:${baseline.id}:initial-plan`,
          createdByUserId: baseline.createdByUserId,
          items: {
            create: selectedActivities.map((activity, index) => {
              const estimate = estimateByCode.get(activity.code);
              return {
                id: randomUUID(),
                workItemId: workItemIdByActivityId.get(activity.id)!,
                activityId: activity.id,
                sequence: index + 1,
                plannedQuantity: estimate?.quantity ?? new Prisma.Decimal(0),
                unit: estimate?.unit ?? "item",
                plannedStart: activity.plannedStart,
                plannedFinish: activity.plannedFinish,
                decisionReason: "Initial deterministic plan from the applied baseline",
              };
            }),
          },
        },
      });
      await this.client.reviewTask.create({
        data: {
          id: randomUUID(),
          tenantId,
          projectId,
          targetType: "DAILY_WORK_PLAN",
          targetId: planId,
          targetVersion: 1,
          status: "REVIEW_REQUIRED",
          sourceHash,
          createdByUserId: baseline.createdByUserId,
          assignedRole: "PROJECT_MANAGER",
          rowVersion: 1,
        },
      });
    }

    await this.client.baselineVersion.update({
      where: { id: baseline.id },
      data: { appliedAt: new Date(appliedAt) },
    });
    await this.client.project.updateMany({
      where: { id: projectId, tenantId, status: "PLANNED" },
      data: { status: "ACTIVE" },
    });
  }

  async getLatestForecast(tenantId: string, projectId: string, asOf: string) {
    const value = await this.client.forecastSnapshot.findFirst({
      where: { tenantId, projectId, asOf: { lte: new Date(asOf) } },
      orderBy: [{ asOf: "desc" }, { id: "asc" }],
      include: { drivers: { orderBy: { contribution: "desc" } } },
    });
    if (value === null) return null;
    const result: Phase9ForecastQueryRecord = {
      id: value.id,
      tenantId: value.tenantId,
      projectId: value.projectId,
      asOf: value.asOf.toISOString(),
      status: value.status,
      projectedFinish: iso(value.projectedFinish),
      delayDays: value.delayDays?.toString() ?? null,
      confidence: value.confidence?.toString() ?? null,
      methodVersion: value.methodVersion,
      thresholdVersion: value.thresholdVersion,
      sourceHash: value.sourceHash,
      drivers: value.drivers.map(plainRecord),
    };
    return result;
  }

  async findIdempotency(tenantId: string, key: string) {
    const value = await this.client.idempotencyRecord.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    return value === null ? null : idempotencyRecord(value);
  }

  async createIdempotency(record: Phase9IdempotencyRecord) {
    await this.client.idempotencyRecord.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        projectId: record.projectId,
        key: record.key,
        route: record.route,
        requestHash: record.requestHash,
        responseStatus: record.responseStatus,
        responseBody: inputJson(record.responseBody),
        actorUserId: record.actorUserId,
        expiresAt: new Date(record.expiresAt),
        createdAt: new Date(record.createdAt),
      },
    });
  }

  async createAppliedCommand(record: Phase9AppliedCommandRecord) {
    await this.client.appliedCommand.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        projectId: record.projectId,
        reviewTaskId: record.reviewTaskId,
        idempotencyKey: record.idempotencyKey,
        commandType: record.commandType,
        targetType: record.targetType,
        targetId: record.targetId,
        targetVersion: record.targetVersion,
        expectedRowVersion: record.expectedRowVersion,
        sourceHash: record.sourceHash,
        requestHash: record.requestHash,
        resultHash: record.resultHash,
        result: inputJson(record.result),
        status: record.status,
        actorUserId: record.actorUserId,
        actorRole: record.actorRole,
        reason: record.reason,
        appliedAt: new Date(record.appliedAt),
      },
    });
  }

  async createReviewDecision(record: Phase9ReviewDecisionRecord) {
    await this.client.reviewDecision.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        projectId: record.projectId,
        reviewTaskId: record.reviewTaskId,
        decision: record.decision,
        fromStatus: record.fromStatus,
        toStatus: record.toStatus,
        actorUserId: record.actorUserId,
        actorRole: record.actorRole,
        reason: record.reason,
        emergencyOverride: record.emergencyOverride,
        sourceHash: record.sourceHash,
        decidedAt: new Date(record.decidedAt),
      },
    });
  }

  async createAudit(record: Phase9AuditRecord) {
    await this.client.auditLog.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        projectId: record.projectId,
        actorUserId: record.actorUserId,
        actorRole: record.actorRole,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        reason: record.reason,
        correlationId: record.correlationId,
        sourceVersion: record.sourceVersion,
        beforeHash: record.beforeHash,
        afterHash: record.afterHash,
        metadata: inputJson(record.metadata),
        occurredAt: new Date(record.occurredAt),
      },
    });
  }

  async listAudit(tenantId: string, projectId: string | null) {
    return (
      await this.client.auditLog.findMany({
        where: { tenantId, ...(projectId === null ? {} : { projectId }) },
      })
    ).map(auditRecord);
  }

  async createOutbox(record: Phase9OutboxRecord) {
    await this.client.outboxEvent.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        projectId: record.projectId,
        eventType: record.eventType,
        aggregateType: record.aggregateType,
        aggregateId: record.aggregateId,
        aggregateVersion: record.aggregateVersion,
        idempotencyKey: record.idempotencyKey,
        payload: inputJson(record.payload),
        headers: inputJson(record.headers),
        status: record.status,
        availableAt: new Date(record.availableAt),
        publishedAt: record.publishedAt === null ? null : new Date(record.publishedAt),
        retryCount: record.retryCount,
        lastErrorCode: record.lastErrorCode,
        lockedAt: record.lockedAt === null ? null : new Date(record.lockedAt),
        lockedBy: record.lockedBy,
        createdAt: new Date(record.createdAt),
      },
    });
  }

  async listDueOutbox(now: string, limit: number) {
    const staleLockCutoff = new Date(Date.parse(now) - 5 * 60_000);
    return (
      await this.client.outboxEvent.findMany({
        where: {
          status: { in: ["PENDING", "FAILED"] },
          availableAt: { lte: new Date(now) },
          OR: [{ lockedAt: null }, { lockedAt: { lte: staleLockCutoff } }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
      })
    ).map(outboxRecord);
  }

  async updateOutbox(record: Phase9OutboxRecord) {
    await this.client.outboxEvent.update({
      where: { id: record.id },
      data: {
        status: record.status,
        availableAt: new Date(record.availableAt),
        publishedAt: record.publishedAt === null ? null : new Date(record.publishedAt),
        retryCount: record.retryCount,
        lastErrorCode: record.lastErrorCode,
        lockedAt: record.lockedAt === null ? null : new Date(record.lockedAt),
        lockedBy: record.lockedBy,
      },
    });
  }

  async findConsumedEvent(consumer: string, idempotencyKey: string) {
    const value = await this.client.consumedEvent.findUnique({
      where: { consumer_idempotencyKey: { consumer, idempotencyKey } },
    });
    if (value === null) return null;
    const result: Phase9ConsumedEventRecord = {
      ...value,
      consumedAt: value.consumedAt.toISOString(),
    };
    return result;
  }

  async createConsumedEvent(record: Phase9ConsumedEventRecord) {
    await this.client.consumedEvent.create({
      data: { ...record, consumedAt: new Date(record.consumedAt) },
    });
  }

  async createNotification(record: Phase9NotificationRecord) {
    const existing = await this.client.notification.findFirst({
      where: {
        tenantId: record.tenantId,
        eventId: record.eventId,
        channel: record.channel,
        userId: record.userId,
      },
    });
    if (existing !== null) return;
    await this.client.notification.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        projectId: record.projectId,
        userId: record.userId,
        eventId: record.eventId,
        channel: record.channel,
        templateCode: record.templateCode,
        payload: inputJson(record.payload),
        status: record.status,
        sentAt: record.sentAt === null ? null : new Date(record.sentAt),
        createdAt: new Date(record.createdAt),
      },
    });
  }
}

export class PrismaPhase9Store implements Phase9Store {
  constructor(private readonly client: PrismaClient) {}

  transaction<T>(work: (transaction: Phase9StoreTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction(
      (transaction) => work(new PrismaPhase9StoreTransaction(transaction)),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 20_000,
      },
    );
  }

  read<T>(work: (transaction: Phase9StoreTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction((transaction) =>
      work(new PrismaPhase9StoreTransaction(transaction)),
    );
  }
}
