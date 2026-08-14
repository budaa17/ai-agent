import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Phase9ApiError } from "./contracts.js";
import { phase9Sha256 } from "./security.js";
import { requirePlatformPermission } from "./platform-authorization.js";
import type { PlatformAuthenticatedPrincipal } from "./platform-contracts.js";
import {
  platformSupportAccessDecisionSchema,
  platformSupportAccessDetailResponseSchema,
  platformSupportAccessListQuerySchema,
  platformSupportAccessListResponseSchema,
  platformSupportAccessMutationResponseSchema,
  platformSupportAccessRequestSchema,
  type PlatformSupportAccessDetailResponse,
  type PlatformSupportAccessEvent,
  type PlatformSupportAccessGrant,
  type PlatformSupportAccessListResponse,
  type PlatformSupportAccessMutationResponse,
} from "./platform-advanced-contracts.js";
import {
  isSupportAccessActive,
  type PlatformSupportAccessEventRecord,
  type PlatformSupportAccessGrantRecord,
  type PlatformSupportAccessStore,
} from "./platform-support-access-store.js";
import type { PlatformStore } from "./platform-store.js";
import { decodeKeysetCursor, encodeKeysetCursor, safeIdentifier } from "./platform-read-support.js";

/**
 * Phase 8 support diagnostic access.
 *
 * There is no silent impersonation. An operator requests a scoped, read-only,
 * masked window into one tenant; a *different* platform principal approves it;
 * it expires by clock rather than by anyone remembering to close it; and every
 * transition is audited. Approval is two-person both here and as a database
 * CHECK constraint, so neither layer alone is load-bearing.
 */

const TIMELINE_LIMIT = 200;

export interface PlatformSupportAccessActionMetadata {
  correlationId: string;
  idempotencyKey: string;
}

export interface PlatformSupportAccessServiceDependencies {
  grants: PlatformSupportAccessStore;
  audit: PlatformStore;
}

const timeCursorSchema = z
  .object({ at: z.string().datetime({ offset: true }), id: z.string().min(1).max(200) })
  .strict();

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (cursor === undefined) return null;
  const parsed = timeCursorSchema.safeParse(decodeKeysetCursor(cursor));
  if (!parsed.success) throw new Phase9ApiError("CURSOR_INVALID", 400, "Cursor is not valid");
  return { at: new Date(parsed.data.at), id: parsed.data.id };
}

function stateDigestInput(record: PlatformSupportAccessGrantRecord) {
  return {
    id: record.id,
    state: record.state,
    approvedById: record.approvedById,
    revokedById: record.revokedById,
    expiresAt: record.expiresAt,
    allowedOperations: record.allowedOperations,
    rowVersion: record.rowVersion,
  };
}

function principalRef(principalId: string | null, names: Map<string, string>) {
  if (principalId === null) return null;
  return { principalId, displayName: names.get(principalId) ?? null };
}

function toGrant(
  record: PlatformSupportAccessGrantRecord,
  names: Map<string, string>,
  asOf: Date,
): PlatformSupportAccessGrant {
  const expiresAt = Date.parse(record.expiresAt);
  const active = isSupportAccessActive(record, asOf);
  return {
    grantId: record.id,
    ticketReference: record.ticketReference,
    reason: record.reason,
    tenantId: record.tenantId,
    tenantName: record.tenantName,
    projectId: record.projectId,
    allowedOperations: record.allowedOperations,
    maskedOnly: true,
    // A stored APPROVED grant past its deadline reads as EXPIRED without any
    // background job having to rewrite it.
    state: record.state === "APPROVED" && !active ? "EXPIRED" : record.state,
    active,
    requestedBy: principalRef(record.requestedById, names)!,
    requestedAt: record.requestedAt,
    approvedBy: principalRef(record.approvedById, names),
    approvedAt: record.approvedAt,
    startsAt: record.startsAt,
    expiresAt: record.expiresAt,
    expiresInSeconds: Math.round((expiresAt - asOf.getTime()) / 1_000),
    decisionReason: record.decisionReason,
    revokedBy: principalRef(record.revokedById, names),
    revokedAt: record.revokedAt,
    useCount: record.useCount,
    lastUsedAt: record.lastUsedAt,
    detailHref: `/platform/support-access/${encodeURIComponent(record.id)}`,
    rowVersion: record.rowVersion,
  };
}

