import { randomUUID } from "node:crypto";
import { Phase9ApiError } from "./contracts.js";
import { phase9Sha256, verifyPhase9Password } from "./security.js";
import { requirePlatformPermission } from "./platform-authorization.js";
import type { PlatformAuthenticatedPrincipal } from "./platform-contracts.js";
import {
  platformIncidentAcknowledgeRequestSchema,
  platformIncidentAssignRequestSchema,
  platformIncidentDetailResponseSchema,
  platformIncidentListQuerySchema,
  platformIncidentListResponseSchema,
  platformIncidentMutationResponseSchema,
  platformIncidentResolveRequestSchema,
  type PlatformIncident,
  type PlatformIncidentDetailResponse,
  type PlatformIncidentEvent,
  type PlatformIncidentListResponse,
  type PlatformIncidentMutationResponse,
} from "./platform-incident-contracts.js";
import {
  isActiveIncidentState,
  type PlatformIncidentEventRecord,
  type PlatformIncidentRecord,
  type PlatformIncidentStore,
} from "./platform-incident-store.js";
import type { PlatformStore } from "./platform-store.js";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  safeIdentifier,
} from "./platform-read-support.js";
import { z } from "zod";

/**
 * Phase 6 operator surface. Every mutation is permission-checked, reason-bearing,
 * optimistically locked, idempotent on retry and written to the platform audit
 * trail in the same call. Resolving a CRITICAL or HIGH incident additionally
 * requires a password re-entry, so the highest-impact transition cannot be made
 * by a walk-up on an unlocked screen.
 */

const TIMELINE_LIMIT = 200;
const STEP_UP_SEVERITIES = new Set(["CRITICAL", "HIGH"]);

export interface PlatformIncidentActionMetadata {
  correlationId: string;
  idempotencyKey: string;
}

export interface PlatformIncidentCredentialVerifier {
  /** Returns the stored password hash for a principal, or null when absent. */
  passwordHash(principalId: string): Promise<string | null>;
}

export interface PlatformIncidentServiceDependencies {
  incidents: PlatformIncidentStore;
  audit: PlatformStore;
  credentials: PlatformIncidentCredentialVerifier;
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

/** The canonical shape hashed for before/after evidence in the audit trail. */
function stateDigestInput(record: PlatformIncidentRecord) {
  return {
    id: record.id,
    state: record.state,
    severity: record.severity,
    acknowledgedById: record.acknowledgedById,
    assignedToId: record.assignedToId,
    resolvedById: record.resolvedById,
    resolutionNote: record.resolutionNote,
    reopenCount: record.reopenCount,
    rowVersion: record.rowVersion,
  };
}

function principalRef(
  principalId: string | null,
  names: Map<string, string>,
): PlatformIncident["acknowledgedBy"] {
  if (principalId === null) return null;
  return { principalId, displayName: names.get(principalId) ?? null };
}

function toIncident(record: PlatformIncidentRecord, names: Map<string, string>): PlatformIncident {
  return {
    incidentId: record.id,
    signalId: record.signalId,
    ruleKey: record.ruleKey,
    ruleVersion: record.ruleVersion,
    severity: record.severity,
    state: record.state,
    active: isActiveIncidentState(record.state),
    title: record.title,
    impact: record.impact,
    recommendedAction: record.recommendedAction,
    scope: {
      tenantId: record.tenantId,
      tenantName: record.tenantName,
      agentType: record.agentType,
      component: record.component,
    },
    diagnosticsHref: record.diagnosticsHref,
    detailHref: `/platform/incidents/${encodeURIComponent(record.id)}`,
    evidence: record.evidence,
    firstEvidenceAt: record.firstEvidenceAt,
    lastEvidenceAt: record.lastEvidenceAt,
    openedAt: record.openedAt,
    acknowledgedAt: record.acknowledgedAt,
    acknowledgedBy: principalRef(record.acknowledgedById, names),
    assignedAt: record.assignedAt,
    assignedTo: principalRef(record.assignedToId, names),
    resolvedAt: record.resolvedAt,
    resolvedBy: principalRef(record.resolvedById, names),
    resolutionNote: record.resolutionNote,
    autoResolved: record.autoResolvedAt !== null,
    reopenCount: record.reopenCount,
    rowVersion: record.rowVersion,
  };
}

function toEvent(
  record: PlatformIncidentEventRecord,
  names: Map<string, string>,
): PlatformIncidentEvent {
  return {
    eventId: record.id,
    type: record.type,
    fromState: record.fromState,
    toState: record.toState,
    actor: principalRef(record.actorPrincipalId, names),
    actorRole: record.actorRole,
    reason: record.reason,
    note: record.note,
    correlationId: record.correlationId,
    occurredAt: record.occurredAt,
  };
}

function principalIdsOf(records: readonly PlatformIncidentRecord[]): string[] {
  return records.flatMap((record) =>
    [record.acknowledgedById, record.assignedToId, record.resolvedById].filter(
      (value): value is string => value !== null,
    ),
  );
}

type MutationKind = "ACKNOWLEDGE" | "ASSIGN" | "RESOLVE";

const auditAction: Readonly<Record<MutationKind, string>> = {
  ACKNOWLEDGE: "PLATFORM_INCIDENT_ACKNOWLEDGE",
  ASSIGN: "PLATFORM_INCIDENT_ASSIGN",
  RESOLVE: "PLATFORM_INCIDENT_RESOLVE",
};

export class PlatformIncidentService {
  private readonly incidents: PlatformIncidentStore;
  private readonly audit: PlatformStore;
  private readonly credentials: PlatformIncidentCredentialVerifier;

