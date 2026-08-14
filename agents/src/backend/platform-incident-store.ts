import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  PlatformIncidentEventType,
  PlatformIncidentSeverity,
  PlatformIncidentState,
} from "./platform-incident-contracts.js";
import type { PlatformRole } from "./platform-contracts.js";

/**
 * Persistence for Phase 6 incidents. Kept behind an interface so the service
 * can be unit-tested without PostgreSQL, and so the optimistic-lock and
 * append-only guarantees live in one place.
 */

export interface PlatformIncidentEvidenceRecord {
  metricKey: string;
  value: number | string | boolean;
  unit: string;
  observedAt: string;
}

export interface PlatformIncidentRecord {
  id: string;
  signalId: string;
  ruleKey: string;
  ruleVersion: string;
  severity: PlatformIncidentSeverity;
  state: PlatformIncidentState;
  title: string;
  impact: string;
  recommendedAction: string;
  diagnosticsHref: string;
  tenantId: string | null;
  tenantName: string | null;
  agentType: string | null;
  component: string | null;
  evidence: PlatformIncidentEvidenceRecord[];
  firstEvidenceAt: string | null;
  lastEvidenceAt: string;
  openedAt: string;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  assignedToId: string | null;
  assignedAt: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolutionNote: string | null;
  autoResolvedAt: string | null;
  reopenCount: number;
  rowVersion: number;
}

