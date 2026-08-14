import type { Phase9Role } from "./contracts.js";

export interface Phase9TenantRecord {
  id: string;
  slug: string;
  name: string;
}

export interface Phase9UserRecord {
  id: string;
  tenantId: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  tenantRole: Phase9Role;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";
  tokenVersion: number;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
}

export interface Phase9CredentialRecord {
  userId: string;
  passwordHash: string;
  failedLoginCount: number;
  lockedUntil: string | null;
  passwordChangedAt: string;
}

export interface Phase9InvitationRecord {
  id: string;
  tenantId: string;
  emailNormalized: string;
  role: Phase9Role;
  projectIds: string[];
  tokenHash: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  invitedByUserId: string;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export interface Phase9ProjectMemberRecord {
  id: string;
  tenantId: string;
  projectId: string;
  userId: string;
  role: Phase9Role;
  active: boolean;
}

export interface Phase9RefreshSessionRecord {
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
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  reuseDetectedAt: string | null;
  createdAt: string;
}

export interface Phase9ProjectRecord {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  status: "PLANNED" | "ACTIVE" | "PAUSED" | "COMPLETED";
  plannedStart: string;
  plannedEnd: string;
  rowVersion: number;
}

export interface Phase9ReviewTaskRecord {
  id: string;
  tenantId: string;
  projectId: string;
  targetType:
    | "REGISTRATION_DRAFT"
    | "QUANTITY_TAKEOFF"
    | "ESTIMATE"
    | "SCHEDULE"
    | "BASELINE"
    | "DAILY_WORK_PLAN"
    | "DAILY_REPORT"
    | "PROGRESS_VERIFICATION"
    | "RECOVERY_SCENARIO";
  targetId: string;
  targetVersion: number;
  status:
    "DRAFT" | "REVIEW_REQUIRED" | "APPROVED" | "APPLIED" | "SUPERSEDED" | "REJECTED" | "CANCELLED";
  sourceHash: string;
  createdByUserId: string;
  assignedRole: Phase9Role;
  assignedUserId: string | null;
  rowVersion: number;
}

export interface Phase9FileAssetRecord {
  id: string;
  tenantId: string;
  projectId: string;
  bucket: string;
  objectKey: string;
  originalFileName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  status: "PENDING" | "AVAILABLE" | "QUARANTINED" | "DELETED";
}

export interface Phase9VersionSnapshotRecord {
  id: string;
  tenantId: string;
  projectId: string;
  targetType: Phase9ReviewTaskRecord["targetType"];
  versionNumber: number;
  status: Phase9ReviewTaskRecord["status"];
  sourceHash: string;
  content: Record<string, unknown>;
  createdAt: string;
}

export interface Phase9ForecastQueryRecord {
  id: string;
  tenantId: string;
  projectId: string;
  asOf: string;
  status: string;
  projectedFinish: string | null;
  delayDays: string | null;
  confidence: string | null;
  methodVersion: string;
  thresholdVersion: string;
  sourceHash: string;
  drivers: Record<string, unknown>[];
}

export interface Phase9IdempotencyRecord {
  id: string;
  tenantId: string;
  projectId: string;
  key: string;
  route: string;
  requestHash: string;
  responseStatus: number;
  responseBody: Record<string, unknown>;
  actorUserId: string;
  expiresAt: string;
  createdAt: string;
}

export interface Phase9AppliedCommandRecord {
  id: string;
  tenantId: string;
  projectId: string;
  reviewTaskId: string;
  idempotencyKey: string;
  commandType: string;
  targetType: Phase9ReviewTaskRecord["targetType"];
  targetId: string;
  targetVersion: number;
  expectedRowVersion: number;
  sourceHash: string;
  requestHash: string;
  resultHash: string;
  result: Record<string, unknown>;
  status: "APPLIED" | "REPLAYED";
  actorUserId: string;
  actorRole: Phase9Role;
  reason: string;
  appliedAt: string;
}

export interface Phase9ReviewDecisionRecord {
  id: string;
  tenantId: string;
  projectId: string;
  reviewTaskId: string;
  decision: "APPROVE" | "REJECT";
  fromStatus: Phase9ReviewTaskRecord["status"];
  toStatus: "APPROVED" | "REJECTED";
  actorUserId: string;
  actorRole: Phase9Role;
  reason: string;
  emergencyOverride: boolean;
  sourceHash: string;
  decidedAt: string;
}

export interface Phase9AuditRecord {
  id: string;
  tenantId: string;
  projectId: string | null;
  actorUserId: string | null;
  actorRole: Phase9Role | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  correlationId: string;
  sourceVersion: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface Phase9OutboxRecord {
  id: string;
  tenantId: string;
  projectId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  status: "PENDING" | "PUBLISHED" | "FAILED" | "DEAD_LETTER";
  availableAt: string;
  publishedAt: string | null;
  retryCount: number;
  lastErrorCode: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string;
}

export interface Phase9ConsumedEventRecord {
  id: string;
  tenantId: string;
  projectId: string;
  consumer: string;
  eventId: string;
  idempotencyKey: string;
  resultHash: string;
  consumedAt: string;
}

export interface Phase9NotificationRecord {
  id: string;
  tenantId: string;
  projectId: string;
  userId: string | null;
  eventId: string;
  channel: string;
  templateCode: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "SENT" | "FAILED" | "READ";
  sentAt: string | null;
  createdAt: string;
}

export interface Phase9StoreState {
  tenants: Phase9TenantRecord[];
  users: Phase9UserRecord[];
  credentials: Phase9CredentialRecord[];
  invitations: Phase9InvitationRecord[];
  memberships: Phase9ProjectMemberRecord[];
  sessions: Phase9RefreshSessionRecord[];
  projects: Phase9ProjectRecord[];
  reviewTasks: Phase9ReviewTaskRecord[];
  fileAssets: Phase9FileAssetRecord[];
  versionSnapshots: Phase9VersionSnapshotRecord[];
  forecastSnapshots: Phase9ForecastQueryRecord[];
  idempotencyRecords: Phase9IdempotencyRecord[];
  appliedCommands: Phase9AppliedCommandRecord[];
  reviewDecisions: Phase9ReviewDecisionRecord[];
  auditLogs: Phase9AuditRecord[];
  outboxEvents: Phase9OutboxRecord[];
  consumedEvents: Phase9ConsumedEventRecord[];
  notifications: Phase9NotificationRecord[];
}

export interface Phase9StoreTransaction {
  findTenantBySlug(slug: string): Promise<Phase9TenantRecord | null>;
  findTenantById(tenantId: string): Promise<Phase9TenantRecord | null>;
  findUserByEmail(tenantId: string, emailNormalized: string): Promise<Phase9UserRecord | null>;
  /**
   * Every tenant an email has an active account in. Sign-in no longer asks for
   * a tenant, so it resolves candidates from the email and then proves the
   * password against each. Capped because each candidate costs one scrypt
   * verification.
   */
  findActiveUsersByEmail(emailNormalized: string, limit: number): Promise<Phase9UserRecord[]>;
  findUserById(tenantId: string, userId: string): Promise<Phase9UserRecord | null>;
  createUser(record: Phase9UserRecord): Promise<void>;
  updateUser(record: Phase9UserRecord): Promise<void>;
  getCredential(userId: string): Promise<Phase9CredentialRecord | null>;
  createCredential(record: Phase9CredentialRecord): Promise<void>;
  updateCredential(record: Phase9CredentialRecord): Promise<void>;
  findInvitationByTokenHash(tokenHash: string): Promise<Phase9InvitationRecord | null>;
  createInvitation(record: Phase9InvitationRecord): Promise<void>;
  updateInvitation(record: Phase9InvitationRecord): Promise<void>;
  createMembership(record: Phase9ProjectMemberRecord): Promise<void>;
  findMembership(
    tenantId: string,
    projectId: string,
    userId: string,
  ): Promise<Phase9ProjectMemberRecord | null>;
  listMemberships(tenantId: string, userId: string): Promise<Phase9ProjectMemberRecord[]>;
  createSession(record: Phase9RefreshSessionRecord): Promise<void>;
  findSession(sessionId: string): Promise<Phase9RefreshSessionRecord | null>;
  updateSession(record: Phase9RefreshSessionRecord): Promise<void>;
  revokeSessionFamily(familyId: string, at: string, reuseDetected: boolean): Promise<void>;
  getProject(tenantId: string, projectId: string): Promise<Phase9ProjectRecord | null>;
  listProjects(tenantId: string): Promise<Phase9ProjectRecord[]>;
  getReviewTask(
    tenantId: string,
    projectId: string,
    taskId: string,
  ): Promise<Phase9ReviewTaskRecord | null>;
  updateReviewTask(record: Phase9ReviewTaskRecord): Promise<void>;
  getFileAsset(
    tenantId: string,
    projectId: string,
    artifactId: string,
  ): Promise<Phase9FileAssetRecord | null>;
  getVersionSnapshot(
    tenantId: string,
    projectId: string,
    versionId: string,
  ): Promise<Phase9VersionSnapshotRecord | null>;
  /**
   * Moves the canonical artefact along its lifecycle. Reviewing a task and
   * approving the thing it points at are the same act; without this the review
   * record advances while the artefact stays behind, and apply can never find
   * an APPROVED version to act on.
   */
  updateVersionStatus(
    tenantId: string,
    projectId: string,
    versionId: string,
    targetType: Phase9VersionSnapshotRecord["targetType"],
    status: Phase9VersionSnapshotRecord["status"],
  ): Promise<void>;
  materializeAppliedVersion(
    tenantId: string,
    projectId: string,
    version: Phase9VersionSnapshotRecord,
    appliedAt: string,
  ): Promise<void>;
  getLatestForecast(
    tenantId: string,
    projectId: string,
    asOf: string,
  ): Promise<Phase9ForecastQueryRecord | null>;
  findIdempotency(tenantId: string, key: string): Promise<Phase9IdempotencyRecord | null>;
  createIdempotency(record: Phase9IdempotencyRecord): Promise<void>;
  createAppliedCommand(record: Phase9AppliedCommandRecord): Promise<void>;
  createReviewDecision(record: Phase9ReviewDecisionRecord): Promise<void>;
  createAudit(record: Phase9AuditRecord): Promise<void>;
  listAudit(tenantId: string, projectId: string | null): Promise<Phase9AuditRecord[]>;
  createOutbox(record: Phase9OutboxRecord): Promise<void>;
  listDueOutbox(now: string, limit: number): Promise<Phase9OutboxRecord[]>;
  updateOutbox(record: Phase9OutboxRecord): Promise<void>;
  findConsumedEvent(
    consumer: string,
    idempotencyKey: string,
  ): Promise<Phase9ConsumedEventRecord | null>;
  createConsumedEvent(record: Phase9ConsumedEventRecord): Promise<void>;
  createNotification(record: Phase9NotificationRecord): Promise<void>;
}

export interface Phase9Store {
  transaction<T>(work: (transaction: Phase9StoreTransaction) => Promise<T>): Promise<T>;
  read<T>(work: (transaction: Phase9StoreTransaction) => Promise<T>): Promise<T>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function replaceById<T extends { id: string }>(values: T[], record: T): void {
  const index = values.findIndex((value) => value.id === record.id);
  if (index < 0) {
    throw new Error(`Record ${record.id} does not exist`);
  }
  values[index] = clone(record);
}

class InMemoryPhase9Transaction implements Phase9StoreTransaction {
  constructor(private readonly state: Phase9StoreState) {}