  constructor(
    dependencies: PlatformIncidentServiceDependencies,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => randomUUID(),
  ) {
    this.incidents = dependencies.incidents;
    this.audit = dependencies.audit;
    this.credentials = dependencies.credentials;
  }

  async list(
    principal: PlatformAuthenticatedPrincipal,
    rawQuery: unknown,
  ): Promise<PlatformIncidentListResponse> {
    requirePlatformPermission(principal, "PLATFORM_OVERVIEW_READ");
    const query = platformIncidentListQuerySchema.parse(rawQuery);
    const limit = query.limit ?? 25;
    const order = query.order ?? "DESC";
    const cursor = decodeCursor(query.cursor);
    const activeOnly = query.activeOnly !== "false";

    const [rows, totals] = await Promise.all([
      this.incidents.list({
        limit: limit + 1,
        cursorAt: cursor?.at ?? null,
        cursorId: cursor?.id ?? null,
        order,
        state: query.state ?? null,
        activeOnly: query.state === undefined && activeOnly,
        severity: query.severity ?? null,
        tenantId: query.tenantId ?? null,
        agentType: query.agentType ?? null,
        assignedToId: query.assignedToId ?? null,
      }),
      this.incidents.totals(),
    ]);
    const generatedAt = new Date(this.now());
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const names = await this.incidents.displayNames(principalIdsOf(page));
    const last = page.at(-1);

    return platformIncidentListResponseSchema.parse({
      schemaVersion: "platform-incidents.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: generatedAt.toISOString(),
      partial: false,
      problems: [],
      filters: {
        state: query.state ?? null,
        activeOnly: query.state === undefined && activeOnly,
        severity: query.severity ?? null,
        tenantId: query.tenantId ?? null,
        agentType: query.agentType ?? null,
        assignedToId: query.assignedToId ?? null,
      },
      page: {
        limit,
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodeKeysetCursor({ at: last.openedAt, id: last.id })
            : null,
        sort: "OPENED_AT",
        order,
      },
      totals,
      items: page.map((record) => toIncident(record, names)),
    });
  }

