import { randomUUID } from "node:crypto";
import {
  Phase9ApiError,
  phase9IdentifierSchema,
  phase9ReviewDecisionRequestSchema,
  phase9ReviewDecisionResultSchema,
  type Phase9AuthenticatedPrincipal,
} from "./contracts.js";
import { effectiveProjectRole, requireProjectPermission } from "./authorization.js";
import { phase9Sha256 } from "./security.js";
import type {
  Phase9AuditRecord,
  Phase9IdempotencyRecord,
  Phase9OutboxRecord,
  Phase9ReviewDecisionRecord,
  Phase9Store,
} from "./store.js";

export class Phase9ReviewService {
  constructor(
    private readonly store: Phase9Store,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async decide(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    reviewTaskId: string,
    idempotencyKeyInput: string,
    input: unknown,
    correlationId: string,
  ) {
    const request = phase9ReviewDecisionRequestSchema.parse(input);
    const idempotencyKey = phase9IdentifierSchema.parse(idempotencyKeyInput);
    const requestHash = phase9Sha256({ projectId, reviewTaskId, request });
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
        "PROJECT_READ",
      );
      const existing = await transaction.findIdempotency(principal.tenantId, idempotencyKey);
      if (existing !== null) {
        if (
          existing.projectId !== projectId ||
          existing.route !== "REVIEW_DECISION" ||
          existing.requestHash !== requestHash
        ) {
          throw new Phase9ApiError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "Idempotency key was reused with different content",
          );
        }
        return phase9ReviewDecisionResultSchema.parse({
          ...existing.responseBody,
          status: "REPLAYED",
        });
      }
      const task = await transaction.getReviewTask(principal.tenantId, projectId, reviewTaskId);
      if (task === null) {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Review task not found");
      }
      if (task.status !== "REVIEW_REQUIRED") {
        throw new Phase9ApiError("REVIEW_NOT_APPROVED", 409, "Review task is not reviewable");
      }
      if (task.rowVersion !== request.expectedRowVersion) {
        throw new Phase9ApiError(
          "OPTIMISTIC_LOCK_CONFLICT",
          409,
          "Review task changed before decision",
        );
      }
      const effectiveRole = effectiveProjectRole(principal, membership?.role ?? null);
      const privileged = ["SUPER_ADMIN", "COMPANY_ADMIN"].includes(actorRole);
      if (
        effectiveRole !== task.assignedRole &&
        !(request.emergencyOverride && (privileged || actorRole === "PROJECT_MANAGER"))
      ) {
        throw new Phase9ApiError("AUTH_FORBIDDEN", 403, "Access denied");
      }
      if (
        task.assignedUserId !== null &&
        task.assignedUserId !== principal.userId &&
        !request.emergencyOverride
      ) {
        throw new Phase9ApiError("AUTH_FORBIDDEN", 403, "Access denied");
      }
      if (
        task.createdByUserId === principal.userId &&
        !(request.emergencyOverride && (privileged || actorRole === "PROJECT_MANAGER"))
      ) {
        throw new Phase9ApiError("SELF_APPROVAL_FORBIDDEN", 403, "Self approval is not allowed");
      }
      if (request.decision === "APPROVE" && ["ESTIMATE", "BASELINE"].includes(task.targetType)) {
        const target = await transaction.getVersionSnapshot(
          principal.tenantId,
          projectId,
          task.targetId,
        );
        if (target === null) {
          throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Review target not found");
        }
        const content = target.content as Record<string, unknown>;
        const dependencyIds =
          task.targetType === "ESTIMATE"
            ? [content.quantityVersionId]
            : [content.quantityVersionId, content.estimateVersionId, content.scheduleVersionId];
        for (const dependencyId of dependencyIds) {
          if (typeof dependencyId !== "string") {
            throw new Phase9ApiError(
              "REVIEW_NOT_APPROVED",
              409,
              "Review target is missing an upstream version",
            );
          }
          const dependency = await transaction.getVersionSnapshot(
            principal.tenantId,
            projectId,
            dependencyId,
          );
          if (dependency === null || !["APPROVED", "APPLIED"].includes(dependency.status)) {
            throw new Phase9ApiError(
              "REVIEW_NOT_APPROVED",
              409,
              "Upstream quantity, estimate, or schedule review must be approved first",
              { dependencyId },
            );
          }
        }
      }
      const decidedAt = this.now().toISOString();
      const decisionId = randomUUID();
      const eventId = randomUUID();
      const nextStatus = request.decision === "APPROVE" ? "APPROVED" : "REJECTED";
      const result = phase9ReviewDecisionResultSchema.parse({
        decisionId,
        reviewTaskId,
        status: nextStatus,
        rowVersion: task.rowVersion + 1,
        eventId,
        decidedAt,
      });
      const decisionHash = phase9Sha256({
        taskSourceHash: task.sourceHash,
        request,
        actorUserId: principal.userId,
      });
      const decision: Phase9ReviewDecisionRecord = {
        id: decisionId,
        tenantId: principal.tenantId,
        projectId,
        reviewTaskId,
        decision: request.decision,
        fromStatus: task.status,
        toStatus: nextStatus,
        actorUserId: principal.userId,
        actorRole,
        reason: request.reason,
        emergencyOverride: request.emergencyOverride,
        sourceHash: decisionHash,
        decidedAt,
      };
      const eventType = `REVIEW_TASK_${nextStatus}`;
      const audit: Phase9AuditRecord = {
        id: randomUUID(),
        tenantId: principal.tenantId,
        projectId,
        actorUserId: principal.userId,
        actorRole,
        action: eventType,
        entityType: "REVIEW_TASK",
        entityId: reviewTaskId,
        reason: request.reason,
        correlationId,
        sourceVersion: "buildwatch-v22-phase9-review-v1",
        beforeHash: task.sourceHash,
        afterHash: decisionHash,
        metadata: { emergencyOverride: request.emergencyOverride, targetType: task.targetType },
        occurredAt: decidedAt,
      };
      const outbox: Phase9OutboxRecord = {
        id: eventId,
        tenantId: principal.tenantId,
        projectId,
        eventType,
        aggregateType: "REVIEW_TASK",
        aggregateId: reviewTaskId,
        aggregateVersion: task.rowVersion + 1,
        idempotencyKey: `outbox:${principal.tenantId}:${idempotencyKey}`,
        payload: {
          decisionId,
          reviewTaskId,
          targetType: task.targetType,
          targetId: task.targetId,
          status: nextStatus,
        },
        headers: { correlationId, schemaVersion: 1 },
        status: "PENDING",
        availableAt: decidedAt,
        publishedAt: null,
        retryCount: 0,
        lastErrorCode: null,
        lockedAt: null,
        lockedBy: null,
        createdAt: decidedAt,
      };
      const idempotency: Phase9IdempotencyRecord = {
        id: randomUUID(),
        tenantId: principal.tenantId,
        projectId,
        key: idempotencyKey,
        route: "REVIEW_DECISION",
        requestHash,
        responseStatus: 200,
        responseBody: result,
        actorUserId: principal.userId,
        expiresAt: new Date(Date.parse(decidedAt) + 7 * 24 * 60 * 60_000).toISOString(),
        createdAt: decidedAt,
      };
      await transaction.updateReviewTask({
        ...task,
        status: nextStatus,
        rowVersion: task.rowVersion + 1,
      });
      // Deciding a review task is deciding the artefact it points at. Leaving
      // the artefact behind would strand it: apply requires an APPROVED
      // canonical version and nothing else in the system sets one.
      const canonical = await transaction.getVersionSnapshot(
        principal.tenantId,
        projectId,
        task.targetId,
      );
      if (canonical !== null && canonical.status !== nextStatus) {
        await transaction.updateVersionStatus(
          principal.tenantId,
          projectId,
          task.targetId,
          task.targetType,
          nextStatus,
        );
      }
      await transaction.createReviewDecision(decision);
      await transaction.createAudit(audit);
      await transaction.createOutbox(outbox);
      await transaction.createIdempotency(idempotency);
      return result;
    });
  }
}
