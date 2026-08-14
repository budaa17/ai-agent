import type { PrismaClient } from "@prisma/client";
import type { PlatformRole } from "./platform-contracts.js";
import type {
  PlatformSupportAccessOperation,
  PlatformSupportAccessState,
} from "./platform-advanced-contracts.js";

/**
 * Persistence for Phase 8 support diagnostic access. Behind an interface so the
 * two-person rule and the expiry semantics can be unit-tested without a
 * database, and so the append-only history has exactly one write path.
 */

export type PlatformSupportAccessEventType =
  | "REQUESTED"
  | "APPROVED"
  | "DENIED"
  | "REVOKED"
  | "EXPIRED"
  | "USED";

export interface PlatformSupportAccessGrantRecord {
  id: string;
  ticketReference: string;
  reason: string;
  tenantId: string;
  tenantName: string | null;
  projectId: string | null;
  allowedOperations: PlatformSupportAccessOperation[];
  maskedOnly: true;
  state: PlatformSupportAccessState;
  requestedById: string;
  requestedAt: string;
  approvedById: string | null;
  approvedAt: string | null;
  startsAt: string | null;
  expiresAt: string;
  decisionReason: string | null;
  revokedById: string | null;
  revokedAt: string | null;
  useCount: number;
  lastUsedAt: string | null;
  rowVersion: number;
}