  async detail(
    principal: PlatformAuthenticatedPrincipal,
    rawIncidentId: unknown,
  ): Promise<PlatformIncidentDetailResponse> {
    requirePlatformPermission(principal, "PLATFORM_OVERVIEW_READ");
    const incidentId = this.parseId(rawIncidentId);
    const record = await this.incidents.findById(incidentId);
    if (record === null) throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Incident not found");
    const timeline = await this.incidents.events(incidentId, TIMELINE_LIMIT);
    const names = await this.incidents.displayNames([
      ...principalIdsOf([record]),
      ...timeline.items
        .map((event) => event.actorPrincipalId)
        .filter((value): value is string => value !== null),
    ]);
    const generatedAt = new Date(this.now());
    const canManage = this.canManage(principal);
    const active = isActiveIncidentState(record.state);
    const allowedActions: ("ACKNOWLEDGE" | "ASSIGN" | "RESOLVE")[] = [];
    if (canManage && active) {
      if (record.state !== "ACKNOWLEDGED") allowedActions.push("ACKNOWLEDGE");
      allowedActions.push("ASSIGN", "RESOLVE");
    }

    return platformIncidentDetailResponseSchema.parse({
      schemaVersion: "platform-incident-detail.v1",
      generatedAt: generatedAt.toISOString(),
      asOf: generatedAt.toISOString(),
      partial: false,
      problems: [],
      incident: toIncident(record, names),
      timeline: {
        total: timeline.total,
        truncated: timeline.total > timeline.items.length,
        items: timeline.items.map((event) => toEvent(event, names)),
      },
      allowedActions,
      resolveRequiresStepUp: STEP_UP_SEVERITIES.has(record.severity),
    });
  }

  async acknowledge(
    principal: PlatformAuthenticatedPrincipal,
    rawIncidentId: unknown,
    rawBody: unknown,
    action: PlatformIncidentActionMetadata,
  ): Promise<PlatformIncidentMutationResponse> {
    const body = platformIncidentAcknowledgeRequestSchema.parse(rawBody);
    return this.mutate({
      kind: "ACKNOWLEDGE",
      principal,
      rawIncidentId,
      action,
      reason: body.reason,
      rowVersion: body.rowVersion,
      transition: (record, at) => ({
        next: {
          ...record,
          state: "ACKNOWLEDGED",
          acknowledgedAt: at.toISOString(),
          acknowledgedById: principal.principalId,
          rowVersion: record.rowVersion + 1,
        },
        eventType: "ACKNOWLEDGED",
        note: null,
        summary: `state ${record.state} → ACKNOWLEDGED`,
        metadata: {},
      }),
    });
  }

  async assign(
    principal: PlatformAuthenticatedPrincipal,
    rawIncidentId: unknown,
    rawBody: unknown,
    action: PlatformIncidentActionMetadata,
  ): Promise<PlatformIncidentMutationResponse> {
    const body = platformIncidentAssignRequestSchema.parse(rawBody);
    if (!(await this.incidents.principalExists(body.assigneePrincipalId))) {
      throw new Phase9ApiError("VALIDATION_FAILED", 400, "Assignee is not a platform principal");
    }
    return this.mutate({
      kind: "ASSIGN",
      principal,
      rawIncidentId,
      action,
      reason: body.reason,
      rowVersion: body.rowVersion,
      transition: (record, at) => ({
        next: {
          ...record,
          assignedToId: body.assigneePrincipalId,
          assignedAt: at.toISOString(),
          rowVersion: record.rowVersion + 1,
        },
        eventType: "ASSIGNED",
        note: null,
        summary: `owner ${record.assignedToId ?? "none"} → ${body.assigneePrincipalId}`,
        metadata: { assigneePrincipalId: body.assigneePrincipalId },
      }),
    });
  }