  async findTenantBySlug(slug: string) {
    return clone(this.state.tenants.find((value) => value.slug === slug) ?? null);
  }

  async findTenantById(tenantId: string) {
    return clone(this.state.tenants.find((value) => value.id === tenantId) ?? null);
  }

  async findUserByEmail(tenantId: string, emailNormalized: string) {
    return clone(
      this.state.users.find(
        (value) => value.tenantId === tenantId && value.emailNormalized === emailNormalized,
      ) ?? null,
    );
  }

  async findActiveUsersByEmail(emailNormalized: string, limit: number) {
    return clone(
      this.state.users
        .filter((value) => value.emailNormalized === emailNormalized && value.status === "ACTIVE")
        .sort((left, right) => left.tenantId.localeCompare(right.tenantId))
        .slice(0, limit),
    );
  }

  async findUserById(tenantId: string, userId: string) {
    return clone(
      this.state.users.find((value) => value.tenantId === tenantId && value.id === userId) ?? null,
    );
  }

  async createUser(record: Phase9UserRecord) {
    if (
      this.state.users.some(
        (value) =>
          value.id === record.id ||
          (value.tenantId === record.tenantId && value.emailNormalized === record.emailNormalized),
      )
    ) {
      throw new Error("Phase 9 user uniqueness violation");
    }
    this.state.users.push(clone(record));
  }

