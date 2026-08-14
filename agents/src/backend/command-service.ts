import { randomUUID } from "node:crypto";
import {
  Phase9ApiError,
  phase9AppliedCommandResultSchema,
  phase9ApprovedCommandSchema,
  phase9IdentifierSchema,
  type Phase9AuthenticatedPrincipal,
  type Phase9Permission,
} from "./contracts.js";
import { requireProjectPermission } from "./authorization.js";
import { phase9Sha256 } from "./security.js";
import type {
  Phase9AppliedCommandRecord,
  Phase9AuditRecord,
  Phase9IdempotencyRecord,
  Phase9OutboxRecord,
  Phase9Store,
} from "./store.js";

const targetPermission: Readonly<
  Record<ReturnType<typeof phase9ApprovedCommandSchema.parse>["targetType"], Phase9Permission>
> = {
  REGISTRATION_DRAFT: "REPORT_APPROVE",
  QUANTITY_TAKEOFF: "DESIGN_APPROVE",
  ESTIMATE: "ESTIMATE_APPROVE",
  SCHEDULE: "DESIGN_APPROVE",
  BASELINE: "COMMAND_APPLY",
  DAILY_WORK_PLAN: "PLAN_APPROVE",
  DAILY_REPORT: "REPORT_APPROVE",
  PROGRESS_VERIFICATION: "VERIFICATION_APPROVE",
  RECOVERY_SCENARIO: "COMMAND_APPLY",
};

const targetEvent: Readonly<
  Record<ReturnType<typeof phase9ApprovedCommandSchema.parse>["targetType"], string>
> = {
  REGISTRATION_DRAFT: "REGISTRATION_DRAFT_APPLIED",
  QUANTITY_TAKEOFF: "QUANTITY_TAKEOFF_APPLIED",
  ESTIMATE: "ESTIMATE_APPLIED",
  SCHEDULE: "SCHEDULE_APPLIED",
  BASELINE: "BASELINE_APPLIED",
  DAILY_WORK_PLAN: "DAILY_WORK_PLAN_APPLIED",
  DAILY_REPORT: "PROJECT_EXECUTION_APPROVED",
  PROGRESS_VERIFICATION: "PROGRESS_VERIFICATION_APPLIED",
  RECOVERY_SCENARIO: "RECOVERY_SCENARIO_APPLIED",
};