  async resolve(
    principal: PlatformAuthenticatedPrincipal,
    rawIncidentId: unknown,
    rawBody: unknown,
    action: PlatformIncidentActionMetadata,
  ): Promise<PlatformIncidentMutationResponse> {
    const body = platformIncidentResolveRequestSchema.parse(rawBody);
    return this.mutate({
      kind: "RESOLVE",
      principal,
      rawIncidentId,
      action,
      reason: body.reason,
      rowVersion: body.rowVersion,
      stepUpPassword: body.stepUpPassword,
      transition: (record, at) => ({
        next: {
          ...record,
          state: "RESOLVED",
          resolvedAt: at.toISOString(),
          resolvedById: principal.principalId,
          resolutionNote: body.resolutionNote,
          autoResolvedAt: null,
          rowVersion: record.rowVersion + 1,
        },
        eventType: "RESOLVED",
        note: body.resolutionNote,
        summary: `state ${record.state} → RESOLVED`,
        metadata: {},
      }),
    });
  }

  private canManage(principal: PlatformAuthenticatedPrincipal): boolean {
    try {
      requirePlatformPermission(principal, "PLATFORM_INCIDENT_MANAGE");
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
      throw new Phase9ApiError("VALIDATION_FAILED", 400, "Incident id is not valid");
    }
    return parsed.data;
  }

  private async mutate(input: {
    kind: MutationKind;
    principal: PlatformAuthenticatedPrincipal;
    rawIncidentId: unknown;
    action: PlatformIncidentActionMetadata;
    reason: string;
    rowVersion: number;
    stepUpPassword?: string | undefined;
    transition: (
      record: PlatformIncidentRecord,
      at: Date,
    ) => {
      next: PlatformIncidentRecord;
      eventType: PlatformIncidentEventRecord["type"];
      note: string | null;
      summary: string;
      metadata: Record<string, unknown>;
    };
  }): Promise<PlatformIncidentMutationResponse> {
    const { principal, action } = input;
    const incidentId = this.parseId(input.rawIncidentId);
    const correlationId = safeIdentifier(action.correlationId) ?? "platform-incident-action";

    try {
      requirePlatformPermission(principal, "PLATFORM_INCIDENT_MANAGE");
    } catch (error) {
      await this.writeAudit({
        principal,
        action: auditAction[input.kind],
        incidentId,
        tenantId: null,
        result: "DENIED",
        reason: "Missing PLATFORM_INCIDENT_MANAGE",
        correlationId,
        beforeHash: null,
        afterHash: null,
        metadata: { idempotencyKey: action.idempotencyKey },
      });
      throw error;
    }

    const existing = await this.incidents.findById(incidentId);
    if (existing === null) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Incident not found");
    }

    // A retried request replays the recorded event instead of appending a second
    // transition, so a flaky network cannot double-resolve an incident.
    const replayed = await this.incidents.findEventByIdempotencyKey(
      incidentId,
      action.idempotencyKey,
    );
    if (replayed !== null) {
      const names = await this.incidents.displayNames([
        ...principalIdsOf([existing]),
        ...(replayed.actorPrincipalId === null ? [] : [replayed.actorPrincipalId]),
      ]);
      return platformIncidentMutationResponseSchema.parse({
        schemaVersion: "platform-incident-mutation.v1",
        generatedAt: new Date(this.now()).toISOString(),
        asOf: new Date(this.now()).toISOString(),
        partial: false,
        problems: [],
        incident: toIncident(existing, names),
        event: toEvent(replayed, names),
        change: {
          beforeHash: phase9Sha256(stateDigestInput(existing)),
          afterHash: phase9Sha256(stateDigestInput(existing)),
          summary: "Replayed a previously recorded transition.",
          idempotent: true,
          correlationId: replayed.correlationId,
        },
      });
    }

    if (!isActiveIncidentState(existing.state)) {
      throw new Phase9ApiError(
        "VALIDATION_FAILED",
        409,
        "Incident is resolved; it reopens only when its signal fires again",
      );
    }
    if (existing.rowVersion !== input.rowVersion) {
      throw new Phase9ApiError(
        "OPTIMISTIC_LOCK_CONFLICT",
        409,
        "Incident changed since it was read; reload before retrying",
      );
    }