export interface PlatformSupportAccessEventRecord {
  id: string;
  grantId: string;
  type: PlatformSupportAccessEventType;
  fromState: PlatformSupportAccessState | null;
  toState: PlatformSupportAccessState;
  actorPrincipalId: string | null;
  actorRole: PlatformRole | null;
  reason: string | null;
  correlationId: string;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface PlatformSupportAccessListFilter {
  limit: number;
  cursorAt: Date | null;
  cursorId: string | null;
  order: "ASC" | "DESC";
  state: PlatformSupportAccessState | null;
  activeOnly: boolean;
  tenantId: string | null;
}

export interface PlatformSupportAccessTotals {
  requested: number;
  approved: number;
  active: number;
  expired: number;
  revoked: number;
  denied: number;
}

export interface PlatformSupportAccessStore {
  list(
    filter: PlatformSupportAccessListFilter,
    asOf: Date,
  ): Promise<PlatformSupportAccessGrantRecord[]>;
  totals(asOf: Date): Promise<PlatformSupportAccessTotals>;
  findById(grantId: string): Promise<PlatformSupportAccessGrantRecord | null>;
  events(
    grantId: string,
    limit: number,
  ): Promise<{ items: PlatformSupportAccessEventRecord[]; total: number }>;
  findEventByIdempotencyKey(
    grantId: string,
    idempotencyKey: string,
  ): Promise<PlatformSupportAccessEventRecord | null>;
  displayNames(principalIds: readonly string[]): Promise<Map<string, string>>;
  tenantExists(tenantId: string): Promise<boolean>;
  create(
    grant: PlatformSupportAccessGrantRecord,
    event: PlatformSupportAccessEventRecord,
  ): Promise<void>;
  apply(
    grant: PlatformSupportAccessGrantRecord,
    event: PlatformSupportAccessEventRecord,
    expectedRowVersion: number,
  ): Promise<boolean>;
}

/**
 * A grant is usable only while approved and inside its window. Expiry is
 * computed, never trusted from a stored flag, so a clock passing the deadline
 * revokes access with no worker needing to run.
 */
export function isSupportAccessActive(
  grant: PlatformSupportAccessGrantRecord,
  asOf: Date,
): boolean {
  if (grant.state !== "APPROVED") return false;
  const startsAt = grant.startsAt === null ? null : Date.parse(grant.startsAt);
  if (startsAt !== null && startsAt > asOf.getTime()) return false;
  return Date.parse(grant.expiresAt) > asOf.getTime();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryPlatformSupportAccessStore implements PlatformSupportAccessStore {
  #grants: PlatformSupportAccessGrantRecord[];
  #events: PlatformSupportAccessEventRecord[];
  #principals: Map<string, string>;
  #tenants: Set<string>;

  constructor(
    seed: {
      grants?: PlatformSupportAccessGrantRecord[];
      events?: PlatformSupportAccessEventRecord[];
      principals?: Record<string, string>;
      tenants?: string[];
    } = {},
  ) {
    this.#grants = clone(seed.grants ?? []);
    this.#events = clone(seed.events ?? []);
    this.#principals = new Map(Object.entries(seed.principals ?? {}));
    this.#tenants = new Set(seed.tenants ?? []);
  }

  snapshot() {
    return { grants: clone(this.#grants), events: clone(this.#events) };
  }

  async list(filter: PlatformSupportAccessListFilter, asOf: Date) {
    const matched = this.#grants.filter((grant) => {
      if (filter.activeOnly && !isSupportAccessActive(grant, asOf)) return false;
      if (filter.state !== null && grant.state !== filter.state) return false;
      if (filter.tenantId !== null && grant.tenantId !== filter.tenantId) return false;
      if (filter.cursorAt === null || filter.cursorId === null) return true;
      const requestedAt = Date.parse(grant.requestedAt);
      const cursorAt = filter.cursorAt.getTime();
      return filter.order === "DESC"
        ? requestedAt < cursorAt || (requestedAt === cursorAt && grant.id < filter.cursorId)
        : requestedAt > cursorAt || (requestedAt === cursorAt && grant.id > filter.cursorId);
    });
    matched.sort((left, right) => {
      const delta = Date.parse(left.requestedAt) - Date.parse(right.requestedAt);
      const byId = left.id.localeCompare(right.id);
      return filter.order === "DESC" ? -(delta || byId) : delta || byId;
    });
    return clone(matched.slice(0, filter.limit));
  }

  async totals(asOf: Date) {
    const count = (predicate: (grant: PlatformSupportAccessGrantRecord) => boolean) =>
      this.#grants.filter(predicate).length;
    return {
      requested: count((grant) => grant.state === "REQUESTED"),
      approved: count((grant) => grant.state === "APPROVED"),
      active: count((grant) => isSupportAccessActive(grant, asOf)),
      expired: count(
        (grant) =>
          grant.state === "EXPIRED" ||
          (grant.state === "APPROVED" && !isSupportAccessActive(grant, asOf)),
      ),
      revoked: count((grant) => grant.state === "REVOKED"),
      denied: count((grant) => grant.state === "DENIED"),
    };
  }

  async findById(grantId: string) {
    return clone(this.#grants.find((grant) => grant.id === grantId) ?? null);
  }

  async events(grantId: string, limit: number) {
    const all = this.#events
      .filter((event) => event.grantId === grantId)
      .sort(
        (left, right) =>
          Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
          left.id.localeCompare(right.id),
      );
    return { items: clone(all.slice(0, limit)), total: all.length };
  }

  async findEventByIdempotencyKey(grantId: string, idempotencyKey: string) {
    return clone(
      this.#events.find(
        (event) => event.grantId === grantId && event.idempotencyKey === idempotencyKey,
      ) ?? null,
    );
  }

  async displayNames(principalIds: readonly string[]) {
    const result = new Map<string, string>();
    for (const id of principalIds) {
      const name = this.#principals.get(id);
      if (name !== undefined) result.set(id, name);
    }
    return result;
  }

  async tenantExists(tenantId: string) {
    return this.#tenants.has(tenantId);
  }

  async create(
    grant: PlatformSupportAccessGrantRecord,
    event: PlatformSupportAccessEventRecord,
  ) {
    this.#grants.push(clone(grant));
    this.#events.push(clone(event));
  }

  async apply(
    grant: PlatformSupportAccessGrantRecord,
    event: PlatformSupportAccessEventRecord,
    expectedRowVersion: number,
  ) {
    const index = this.#grants.findIndex((candidate) => candidate.id === grant.id);
    if (index < 0 || this.#grants[index]!.rowVersion !== expectedRowVersion) return false;
    // Mirrors the database CHECK constraint: never self-approval.
    if (grant.approvedById !== null && grant.approvedById === grant.requestedById) {
      throw new Error("Support access approval requires a second principal");
    }
    this.#grants[index] = clone(grant);
    this.#events.push(clone(event));
    return true;
  }
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

interface GrantRow {
  id: string;
  ticketReference: string;
  reason: string;
  tenantId: string;
  projectId: string | null;
  allowedOperations: string[];
  maskedOnly: boolean;
  state: PlatformSupportAccessState;
  requestedById: string;
  requestedAt: Date;
  approvedById: string | null;
  approvedAt: Date | null;
  startsAt: Date | null;
  expiresAt: Date;
  decisionReason: string | null;
  revokedById: string | null;
  revokedAt: Date | null;
  useCount: number;
  lastUsedAt: Date | null;
  rowVersion: number;
  tenant?: { name: string } | null;
}

function grantRecord(row: GrantRow): PlatformSupportAccessGrantRecord {
  return {
    id: row.id,
    ticketReference: row.ticketReference,
    reason: row.reason,
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? null,
    projectId: row.projectId,
    allowedOperations: row.allowedOperations as PlatformSupportAccessOperation[],
    maskedOnly: true,
    state: row.state,
    requestedById: row.requestedById,
    requestedAt: row.requestedAt.toISOString(),
    approvedById: row.approvedById,
    approvedAt: iso(row.approvedAt),
    startsAt: iso(row.startsAt),
    expiresAt: row.expiresAt.toISOString(),
    decisionReason: row.decisionReason,
    revokedById: row.revokedById,
    revokedAt: iso(row.revokedAt),
    useCount: row.useCount,
    lastUsedAt: iso(row.lastUsedAt),
    rowVersion: row.rowVersion,
  };
}

function grantData(record: PlatformSupportAccessGrantRecord) {
  return {
    ticketReference: record.ticketReference,
    reason: record.reason,
    tenantId: record.tenantId,
    projectId: record.projectId,
    allowedOperations: record.allowedOperations,
    maskedOnly: true,
    state: record.state,
    requestedById: record.requestedById,
    approvedById: record.approvedById,
    approvedAt: record.approvedAt === null ? null : new Date(record.approvedAt),
    startsAt: record.startsAt === null ? null : new Date(record.startsAt),
    expiresAt: new Date(record.expiresAt),
    decisionReason: record.decisionReason,
    revokedById: record.revokedById,
    revokedAt: record.revokedAt === null ? null : new Date(record.revokedAt),
    useCount: record.useCount,
    lastUsedAt: record.lastUsedAt === null ? null : new Date(record.lastUsedAt),
    rowVersion: record.rowVersion,
  };
}

function eventData(record: PlatformSupportAccessEventRecord) {
  return {
    id: record.id,
    grantId: record.grantId,
    type: record.type,
    fromState: record.fromState,
    toState: record.toState,
    actorPrincipalId: record.actorPrincipalId,
    actorRole: record.actorRole,
    reason: record.reason,
    correlationId: record.correlationId,
    idempotencyKey: record.idempotencyKey,
    metadata: record.metadata as never,
    occurredAt: new Date(record.occurredAt),
  };
}

export class PrismaPlatformSupportAccessStore implements PlatformSupportAccessStore {
  constructor(private readonly client: PrismaClient) {}

  async list(filter: PlatformSupportAccessListFilter, asOf: Date) {
    const direction = filter.order === "DESC" ? ("desc" as const) : ("asc" as const);
    const rows = await this.client.platformSupportAccessGrant.findMany({
      where: {
        ...(filter.activeOnly ? { state: "APPROVED", expiresAt: { gt: asOf } } : {}),
        ...(filter.state === null ? {} : { state: filter.state }),
        ...(filter.tenantId === null ? {} : { tenantId: filter.tenantId }),
        ...(filter.cursorAt === null || filter.cursorId === null
          ? {}
          : filter.order === "DESC"
            ? {
                OR: [
                  { requestedAt: { lt: filter.cursorAt } },
                  { requestedAt: filter.cursorAt, id: { lt: filter.cursorId } },
                ],
              }
            : {
                OR: [
                  { requestedAt: { gt: filter.cursorAt } },
                  { requestedAt: filter.cursorAt, id: { gt: filter.cursorId } },
                ],
              }),
      },
      include: { tenant: { select: { name: true } } },
      orderBy: [{ requestedAt: direction }, { id: direction }],
      take: filter.limit,
    });
    return rows.map(grantRecord);
  }

  async totals(asOf: Date) {
    const [grouped, active] = await Promise.all([
      this.client.platformSupportAccessGrant.groupBy({
        by: ["state"],
        _count: { _all: true },
      }),
      this.client.platformSupportAccessGrant.count({
        where: { state: "APPROVED", expiresAt: { gt: asOf } },
      }),
    ]);
    const of = (state: PlatformSupportAccessState) =>
      grouped.find((row) => row.state === state)?._count._all ?? 0;
    return {
      requested: of("REQUESTED"),
      approved: of("APPROVED"),
      active,
      expired: of("EXPIRED") + Math.max(0, of("APPROVED") - active),
      revoked: of("REVOKED"),
      denied: of("DENIED"),
    };
  }

  async findById(grantId: string) {
    const row = await this.client.platformSupportAccessGrant.findUnique({
      where: { id: grantId },
      include: { tenant: { select: { name: true } } },
    });
    return row === null ? null : grantRecord(row);
  }

  async events(grantId: string, limit: number) {
    const [rows, total] = await Promise.all([
      this.client.platformSupportAccessEvent.findMany({
        where: { grantId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: limit,
      }),
      this.client.platformSupportAccessEvent.count({ where: { grantId } }),
    ]);
    return {
      items: rows.map((row) => ({
        ...row,
        metadata:
          typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : {},
        occurredAt: row.occurredAt.toISOString(),
      })),
      total,
    };
  }

  async findEventByIdempotencyKey(grantId: string, idempotencyKey: string) {
    const row = await this.client.platformSupportAccessEvent.findFirst({
      where: { grantId, idempotencyKey },
    });
    return row === null
      ? null
      : {
          ...row,
          metadata:
            typeof row.metadata === "object" &&
            row.metadata !== null &&
            !Array.isArray(row.metadata)
              ? (row.metadata as Record<string, unknown>)
              : {},
          occurredAt: row.occurredAt.toISOString(),
        };
  }

  async displayNames(principalIds: readonly string[]) {
    const unique = [...new Set(principalIds)];
    if (unique.length === 0) return new Map<string, string>();
    const rows = await this.client.platformPrincipal.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((row) => [row.id, row.displayName]));
  }

  async tenantExists(tenantId: string) {
    const row = await this.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    return row !== null;
  }

  async create(
    grant: PlatformSupportAccessGrantRecord,
    event: PlatformSupportAccessEventRecord,
  ) {
    await this.client.$transaction(async (transaction) => {
      await transaction.platformSupportAccessGrant.create({
        data: {
          id: grant.id,
          requestedAt: new Date(grant.requestedAt),
          ...grantData(grant),
        },
      });
      await transaction.platformSupportAccessEvent.create({ data: eventData(event) });
    });
  }

  async apply(
    grant: PlatformSupportAccessGrantRecord,
    event: PlatformSupportAccessEventRecord,
    expectedRowVersion: number,
  ) {
    return this.client.$transaction(async (transaction) => {
      const updated = await transaction.platformSupportAccessGrant.updateMany({
        where: { id: grant.id, rowVersion: expectedRowVersion },
        data: grantData(grant),
      });
      if (updated.count === 0) return false;
      await transaction.platformSupportAccessEvent.create({ data: eventData(event) });
      return true;
    });
  }
}