  async updateUser(record: Phase9UserRecord) {
    replaceById(this.state.users, record);
  }

  async getCredential(userId: string) {
    return clone(this.state.credentials.find((value) => value.userId === userId) ?? null);
  }

  async createCredential(record: Phase9CredentialRecord) {
    if (this.state.credentials.some((value) => value.userId === record.userId)) {
      throw new Error("Phase 9 credential uniqueness violation");
    }
    this.state.credentials.push(clone(record));
  }

  async updateCredential(record: Phase9CredentialRecord) {
    const index = this.state.credentials.findIndex((value) => value.userId === record.userId);
    if (index < 0) throw new Error(`Credential ${record.userId} does not exist`);
    this.state.credentials[index] = clone(record);
  }

  async findInvitationByTokenHash(tokenHash: string) {
    return clone(this.state.invitations.find((value) => value.tokenHash === tokenHash) ?? null);
  }

  async createInvitation(record: Phase9InvitationRecord) {
    if (
      this.state.invitations.some(
        (value) =>
          value.tokenHash === record.tokenHash ||
          (value.tenantId === record.tenantId &&
            value.emailNormalized === record.emailNormalized &&
            value.status === "PENDING"),
      )
    ) {
      throw new Error("Phase 9 invitation uniqueness violation");
    }
    this.state.invitations.push(clone(record));
  }