export interface PlatformIncidentEventRecord {
  id: string;
  incidentId: string;
  type: PlatformIncidentEventType;
  fromState: PlatformIncidentState | null;
  toState: PlatformIncidentState;
  actorPrincipalId: string | null;
  actorRole: PlatformRole | null;
  reason: string | null;
  note: string | null;
  correlationId: string;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface PlatformIncidentListFilter {
  limit: number;
  cursorAt: Date | null;
  cursorId: string | null;
  order: "ASC" | "DESC";
  state: PlatformIncidentState | null;
  activeOnly: boolean;
  severity: PlatformIncidentSeverity | null;
  tenantId: string | null;
  agentType: string | null;
  assignedToId: string | null;
}

export interface PlatformIncidentTotals {
  open: number;
  acknowledged: number;
  reopened: number;
  resolved: number;
  critical: number;
  high: number;
}

export const PLATFORM_INCIDENT_ACTIVE_STATES: readonly PlatformIncidentState[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "REOPENED",
];

export function isActiveIncidentState(state: PlatformIncidentState): boolean {
  return PLATFORM_INCIDENT_ACTIVE_STATES.includes(state);
}

export interface PlatformIncidentStore {
  listActive(): Promise<PlatformIncidentRecord[]>;
  statesBySignalIds(
    signalIds: readonly string[],
  ): Promise<Map<string, { incidentId: string; state: PlatformIncidentState }>>;
  list(filter: PlatformIncidentListFilter): Promise<PlatformIncidentRecord[]>;
  totals(): Promise<PlatformIncidentTotals>;
  findById(incidentId: string): Promise<PlatformIncidentRecord | null>;
  events(
    incidentId: string,
    limit: number,
  ): Promise<{ items: PlatformIncidentEventRecord[]; total: number }>;
  findEventByIdempotencyKey(
    incidentId: string,
    idempotencyKey: string,
  ): Promise<PlatformIncidentEventRecord | null>;
  displayNames(principalIds: readonly string[]): Promise<Map<string, string>>;
  principalExists(principalId: string): Promise<boolean>;
  create(incident: PlatformIncidentRecord, event: PlatformIncidentEventRecord): Promise<void>;
  /**
   * Writes the incident only when the stored `rowVersion` still matches the one
   * the caller read, then appends the event in the same transaction.
   */
  apply(
    incident: PlatformIncidentRecord,
    event: PlatformIncidentEventRecord,
    expectedRowVersion: number,
  ): Promise<boolean>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryPlatformIncidentStore implements PlatformIncidentStore {
  #incidents: PlatformIncidentRecord[];
  #events: PlatformIncidentEventRecord[];
  #principals: Map<string, string>;

  constructor(
    seed: {
      incidents?: PlatformIncidentRecord[];
      events?: PlatformIncidentEventRecord[];
      principals?: Record<string, string>;
    } = {},
  ) {
    this.#incidents = clone(seed.incidents ?? []);
    this.#events = clone(seed.events ?? []);
    this.#principals = new Map(Object.entries(seed.principals ?? {}));
  }

  snapshot() {
    return { incidents: clone(this.#incidents), events: clone(this.#events) };
  }

  async listActive() {
    return clone(this.#incidents.filter((incident) => isActiveIncidentState(incident.state)));
  }

  async statesBySignalIds(signalIds: readonly string[]) {
    const wanted = new Set(signalIds);
    const result = new Map<string, { incidentId: string; state: PlatformIncidentState }>();
    for (const incident of this.#incidents) {
      if (!wanted.has(incident.signalId)) continue;
      result.set(incident.signalId, { incidentId: incident.id, state: incident.state });
    }
    return result;
  }

  async list(filter: PlatformIncidentListFilter) {
    const matched = this.#incidents.filter((incident) => {
      if (filter.activeOnly && !isActiveIncidentState(incident.state)) return false;
      if (filter.state !== null && incident.state !== filter.state) return false;
      if (filter.severity !== null && incident.severity !== filter.severity) return false;
      if (filter.tenantId !== null && incident.tenantId !== filter.tenantId) return false;
      if (filter.agentType !== null && incident.agentType !== filter.agentType) return false;
      if (filter.assignedToId !== null && incident.assignedToId !== filter.assignedToId) {
        return false;
      }
      if (filter.cursorAt === null || filter.cursorId === null) return true;
      const openedAt = Date.parse(incident.openedAt);
      const cursorAt = filter.cursorAt.getTime();
      return filter.order === "DESC"
        ? openedAt < cursorAt || (openedAt === cursorAt && incident.id < filter.cursorId)
        : openedAt > cursorAt || (openedAt === cursorAt && incident.id > filter.cursorId);
    });
    matched.sort((left, right) => {
      const delta = Date.parse(left.openedAt) - Date.parse(right.openedAt);
      const byId = left.id.localeCompare(right.id);
      return filter.order === "DESC" ? -(delta || byId) : delta || byId;
    });
    return clone(matched.slice(0, filter.limit));
  }

  async totals() {
    const count = (predicate: (incident: PlatformIncidentRecord) => boolean) =>
      this.#incidents.filter(predicate).length;
    return {
      open: count((incident) => incident.state === "OPEN"),
      acknowledged: count((incident) => incident.state === "ACKNOWLEDGED"),
      reopened: count((incident) => incident.state === "REOPENED"),
      resolved: count((incident) => incident.state === "RESOLVED"),
      critical: count(
        (incident) => incident.severity === "CRITICAL" && isActiveIncidentState(incident.state),
      ),
      high: count(
        (incident) => incident.severity === "HIGH" && isActiveIncidentState(incident.state),
      ),
    };
  }

  async findById(incidentId: string) {
    return clone(this.#incidents.find((incident) => incident.id === incidentId) ?? null);
  }

  async events(incidentId: string, limit: number) {
    const all = this.#events
      .filter((event) => event.incidentId === incidentId)
      .sort(
        (left, right) =>
          Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
          left.id.localeCompare(right.id),
      );
    return { items: clone(all.slice(0, limit)), total: all.length };
  }

  async findEventByIdempotencyKey(incidentId: string, idempotencyKey: string) {
    return clone(
      this.#events.find(
        (event) => event.incidentId === incidentId && event.idempotencyKey === idempotencyKey,
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

  async principalExists(principalId: string) {
    return this.#principals.has(principalId);
  }

  async create(incident: PlatformIncidentRecord, event: PlatformIncidentEventRecord) {
    if (this.#incidents.some((candidate) => candidate.signalId === incident.signalId)) {
      throw new Error("Platform incident already exists for this signal");
    }
    this.#incidents.push(clone(incident));
    this.#events.push(clone(event));
  }

  async apply(
    incident: PlatformIncidentRecord,
    event: PlatformIncidentEventRecord,
    expectedRowVersion: number,
  ) {
    const index = this.#incidents.findIndex((candidate) => candidate.id === incident.id);
    if (index < 0 || this.#incidents[index]!.rowVersion !== expectedRowVersion) return false;
    this.#incidents[index] = clone(incident);
    this.#events.push(clone(event));
    return true;
  }
}

interface PlatformIncidentRow {
  id: string;
  signalId: string;
  ruleKey: string;
  ruleVersion: string;
  severity: PlatformIncidentSeverity;
  state: PlatformIncidentState;
  title: string;
  impact: string;
  recommendedAction: string;
  diagnosticsHref: string;
  tenantId: string | null;
  tenantName: string | null;
  agentType: string | null;
  component: string | null;
  evidence: Prisma.JsonValue;
  firstEvidenceAt: Date | null;
  lastEvidenceAt: Date;
  openedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
  assignedToId: string | null;
  assignedAt: Date | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  resolutionNote: string | null;
  autoResolvedAt: Date | null;
  reopenCount: number;
  rowVersion: number;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function evidenceOf(value: Prisma.JsonValue): PlatformIncidentEvidenceRecord[] {
  return Array.isArray(value) ? (value as unknown as PlatformIncidentEvidenceRecord[]) : [];
}

function incidentRecord(row: PlatformIncidentRow): PlatformIncidentRecord {
  return {
    ...row,
    evidence: evidenceOf(row.evidence),
    firstEvidenceAt: iso(row.firstEvidenceAt),
    lastEvidenceAt: row.lastEvidenceAt.toISOString(),
    openedAt: row.openedAt.toISOString(),
    acknowledgedAt: iso(row.acknowledgedAt),
    assignedAt: iso(row.assignedAt),
    resolvedAt: iso(row.resolvedAt),
    autoResolvedAt: iso(row.autoResolvedAt),
  };
}

function eventRecord(row: {
  id: string;
  incidentId: string;
  type: PlatformIncidentEventType;
  fromState: PlatformIncidentState | null;
  toState: PlatformIncidentState;
  actorPrincipalId: string | null;
  actorRole: PlatformRole | null;
  reason: string | null;
  note: string | null;
  correlationId: string;
  idempotencyKey: string | null;
  metadata: Prisma.JsonValue;
  occurredAt: Date;
}): PlatformIncidentEventRecord {
  return {
    ...row,
    metadata:
      typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    occurredAt: row.occurredAt.toISOString(),
  };
}

function incidentData(record: PlatformIncidentRecord) {
  return {
    signalId: record.signalId,
    ruleKey: record.ruleKey,
    ruleVersion: record.ruleVersion,
    severity: record.severity,
    state: record.state,
    title: record.title,
    impact: record.impact,
    recommendedAction: record.recommendedAction,
    diagnosticsHref: record.diagnosticsHref,
    tenantId: record.tenantId,
    tenantName: record.tenantName,
    agentType: record.agentType,
    component: record.component,
    evidence: record.evidence as unknown as Prisma.InputJsonValue,
    firstEvidenceAt: record.firstEvidenceAt === null ? null : new Date(record.firstEvidenceAt),
    lastEvidenceAt: new Date(record.lastEvidenceAt),
    acknowledgedAt: record.acknowledgedAt === null ? null : new Date(record.acknowledgedAt),
    acknowledgedById: record.acknowledgedById,
    assignedToId: record.assignedToId,
    assignedAt: record.assignedAt === null ? null : new Date(record.assignedAt),
    resolvedAt: record.resolvedAt === null ? null : new Date(record.resolvedAt),
    resolvedById: record.resolvedById,
    resolutionNote: record.resolutionNote,
    autoResolvedAt: record.autoResolvedAt === null ? null : new Date(record.autoResolvedAt),
    reopenCount: record.reopenCount,
    rowVersion: record.rowVersion,
  };
}

function eventData(record: PlatformIncidentEventRecord) {
  return {
    id: record.id,
    incidentId: record.incidentId,
    type: record.type,
    fromState: record.fromState,
    toState: record.toState,
    actorPrincipalId: record.actorPrincipalId,
    actorRole: record.actorRole,
    reason: record.reason,
    note: record.note,
    correlationId: record.correlationId,
    idempotencyKey: record.idempotencyKey,
    metadata: record.metadata as Prisma.InputJsonValue,
    occurredAt: new Date(record.occurredAt),
  };
}

export class PrismaPlatformIncidentStore implements PlatformIncidentStore {
  constructor(private readonly client: PrismaClient) {}

  async listActive() {
    const rows = await this.client.platformIncident.findMany({
      where: { state: { in: [...PLATFORM_INCIDENT_ACTIVE_STATES] } },
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
    });
    return rows.map(incidentRecord);
  }

  async statesBySignalIds(signalIds: readonly string[]) {
    if (signalIds.length === 0) {
      return new Map<string, { incidentId: string; state: PlatformIncidentState }>();
    }
    const rows = await this.client.platformIncident.findMany({
      where: { signalId: { in: [...signalIds] } },
      select: { id: true, signalId: true, state: true },
    });
    return new Map(rows.map((row) => [row.signalId, { incidentId: row.id, state: row.state }]));
  }

  async list(filter: PlatformIncidentListFilter) {
    const direction = filter.order === "DESC" ? ("desc" as const) : ("asc" as const);
    const rows = await this.client.platformIncident.findMany({
      where: {
        ...(filter.activeOnly ? { state: { in: [...PLATFORM_INCIDENT_ACTIVE_STATES] } } : {}),
        ...(filter.state === null ? {} : { state: filter.state }),
        ...(filter.severity === null ? {} : { severity: filter.severity }),
        ...(filter.tenantId === null ? {} : { tenantId: filter.tenantId }),
        ...(filter.agentType === null ? {} : { agentType: filter.agentType }),
        ...(filter.assignedToId === null ? {} : { assignedToId: filter.assignedToId }),
        ...(filter.cursorAt === null || filter.cursorId === null
          ? {}
          : filter.order === "DESC"
            ? {
                OR: [
                  { openedAt: { lt: filter.cursorAt } },
                  { openedAt: filter.cursorAt, id: { lt: filter.cursorId } },
                ],
              }
            : {
                OR: [
                  { openedAt: { gt: filter.cursorAt } },
                  { openedAt: filter.cursorAt, id: { gt: filter.cursorId } },
                ],
              }),
      },
      orderBy: [{ openedAt: direction }, { id: direction }],
      take: filter.limit,
    });
    return rows.map(incidentRecord);
  }

  async totals() {
    const grouped = await this.client.platformIncident.groupBy({
      by: ["state", "severity"],
      _count: { _all: true },
    });
    const totals: PlatformIncidentTotals = {
      open: 0,
      acknowledged: 0,
      reopened: 0,
      resolved: 0,
      critical: 0,
      high: 0,
    };
    for (const row of grouped) {
      const count = row._count._all;
      if (row.state === "OPEN") totals.open += count;
      if (row.state === "ACKNOWLEDGED") totals.acknowledged += count;
      if (row.state === "REOPENED") totals.reopened += count;
      if (row.state === "RESOLVED") totals.resolved += count;
      if (!isActiveIncidentState(row.state)) continue;
      if (row.severity === "CRITICAL") totals.critical += count;
      if (row.severity === "HIGH") totals.high += count;
    }
    return totals;
  }

  async findById(incidentId: string) {
    const row = await this.client.platformIncident.findUnique({ where: { id: incidentId } });
    return row === null ? null : incidentRecord(row);
  }

  async events(incidentId: string, limit: number) {
    const [rows, total] = await Promise.all([
      this.client.platformIncidentEvent.findMany({
        where: { incidentId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: limit,
      }),
      this.client.platformIncidentEvent.count({ where: { incidentId } }),
    ]);
    return { items: rows.map(eventRecord), total };
  }

  async findEventByIdempotencyKey(incidentId: string, idempotencyKey: string) {
    const row = await this.client.platformIncidentEvent.findFirst({
      where: { incidentId, idempotencyKey },
    });
    return row === null ? null : eventRecord(row);
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

  async principalExists(principalId: string) {
    const row = await this.client.platformPrincipal.findUnique({
      where: { id: principalId },
      select: { id: true },
    });
    return row !== null;
  }

  async create(incident: PlatformIncidentRecord, event: PlatformIncidentEventRecord) {
    await this.client.$transaction(async (transaction) => {
      await transaction.platformIncident.create({
        data: { id: incident.id, openedAt: new Date(incident.openedAt), ...incidentData(incident) },
      });
      await transaction.platformIncidentEvent.create({ data: eventData(event) });
    });
  }

  async apply(
    incident: PlatformIncidentRecord,
    event: PlatformIncidentEventRecord,
    expectedRowVersion: number,
  ) {
    return this.client.$transaction(async (transaction) => {
      const updated = await transaction.platformIncident.updateMany({
        where: { id: incident.id, rowVersion: expectedRowVersion },
        data: incidentData(incident),
      });
      if (updated.count === 0) return false;
      await transaction.platformIncidentEvent.create({ data: eventData(event) });
      return true;
    });
  }
}