export class Phase9ApprovedCommandService {
  constructor(
    private readonly store: Phase9Store,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async apply(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    idempotencyKeyInput: string,
    input: unknown,
    correlationId: string,
  ) {
    const command = phase9ApprovedCommandSchema.parse(input);
    const idempotencyKey = phase9IdentifierSchema.parse(idempotencyKeyInput);
    const requestHash = phase9Sha256({ projectId, command });
    return this.store.transaction(async (transaction) => {
      const [project, membership] = await Promise.all([
        transaction.getProject(principal.tenantId, projectId),
        transaction.findMembership(principal.tenantId, projectId, principal.userId),
      ]);
      if (project === null) {
        throw new Phase9ApiError("PROJECT_NOT_FOUND", 404, "Project not found");
      }
      const actorRole = requireProjectPermission(
        principal,
        membership?.role ?? null,
        targetPermission[command.targetType],
      );
      requireProjectPermission(principal, membership?.role ?? null, "COMMAND_APPLY");
      const existing = await transaction.findIdempotency(principal.tenantId, idempotencyKey);
      if (existing !== null) {
        if (
          existing.projectId !== projectId ||
          existing.route !== "APPLY_APPROVED_ARTIFACT" ||
          existing.requestHash !== requestHash
        ) {
          throw new Phase9ApiError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "Idempotency key was reused with different content",
          );
        }
        return phase9AppliedCommandResultSchema.parse({
          ...existing.responseBody,
          status: "REPLAYED",
        });
      }
      const task = await transaction.getReviewTask(
        principal.tenantId,
        projectId,
        command.reviewTaskId,
      );
      if (
        task === null ||
        task.targetType !== command.targetType ||
        task.targetId !== command.targetId ||
        task.targetVersion !== command.targetVersion
      ) {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Review task not found");
      }
      if (task.status !== "APPROVED") {
        throw new Phase9ApiError("REVIEW_NOT_APPROVED", 409, "Review task is not approved");
      }
      if (task.createdByUserId === principal.userId) {
        throw new Phase9ApiError("SELF_APPROVAL_FORBIDDEN", 403, "Self approval is not allowed");
      }
      if (task.assignedUserId !== null && task.assignedUserId !== principal.userId) {
        throw new Phase9ApiError("AUTH_FORBIDDEN", 403, "Access denied");
      }
      if (
        task.sourceHash !== command.sourceHash ||
        task.rowVersion !== command.expectedRowVersion
      ) {
        throw new Phase9ApiError(
          "OPTIMISTIC_LOCK_CONFLICT",
          409,
          "Approved version changed before apply",
        );
      }
      const approvedVersion = await transaction.getVersionSnapshot(
        principal.tenantId,
        projectId,
        command.targetId,
      );
      if (
        approvedVersion === null ||
        approvedVersion.targetType !== command.targetType ||
        approvedVersion.versionNumber !== command.targetVersion ||
        approvedVersion.status !== "APPROVED" ||
        approvedVersion.sourceHash !== command.sourceHash
      ) {
        throw new Phase9ApiError(
          "IMMUTABLE_VERSION",
          409,
          "Approved canonical version does not match the command",
        );
      }

      const appliedAt = this.now().toISOString();
      const commandId = randomUUID();
      const eventId = randomUUID();
      const auditId = randomUUID();
      const result = phase9AppliedCommandResultSchema.parse({
        commandId,
        idempotencyKey,
        status: "APPLIED",
        targetType: command.targetType,
        targetId: command.targetId,
        targetVersion: command.targetVersion,
        eventId,
        auditId,
        appliedAt,
      });
      const resultHash = phase9Sha256(result);
      const appliedRecord: Phase9AppliedCommandRecord = {
        id: commandId,
        tenantId: principal.tenantId,
        projectId,
        reviewTaskId: task.id,
        idempotencyKey,
        commandType: command.commandType,
        targetType: command.targetType,
        targetId: command.targetId,
        targetVersion: command.targetVersion,
        expectedRowVersion: command.expectedRowVersion,
        sourceHash: command.sourceHash,
        requestHash,
        resultHash,
        result,
        status: "APPLIED",
        actorUserId: principal.userId,
        actorRole,
        reason: command.reason,
        appliedAt,
      };
      const audit: Phase9AuditRecord = {
        id: auditId,
        tenantId: principal.tenantId,
        projectId,
        actorUserId: principal.userId,
        actorRole,
        action: targetEvent[command.targetType],
        entityType: command.targetType,
        entityId: command.targetId,
        reason: command.reason,
        correlationId,
        sourceVersion: "buildwatch-v22-phase9-command-v1",
        beforeHash: task.sourceHash,
        afterHash: resultHash,
        metadata: {
          reviewTaskId: task.id,
          targetVersion: command.targetVersion,
          idempotencyKey,
        },
        occurredAt: appliedAt,
      };
      const outbox: Phase9OutboxRecord = {
        id: eventId,
        tenantId: principal.tenantId,
        projectId,
        eventType: targetEvent[command.targetType],
        aggregateType: command.targetType,
        aggregateId: command.targetId,
        aggregateVersion: command.targetVersion,
        idempotencyKey: `outbox:${principal.tenantId}:${idempotencyKey}`,
        payload: {
          commandId,
          reviewTaskId: task.id,
          targetId: command.targetId,
          targetVersion: command.targetVersion,
          sourceHash: command.sourceHash,
          canonicalContent: approvedVersion.content,
        },
        headers: {
          correlationId,
          actorUserId: principal.userId,
          schemaVersion: 1,
        },
        status: "PENDING",
        availableAt: appliedAt,
        publishedAt: null,
        retryCount: 0,
        lastErrorCode: null,
        lockedAt: null,
        lockedBy: null,
        createdAt: appliedAt,
      };
      const idempotency: Phase9IdempotencyRecord = {
        id: randomUUID(),
        tenantId: principal.tenantId,
        projectId,
        key: idempotencyKey,
        route: "APPLY_APPROVED_ARTIFACT",
        requestHash,
        responseStatus: 201,
        responseBody: result,
        actorUserId: principal.userId,
        expiresAt: new Date(Date.parse(appliedAt) + 7 * 24 * 60 * 60_000).toISOString(),
        createdAt: appliedAt,
      };
      await transaction.updateReviewTask({
        ...task,
        status: "APPLIED",
        rowVersion: task.rowVersion + 1,
      });
      // Mirror of the approval step: the artefact moves with its review task,
      // so a version that has been applied reads as APPLIED everywhere.
      await transaction.updateVersionStatus(
        principal.tenantId,
        projectId,
        command.targetId,
        command.targetType,
        "APPLIED",
      );
      await transaction.materializeAppliedVersion(
        principal.tenantId,
        projectId,
        approvedVersion,
        appliedAt,
      );
      await transaction.createAppliedCommand(appliedRecord);
      await transaction.createAudit(audit);
      await transaction.createOutbox(outbox);
      await transaction.createIdempotency(idempotency);
      return result;
    });
  }
}