  async updateInvitation(record: Phase9InvitationRecord) {
    replaceById(this.state.invitations, record);
  }

  async createMembership(record: Phase9ProjectMemberRecord) {
    const existing = this.state.memberships.find(
      (value) => value.projectId === record.projectId && value.userId === record.userId,
    );
    if (existing !== undefined) {
      replaceById(this.state.memberships, { ...record, id: existing.id });
      return;
    }
    this.state.memberships.push(clone(record));
  }

  async findMembership(tenantId: string, projectId: string, userId: string) {
    return clone(
      this.state.memberships.find(
        (value) =>
          value.tenantId === tenantId &&
          value.projectId === projectId &&
          value.userId === userId &&
          value.active,
      ) ?? null,
    );
  }

  async listMemberships(tenantId: string, userId: string) {
    return clone(
      this.state.memberships.filter(
        (value) => value.tenantId === tenantId && value.userId === userId && value.active,
      ),
    );
  }

  async createSession(record: Phase9RefreshSessionRecord) {
    if (
      this.state.sessions.some(
        (value) => value.id === record.id || value.tokenHash === record.tokenHash,
      )
    ) {
      throw new Error("Phase 9 refresh-session uniqueness violation");
    }
    this.state.sessions.push(clone(record));
  }

  async findSession(sessionId: string) {
    return clone(this.state.sessions.find((value) => value.id === sessionId) ?? null);
  }

  async updateSession(record: Phase9RefreshSessionRecord) {
    replaceById(this.state.sessions, record);
  }