function toEvent(
  record: PlatformSupportAccessEventRecord,
  names: Map<string, string>,
): PlatformSupportAccessEvent {
  return {
    eventId: record.id,
    type: record.type,
    fromState: record.fromState,
    toState: record.toState,
    actor: principalRef(record.actorPrincipalId, names),
    actorRole: record.actorRole,
    reason: record.reason,
    correlationId: record.correlationId,
    occurredAt: record.occurredAt,
  };
}

function principalIdsOf(records: readonly PlatformSupportAccessGrantRecord[]): string[] {
  return records.flatMap((record) =>
    [record.requestedById, record.approvedById, record.revokedById].filter(
      (value): value is string => value !== null,
    ),
  );
}

type Decision = "APPROVE" | "DENY" | "REVOKE";

const auditAction: Readonly<Record<Decision | "REQUEST", string>> = {
  REQUEST: "PLATFORM_SUPPORT_ACCESS_REQUEST",
  APPROVE: "PLATFORM_SUPPORT_ACCESS_APPROVE",
  DENY: "PLATFORM_SUPPORT_ACCESS_DENY",
  REVOKE: "PLATFORM_SUPPORT_ACCESS_REVOKE",
};

export class PlatformSupportAccessService {
  private readonly grants: PlatformSupportAccessStore;
  private readonly audit: PlatformStore;

  constructor(
    dependencies: PlatformSupportAccessServiceDependencies,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => randomUUID(),
  ) {
    this.grants = dependencies.grants;
    this.audit = dependencies.audit;
  }