    if (input.kind === "RESOLVE" && STEP_UP_SEVERITIES.has(existing.severity)) {
      await this.requireStepUp(principal, input.stepUpPassword, {
        incidentId,
        correlationId,
        idempotencyKey: action.idempotencyKey,
        tenantId: existing.tenantId,
      });
    }

    const at = new Date(this.now());
    const { next, eventType, note, summary, metadata } = input.transition(existing, at);
    const event: PlatformIncidentEventRecord = {
      id: this.newId(),
      incidentId,
      type: eventType,
      fromState: existing.state,
      toState: next.state,
      actorPrincipalId: principal.principalId,
      actorRole: principal.platformRole,
      reason: input.reason,
      note,
      correlationId,
      idempotencyKey: action.idempotencyKey,
      metadata: { ...metadata, action: input.kind },
      occurredAt: at.toISOString(),
    };

    const applied = await this.incidents.apply(next, event, existing.rowVersion);
    if (!applied) {
      throw new Phase9ApiError(
        "OPTIMISTIC_LOCK_CONFLICT",
        409,
        "Incident changed since it was read; reload before retrying",
      );
    }

    const beforeHash = phase9Sha256(stateDigestInput(existing));
    const afterHash = phase9Sha256(stateDigestInput(next));
    await this.writeAudit({
      principal,
      action: auditAction[input.kind],
      incidentId,
      tenantId: existing.tenantId,
      result: "SUCCESS",
      reason: input.reason,
      correlationId,
      beforeHash,
      afterHash,
      metadata: {
        idempotencyKey: action.idempotencyKey,
        ruleKey: existing.ruleKey,
        severity: existing.severity,
        summary,
      },
    });

    const names = await this.incidents.displayNames(principalIdsOf([next]));
    return platformIncidentMutationResponseSchema.parse({
      schemaVersion: "platform-incident-mutation.v1",
      generatedAt: at.toISOString(),
      asOf: at.toISOString(),
      partial: false,
      problems: [],
      incident: toIncident(next, names),
      event: toEvent(event, names),
      change: { beforeHash, afterHash, summary, idempotent: false, correlationId },
    });
  }

  private async requireStepUp(
    principal: PlatformAuthenticatedPrincipal,
    password: string | undefined,
    context: {
      incidentId: string;
      correlationId: string;
      idempotencyKey: string;
      tenantId: string | null;
    },
  ): Promise<void> {
    const deny = async (reason: string) => {
      await this.writeAudit({
        principal,
        action: "PLATFORM_INCIDENT_RESOLVE",
        incidentId: context.incidentId,
        tenantId: context.tenantId,
        result: "DENIED",
        reason,
        correlationId: context.correlationId,
        beforeHash: null,
        afterHash: null,
        metadata: { idempotencyKey: context.idempotencyKey, stepUp: true },
      });
      throw new Phase9ApiError("AUTH_FORBIDDEN", 403, "Step-up confirmation is required");
    };

    if (password === undefined) await deny("Step-up password missing");
    const hash = await this.credentials.passwordHash(principal.principalId);
    if (hash === null) await deny("Step-up credential unavailable");
    if (!(await verifyPhase9Password(password!, hash!))) {
      await deny("Step-up password rejected");
    }
  }

  private async writeAudit(input: {
    principal: PlatformAuthenticatedPrincipal;
    action: string;
    incidentId: string;
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
        entityType: "PLATFORM_INCIDENT",
        entityId: input.incidentId,
        result: input.result,
        reason: input.reason,
        correlationId: input.correlationId,
        sourceVersion: "platform-incident.v1",
        beforeHash: input.beforeHash,
        afterHash: input.afterHash,
        metadata: input.metadata,
        occurredAt: new Date(this.now()).toISOString(),
      });
    });
  }
}