  async revokeSessionFamily(familyId: string, at: string, reuseDetected: boolean) {
    this.state.sessions = this.state.sessions.map((session) =>
      session.familyId === familyId
        ? {
            ...session,
            revokedAt: session.revokedAt ?? at,
            reuseDetectedAt: reuseDetected
              ? (session.reuseDetectedAt ?? at)
              : session.reuseDetectedAt,
          }
        : session,
    );
  }

  async getProject(tenantId: string, projectId: string) {
    return clone(
      this.state.projects.find((value) => value.tenantId === tenantId && value.id === projectId) ??
        null,
    );
  }

  async listProjects(tenantId: string) {
    return clone(this.state.projects.filter((value) => value.tenantId === tenantId));
  }

  async getReviewTask(tenantId: string, projectId: string, taskId: string) {
    return clone(
      this.state.reviewTasks.find(
        (value) =>
          value.tenantId === tenantId && value.projectId === projectId && value.id === taskId,
      ) ?? null,
    );
  }

  async updateReviewTask(record: Phase9ReviewTaskRecord) {
    replaceById(this.state.reviewTasks, record);
  }

  async getFileAsset(tenantId: string, projectId: string, artifactId: string) {
    return clone(
      this.state.fileAssets.find(
        (value) =>
          value.tenantId === tenantId && value.projectId === projectId && value.id === artifactId,
      ) ?? null,
    );
  }

  async getVersionSnapshot(tenantId: string, projectId: string, versionId: string) {
    return clone(
      this.state.versionSnapshots.find(
        (value) =>
          value.tenantId === tenantId && value.projectId === projectId && value.id === versionId,
      ) ?? null,
    );
  }

  async updateVersionStatus(
    tenantId: string,
    projectId: string,
    versionId: string,
    _targetType: Phase9VersionSnapshotRecord["targetType"],
    status: Phase9VersionSnapshotRecord["status"],
  ) {
    const snapshot = this.state.versionSnapshots.find(
      (value) =>
        value.tenantId === tenantId && value.projectId === projectId && value.id === versionId,
    );
    if (snapshot !== undefined) snapshot.status = status;
  }

  async materializeAppliedVersion(
    _tenantId: string,
    _projectId: string,
    _version: Phase9VersionSnapshotRecord,
    _appliedAt: string,
  ) {}

  async getLatestForecast(tenantId: string, projectId: string, asOf: string) {
    return clone(
      this.state.forecastSnapshots
        .filter(
          (value) =>
            value.tenantId === tenantId &&
            value.projectId === projectId &&
            Date.parse(value.asOf) <= Date.parse(asOf),
        )
        .sort(
          (left, right) =>
            Date.parse(right.asOf) - Date.parse(left.asOf) || left.id.localeCompare(right.id),
        )[0] ?? null,
    );
  }

  async findIdempotency(tenantId: string, key: string) {
    return clone(
      this.state.idempotencyRecords.find(
        (value) => value.tenantId === tenantId && value.key === key,
      ) ?? null,
    );
  }

  async createIdempotency(record: Phase9IdempotencyRecord) {
    if (
      this.state.idempotencyRecords.some(
        (value) => value.tenantId === record.tenantId && value.key === record.key,
      )
    ) {
      throw new Error("Phase 9 idempotency uniqueness violation");
    }
    this.state.idempotencyRecords.push(clone(record));
  }

  async createAppliedCommand(record: Phase9AppliedCommandRecord) {
    if (
      this.state.appliedCommands.some(
        (value) =>
          value.id === record.id ||
          (value.tenantId === record.tenantId && value.idempotencyKey === record.idempotencyKey),
      )
    ) {
      throw new Error("Phase 9 applied-command uniqueness violation");
    }
    this.state.appliedCommands.push(clone(record));
  }

  async createReviewDecision(record: Phase9ReviewDecisionRecord) {
    if (
      this.state.reviewDecisions.some(
        (value) =>
          value.id === record.id ||
          (value.reviewTaskId === record.reviewTaskId && value.sourceHash === record.sourceHash),
      )
    ) {
      throw new Error("Phase 9 review-decision uniqueness violation");
    }
    this.state.reviewDecisions.push(clone(record));
  }