  async list(
    principal: PlatformAuthenticatedPrincipal,
    rawQuery: unknown,
  ): Promise<PlatformSupportAccessListResponse> {
    requirePlatformPermission(principal, "PLATFORM_AUDIT_READ");
    const query = platformSupportAccessListQuerySchema.parse(rawQuery);
    const asOf = new Date(this.now());
    const limit = query.limit ?? 25;
    const order = query.order ?? "DESC";
    const cursor = decodeCursor(query.cursor);
    const activeOnly = query.activeOnly === "true";

    const [rows, totals] = await Promise.all([
      this.grants.list(
        {
          limit: limit + 1,
          cursorAt: cursor?.at ?? null,
          cursorId: cursor?.id ?? null,
          order,
          state: query.state ?? null,
          activeOnly,
          tenantId: query.tenantId ?? null,
        },
        asOf,
      ),
      this.grants.totals(asOf),
    ]);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const names = await this.grants.displayNames(principalIdsOf(page));
    const last = page.at(-1);

    return platformSupportAccessListResponseSchema.parse({
      schemaVersion: "platform-support-access.v1",
      generatedAt: asOf.toISOString(),
      asOf: asOf.toISOString(),
      partial: false,
      problems: [],
      filters: {
        state: query.state ?? null,
        activeOnly,
        tenantId: query.tenantId ?? null,
      },
      page: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodeKeysetCursor({ at: last.requestedAt, id: last.id })
            : null,
        sort: "REQUESTED_AT",
        order,
      },
      totals,
      items: page.map((record) => toGrant(record, names, asOf)),
    });
  }

  async detail(
    principal: PlatformAuthenticatedPrincipal,
    rawGrantId: unknown,
  ): Promise<PlatformSupportAccessDetailResponse> {
    requirePlatformPermission(principal, "PLATFORM_AUDIT_READ");
    const grantId = this.parseId(rawGrantId);
    const asOf = new Date(this.now());
    const record = await this.grants.findById(grantId);
    if (record === null) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Support access grant not found");
    }
    const timeline = await this.grants.events(grantId, TIMELINE_LIMIT);
    const names = await this.grants.displayNames([
      ...principalIdsOf([record]),
      ...timeline.items
        .map((event) => event.actorPrincipalId)
        .filter((value): value is string => value !== null),
    ]);
    const canGrant = this.canGrant(principal);
    // The requester can never be the approver, so the console hides an action
    // the server would refuse anyway.
    const canApprove = canGrant && record.requestedById !== principal.principalId;
    const allowedActions: Decision[] = [];
    if (record.state === "REQUESTED") {
      if (canApprove) allowedActions.push("APPROVE");
      if (canGrant) allowedActions.push("DENY");
    }
    if (record.state === "APPROVED" && isSupportAccessActive(record, asOf) && canGrant) {
      allowedActions.push("REVOKE");
    }

    return platformSupportAccessDetailResponseSchema.parse({
      schemaVersion: "platform-support-access-detail.v1",
      generatedAt: asOf.toISOString(),
      asOf: asOf.toISOString(),
      partial: false,
      problems: [],
      grant: toGrant(record, names, asOf),
      timeline: {
        total: timeline.total,
        truncated: timeline.total > timeline.items.length,
        items: timeline.items.map((event) => toEvent(event, names)),
      },
      allowedActions,
      canApprove,
    });
  }

  async request(
    principal: PlatformAuthenticatedPrincipal,
    rawBody: unknown,
    action: PlatformSupportAccessActionMetadata,
  ): Promise<PlatformSupportAccessMutationResponse> {
    const correlationId = safeIdentifier(action.correlationId) ?? "platform-support-access";
    try {
      requirePlatformPermission(principal, "PLATFORM_SUPPORT_ACCESS_GRANT");
    } catch (error) {
      await this.writeAudit({
        principal,
        action: auditAction.REQUEST,
        grantId: "pending",
        tenantId: null,
        result: "DENIED",
        reason: "Missing PLATFORM_SUPPORT_ACCESS_GRANT",
        correlationId,
        beforeHash: null,
        afterHash: null,
        metadata: { idempotencyKey: action.idempotencyKey },
      });
      throw error;
    }

    const body = platformSupportAccessRequestSchema.parse(rawBody);
    if (!(await this.grants.tenantExists(body.tenantId))) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Tenant not found");
    }

    const at = new Date(this.now());
    const record: PlatformSupportAccessGrantRecord = {
      id: this.newId(),
      ticketReference: body.ticketReference,
      reason: body.reason,
      tenantId: body.tenantId,
      tenantName: null,
      projectId: body.projectId ?? null,
      allowedOperations: [...new Set(body.allowedOperations)],
      maskedOnly: true,
      state: "REQUESTED",
      requestedById: principal.principalId,
      requestedAt: at.toISOString(),
      approvedById: null,
      approvedAt: null,
      startsAt: null,
      expiresAt: new Date(at.getTime() + body.durationSeconds * 1_000).toISOString(),
      decisionReason: null,
      revokedById: null,
      revokedAt: null,
      useCount: 0,
      lastUsedAt: null,
      rowVersion: 1,
    };
    const event: PlatformSupportAccessEventRecord = {
      id: this.newId(),
      grantId: record.id,
      type: "REQUESTED",
      fromState: null,
      toState: "REQUESTED",
      actorPrincipalId: principal.principalId,
      actorRole: principal.platformRole,
      reason: body.reason,
      correlationId,
      idempotencyKey: action.idempotencyKey,
      metadata: {
        ticketReference: body.ticketReference,
        durationSeconds: body.durationSeconds,
        allowedOperations: record.allowedOperations,
      },
      occurredAt: at.toISOString(),
    };

    await this.grants.create(record, event);
    const afterHash = phase9Sha256(stateDigestInput(record));
    await this.writeAudit({
      principal,
      action: auditAction.REQUEST,
      grantId: record.id,
      tenantId: record.tenantId,
      result: "SUCCESS",
      reason: body.reason,
      correlationId,
      beforeHash: null,
      afterHash,
      metadata: {
        idempotencyKey: action.idempotencyKey,
        ticketReference: body.ticketReference,
        expiresAt: record.expiresAt,
      },
    });

    const names = await this.grants.displayNames(principalIdsOf([record]));
    return platformSupportAccessMutationResponseSchema.parse({
      schemaVersion: "platform-support-access-mutation.v1",
      generatedAt: at.toISOString(),
      asOf: at.toISOString(),
      partial: false,
      problems: [],
      grant: toGrant(record, names, at),
      event: toEvent(event, names),
      change: {
        beforeHash: phase9Sha256({ state: "NONE" }),
        afterHash,
        summary: `support access requested for ${record.tenantId}`,
        idempotent: false,
        correlationId,
      },
    });
  }

  async approve(
    principal: PlatformAuthenticatedPrincipal,
    rawGrantId: unknown,
    rawBody: unknown,
    action: PlatformSupportAccessActionMetadata,
  ) {
    return this.decide("APPROVE", principal, rawGrantId, rawBody, action);
  }

  async deny(
    principal: PlatformAuthenticatedPrincipal,
    rawGrantId: unknown,
    rawBody: unknown,
    action: PlatformSupportAccessActionMetadata,
  ) {
    return this.decide("DENY", principal, rawGrantId, rawBody, action);
  }

  async revoke(
    principal: PlatformAuthenticatedPrincipal,
    rawGrantId: unknown,
    rawBody: unknown,
    action: PlatformSupportAccessActionMetadata,
  ) {
    return this.decide("REVOKE", principal, rawGrantId, rawBody, action);
  }

  private canGrant(principal: PlatformAuthenticatedPrincipal): boolean {
    try {
      requirePlatformPermission(principal, "PLATFORM_SUPPORT_ACCESS_GRANT");
      return true;
    } catch {
      return false;
    }
  }

  private parseId(value: unknown): string {
    const parsed = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/)
      .safeParse(value);
    if (!parsed.success) {
      throw new Phase9ApiError("VALIDATION_FAILED", 400, "Grant id is not valid");
    }
    return parsed.data;
  }

  private async decide(
    decision: Decision,
    principal: PlatformAuthenticatedPrincipal,
    rawGrantId: unknown,
    rawBody: unknown,
    action: PlatformSupportAccessActionMetadata,
  ): Promise<PlatformSupportAccessMutationResponse> {
    const grantId = this.parseId(rawGrantId);
    const correlationId = safeIdentifier(action.correlationId) ?? "platform-support-access";

    try {
      requirePlatformPermission(principal, "PLATFORM_SUPPORT_ACCESS_GRANT");
    } catch (error) {
      await this.writeAudit({
        principal,
        action: auditAction[decision],
        grantId,
        tenantId: null,
        result: "DENIED",
        reason: "Missing PLATFORM_SUPPORT_ACCESS_GRANT",
        correlationId,
        beforeHash: null,
        afterHash: null,
        metadata: { idempotencyKey: action.idempotencyKey },
      });
      throw error;
    }

    const body = platformSupportAccessDecisionSchema.parse(rawBody);
    const existing = await this.grants.findById(grantId);
    if (existing === null) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Support access grant not found");
    }

    const replayed = await this.grants.findEventByIdempotencyKey(grantId, action.idempotencyKey);
    if (replayed !== null) {
      const asOf = new Date(this.now());
      const names = await this.grants.displayNames([
        ...principalIdsOf([existing]),
        ...(replayed.actorPrincipalId === null ? [] : [replayed.actorPrincipalId]),
      ]);
      const hash = phase9Sha256(stateDigestInput(existing));
      return platformSupportAccessMutationResponseSchema.parse({
        schemaVersion: "platform-support-access-mutation.v1",
        generatedAt: asOf.toISOString(),
        asOf: asOf.toISOString(),
        partial: false,
        problems: [],
        grant: toGrant(existing, names, asOf),
        event: toEvent(replayed, names),
        change: {
          beforeHash: hash,
          afterHash: hash,
          summary: "Replayed a previously recorded decision.",
          idempotent: true,
          correlationId: replayed.correlationId,
        },
      });
    }

    if (existing.rowVersion !== body.rowVersion) {
      throw new Phase9ApiError(
        "OPTIMISTIC_LOCK_CONFLICT",
        409,
        "Grant changed since it was read; reload before retrying",
      );
    }

    const at = new Date(this.now());
    if (decision === "APPROVE" || decision === "DENY") {
      if (existing.state !== "REQUESTED") {
        throw new Phase9ApiError("VALIDATION_FAILED", 409, "Grant is no longer awaiting a decision");
      }
      if (decision === "APPROVE" && existing.requestedById === principal.principalId) {
        await this.writeAudit({
          principal,
          action: auditAction.APPROVE,
          grantId,
          tenantId: existing.tenantId,
          result: "DENIED",
          reason: "Two-person approval: the requester cannot approve their own grant",
          correlationId,
          beforeHash: phase9Sha256(stateDigestInput(existing)),
          afterHash: null,
          metadata: { idempotencyKey: action.idempotencyKey },
        });
        throw new Phase9ApiError(
          "SELF_APPROVAL_FORBIDDEN",
          403,
          "Support access approval requires a second platform principal",
        );
      }
      if (decision === "APPROVE" && Date.parse(existing.expiresAt) <= at.getTime()) {
        throw new Phase9ApiError(
          "VALIDATION_FAILED",
          409,
          "Grant window already elapsed; request a new one",
        );
      }
    }
    if (decision === "REVOKE" && !isSupportAccessActive(existing, at)) {
      throw new Phase9ApiError("VALIDATION_FAILED", 409, "Grant is not active");
    }

    const next: PlatformSupportAccessGrantRecord =
      decision === "APPROVE"
        ? {
            ...existing,
            state: "APPROVED",
            approvedById: principal.principalId,
            approvedAt: at.toISOString(),
            startsAt: at.toISOString(),
            decisionReason: body.reason,
            rowVersion: existing.rowVersion + 1,
          }
        : decision === "DENY"
          ? {
              ...existing,
              state: "DENIED",
              decisionReason: body.reason,
              rowVersion: existing.rowVersion + 1,
            }
          : {
              ...existing,
              state: "REVOKED",
              revokedById: principal.principalId,
              revokedAt: at.toISOString(),
              decisionReason: body.reason,
              rowVersion: existing.rowVersion + 1,
            };

    const event: PlatformSupportAccessEventRecord = {
      id: this.newId(),
      grantId,
      type: decision === "APPROVE" ? "APPROVED" : decision === "DENY" ? "DENIED" : "REVOKED",
      fromState: existing.state,
      toState: next.state,
      actorPrincipalId: principal.principalId,
      actorRole: principal.platformRole,
      reason: body.reason,
      correlationId,
      idempotencyKey: action.idempotencyKey,
      metadata: { decision },
      occurredAt: at.toISOString(),
    };

    const applied = await this.grants.apply(next, event, existing.rowVersion);
    if (!applied) {
      throw new Phase9ApiError(
        "OPTIMISTIC_LOCK_CONFLICT",
        409,
        "Grant changed since it was read; reload before retrying",
      );
    }

    const beforeHash = phase9Sha256(stateDigestInput(existing));
    const afterHash = phase9Sha256(stateDigestInput(next));
    const summary = `state ${existing.state} → ${next.state}`;
    await this.writeAudit({
      principal,
      action: auditAction[decision],
      grantId,
      tenantId: existing.tenantId,
      result: "SUCCESS",
      reason: body.reason,
      correlationId,
      beforeHash,
      afterHash,
      metadata: {
        idempotencyKey: action.idempotencyKey,
        ticketReference: existing.ticketReference,
        summary,
      },
    });

    const names = await this.grants.displayNames(principalIdsOf([next]));
    return platformSupportAccessMutationResponseSchema.parse({
      schemaVersion: "platform-support-access-mutation.v1",
      generatedAt: at.toISOString(),
      asOf: at.toISOString(),
      partial: false,
      problems: [],
      grant: toGrant(next, names, at),
      event: toEvent(event, names),
      change: { beforeHash, afterHash, summary, idempotent: false, correlationId },
    });
  }

  private async writeAudit(input: {
    principal: PlatformAuthenticatedPrincipal;
    action: string;
    grantId: string;
    tenantId: string | null;
    result: "SUCCESS" | "DENIED" | "FAILED";
    reason: string | null;
    correlationId: string;
    beforeHash: string | null;
    afterHash: string | null;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.audit.transaction(async (transaction) => {
      await transaction.createAudit({
        id: this.newId(),
        actorPrincipalId: input.principal.principalId,
        actorRole: input.principal.platformRole,
        tenantId: input.tenantId,
        action: input.action,
        entityType: "PLATFORM_SUPPORT_ACCESS",
        entityId: input.grantId,
        result: input.result,
        reason: input.reason,
        correlationId: input.correlationId,
        sourceVersion: "platform-support-access.v1",
        beforeHash: input.beforeHash,
        afterHash: input.afterHash,
        metadata: input.metadata,
        occurredAt: new Date(this.now()).toISOString(),
      });
    });
  }
}