  async createAudit(record: Phase9AuditRecord) {
    if (this.state.auditLogs.some((value) => value.id === record.id)) {
      throw new Error("Phase 9 audit uniqueness violation");
    }
    this.state.auditLogs.push(clone(record));
  }

  async listAudit(tenantId: string, projectId: string | null) {
    return clone(
      this.state.auditLogs.filter(
        (value) =>
          value.tenantId === tenantId && (projectId === null || value.projectId === projectId),
      ),
    );
  }

  async createOutbox(record: Phase9OutboxRecord) {
    if (
      this.state.outboxEvents.some(
        (value) =>
          value.id === record.id ||
          (value.tenantId === record.tenantId && value.idempotencyKey === record.idempotencyKey),
      )
    ) {
      throw new Error("Phase 9 outbox uniqueness violation");
    }
    this.state.outboxEvents.push(clone(record));
  }

  async listDueOutbox(now: string, limit: number) {
    const staleLockCutoff = Date.parse(now) - 5 * 60_000;
    return clone(
      this.state.outboxEvents
        .filter(
          (value) =>
            ["PENDING", "FAILED"].includes(value.status) &&
            Date.parse(value.availableAt) <= Date.parse(now) &&
            (value.lockedAt === null || Date.parse(value.lockedAt) <= staleLockCutoff),
        )
        .sort(
          (left, right) =>
            Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limit),
    );
  }

  async updateOutbox(record: Phase9OutboxRecord) {
    replaceById(this.state.outboxEvents, record);
  }

  async findConsumedEvent(consumer: string, idempotencyKey: string) {
    return clone(
      this.state.consumedEvents.find(
        (value) => value.consumer === consumer && value.idempotencyKey === idempotencyKey,
      ) ?? null,
    );
  }

  async createConsumedEvent(record: Phase9ConsumedEventRecord) {
    if (
      this.state.consumedEvents.some(
        (value) =>
          value.consumer === record.consumer && value.idempotencyKey === record.idempotencyKey,
      )
    ) {
      throw new Error("Phase 9 consumed-event uniqueness violation");
    }
    this.state.consumedEvents.push(clone(record));
  }

  async createNotification(record: Phase9NotificationRecord) {
    if (
      this.state.notifications.some(
        (value) =>
          value.tenantId === record.tenantId &&
          value.eventId === record.eventId &&
          value.channel === record.channel &&
          value.userId === record.userId,
      )
    ) {
      return;
    }
    this.state.notifications.push(clone(record));
  }
}

function emptyState(): Phase9StoreState {
  return {
    tenants: [],
    users: [],
    credentials: [],
    invitations: [],
    memberships: [],
    sessions: [],
    projects: [],
    reviewTasks: [],
    fileAssets: [],
    versionSnapshots: [],
    forecastSnapshots: [],
    idempotencyRecords: [],
    appliedCommands: [],
    reviewDecisions: [],
    auditLogs: [],
    outboxEvents: [],
    consumedEvents: [],
    notifications: [],
  };
}

export class InMemoryPhase9Store implements Phase9Store {
  #state: Phase9StoreState;
  #tail: Promise<void> = Promise.resolve();

  constructor(seed: Partial<Phase9StoreState> = {}) {
    this.#state = clone({ ...emptyState(), ...seed });
  }

  async transaction<T>(work: (transaction: Phase9StoreTransaction) => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const working = clone(this.#state);
    try {
      const result = await work(new InMemoryPhase9Transaction(working));
      this.#state = working;
      return clone(result);
    } finally {
      release();
    }
  }

  async read<T>(work: (transaction: Phase9StoreTransaction) => Promise<T>): Promise<T> {
    await this.#tail;
    return clone(await work(new InMemoryPhase9Transaction(clone(this.#state))));
  }

  snapshot(): Phase9StoreState {
    return clone(this.#state);
  }
}
