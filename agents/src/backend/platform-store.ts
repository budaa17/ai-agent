import { Prisma, type PrismaClient } from "@prisma/client";
import type { PlatformRole } from "./platform-contracts.js";

export type PlatformPrincipalStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";

export interface PlatformPrincipalRecord {
  id: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  role: PlatformRole;
  status: PlatformPrincipalStatus;
  tokenVersion: number;
  lastLoginAt: string | null;
  /** Null until a second factor is enrolled; the production gate reads this. */
  mfaEnrolledAt: string | null;
}

export interface PlatformCredentialRecord {
  principalId: string;
  passwordHash: string;
  passwordChangedAt: string;
  failedLoginCount: number;
  lockedUntil: string | null;
}

export interface PlatformRefreshSessionRecord {
  id: string;
  principalId: string;
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

export interface PlatformAuditRecord {
  id: string;
  actorPrincipalId: string | null;
  actorRole: PlatformRole | null;
  tenantId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  result: "SUCCESS" | "DENIED" | "FAILED";
  reason: string | null;
  correlationId: string;
  sourceVersion: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface PlatformStoreState {
  principals: PlatformPrincipalRecord[];
  credentials: PlatformCredentialRecord[];
  sessions: PlatformRefreshSessionRecord[];
  auditLogs: PlatformAuditRecord[];
}

export interface PlatformStoreTransaction {
  findPrincipalByEmail(emailNormalized: string): Promise<PlatformPrincipalRecord | null>;
  findPrincipalById(principalId: string): Promise<PlatformPrincipalRecord | null>;
  createPrincipal(record: PlatformPrincipalRecord): Promise<void>;
  updatePrincipal(record: PlatformPrincipalRecord): Promise<void>;
  getCredential(principalId: string): Promise<PlatformCredentialRecord | null>;
  createCredential(record: PlatformCredentialRecord): Promise<void>;
  updateCredential(record: PlatformCredentialRecord): Promise<void>;
  createSession(record: PlatformRefreshSessionRecord): Promise<void>;
  findSession(sessionId: string): Promise<PlatformRefreshSessionRecord | null>;
  updateSession(record: PlatformRefreshSessionRecord): Promise<void>;
  revokeSessionFamily(familyId: string, at: string, reuseDetected: boolean): Promise<void>;
  createAudit(record: PlatformAuditRecord): Promise<void>;
}

export interface PlatformStore {
  transaction<T>(work: (transaction: PlatformStoreTransaction) => Promise<T>): Promise<T>;
  read<T>(work: (transaction: PlatformStoreTransaction) => Promise<T>): Promise<T>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function replaceByKey<T>(values: T[], record: T, key: (value: T) => string): void {
  const index = values.findIndex((candidate) => key(candidate) === key(record));
  if (index < 0) throw new Error(`Record ${key(record)} does not exist`);
  values[index] = clone(record);
}

class InMemoryPlatformStoreTransaction implements PlatformStoreTransaction {
  constructor(private readonly state: PlatformStoreState) {}

  async findPrincipalByEmail(emailNormalized: string) {
    return clone(
      this.state.principals.find((value) => value.emailNormalized === emailNormalized) ?? null,
    );
  }

  async findPrincipalById(principalId: string) {
    return clone(this.state.principals.find((value) => value.id === principalId) ?? null);
  }

  async createPrincipal(record: PlatformPrincipalRecord) {
    if (
      this.state.principals.some(
        (value) => value.id === record.id || value.emailNormalized === record.emailNormalized,
      )
    ) {
      throw new Error("Platform principal already exists");
    }
    this.state.principals.push(clone(record));
  }

  async updatePrincipal(record: PlatformPrincipalRecord) {
    replaceByKey(this.state.principals, record, (value) => value.id);
  }

  async getCredential(principalId: string) {
    return clone(this.state.credentials.find((value) => value.principalId === principalId) ?? null);
  }

  async createCredential(record: PlatformCredentialRecord) {
    if (this.state.credentials.some((value) => value.principalId === record.principalId)) {
      throw new Error("Platform credential already exists");
    }
    this.state.credentials.push(clone(record));
  }

  async updateCredential(record: PlatformCredentialRecord) {
    replaceByKey(this.state.credentials, record, (value) => value.principalId);
  }

  async createSession(record: PlatformRefreshSessionRecord) {
    if (
      this.state.sessions.some(
        (value) => value.id === record.id || value.tokenHash === record.tokenHash,
      )
    ) {
      throw new Error("Platform refresh session already exists");
    }
    this.state.sessions.push(clone(record));
  }

  async findSession(sessionId: string) {
    return clone(this.state.sessions.find((value) => value.id === sessionId) ?? null);
  }

  async updateSession(record: PlatformRefreshSessionRecord) {
    replaceByKey(this.state.sessions, record, (value) => value.id);
  }

  async revokeSessionFamily(familyId: string, at: string, reuseDetected: boolean) {
    for (const session of this.state.sessions) {
      if (session.familyId !== familyId) continue;
      session.revokedAt ??= at;
      if (reuseDetected) session.reuseDetectedAt ??= at;
    }
  }

  async createAudit(record: PlatformAuditRecord) {
    if (this.state.auditLogs.some((value) => value.id === record.id)) {
      throw new Error("Platform audit already exists");
    }
    this.state.auditLogs.push(clone(record));
  }
}

function emptyState(): PlatformStoreState {
  return { principals: [], credentials: [], sessions: [], auditLogs: [] };
}

export class InMemoryPlatformStore implements PlatformStore {
  #state: PlatformStoreState;
  #tail: Promise<void> = Promise.resolve();

  constructor(seed: Partial<PlatformStoreState> = {}) {
    this.#state = clone({ ...emptyState(), ...seed });
  }

  async transaction<T>(work: (transaction: PlatformStoreTransaction) => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const working = clone(this.#state);
    try {
      const result = await work(new InMemoryPlatformStoreTransaction(working));
      this.#state = working;
      return clone(result);
    } finally {
      release();
    }
  }

  async read<T>(work: (transaction: PlatformStoreTransaction) => Promise<T>): Promise<T> {
    await this.#tail;
    return clone(await work(new InMemoryPlatformStoreTransaction(clone(this.#state))));
  }

  snapshot(): PlatformStoreState {
    return clone(this.#state);
  }
}

type PlatformPrismaClient = Prisma.TransactionClient;

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function principalRecord(value: {
  id: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  role: PlatformRole;
  status: PlatformPrincipalStatus;
  tokenVersion: number;
  lastLoginAt: Date | null;
  mfaEnrolledAt: Date | null;
}): PlatformPrincipalRecord {
  return { ...value, lastLoginAt: iso(value.lastLoginAt), mfaEnrolledAt: iso(value.mfaEnrolledAt) };
}

function credentialRecord(value: {
  principalId: string;
  passwordHash: string;
  passwordChangedAt: Date;
  failedLoginCount: number;
  lockedUntil: Date | null;
}): PlatformCredentialRecord {
  return {
    ...value,
    passwordChangedAt: value.passwordChangedAt.toISOString(),
    lockedUntil: iso(value.lockedUntil),
  };
}

function sessionRecord(value: {
  id: string;
  principalId: string;
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
}): PlatformRefreshSessionRecord {
  return {
    ...value,
    expiresAt: value.expiresAt.toISOString(),
    lastUsedAt: iso(value.lastUsedAt),
    revokedAt: iso(value.revokedAt),
    reuseDetectedAt: iso(value.reuseDetectedAt),
    createdAt: value.createdAt.toISOString(),
  };
}

class PrismaPlatformStoreTransaction implements PlatformStoreTransaction {
  constructor(private readonly client: PlatformPrismaClient) {}

  async findPrincipalByEmail(emailNormalized: string) {
    const value = await this.client.platformPrincipal.findUnique({ where: { emailNormalized } });
    return value === null ? null : principalRecord(value);
  }

  async findPrincipalById(principalId: string) {
    const value = await this.client.platformPrincipal.findUnique({ where: { id: principalId } });
    return value === null ? null : principalRecord(value);
  }

  async createPrincipal(record: PlatformPrincipalRecord) {
    await this.client.platformPrincipal.create({
      data: {
        id: record.id,
        email: record.email,
        emailNormalized: record.emailNormalized,
        displayName: record.displayName,
        role: record.role,
        status: record.status,
        tokenVersion: record.tokenVersion,
        lastLoginAt: record.lastLoginAt === null ? null : new Date(record.lastLoginAt),
        mfaEnrolledAt: record.mfaEnrolledAt === null ? null : new Date(record.mfaEnrolledAt),
      },
    });
  }

  async updatePrincipal(record: PlatformPrincipalRecord) {
    await this.client.platformPrincipal.update({
      where: { id: record.id },
      data: {
        email: record.email,
        emailNormalized: record.emailNormalized,
        displayName: record.displayName,
        role: record.role,
        status: record.status,
        tokenVersion: record.tokenVersion,
        lastLoginAt: record.lastLoginAt === null ? null : new Date(record.lastLoginAt),
        mfaEnrolledAt: record.mfaEnrolledAt === null ? null : new Date(record.mfaEnrolledAt),
      },
    });
  }

  async getCredential(principalId: string) {
    const value = await this.client.platformCredential.findUnique({ where: { principalId } });
    return value === null ? null : credentialRecord(value);
  }

  async createCredential(record: PlatformCredentialRecord) {
    await this.client.platformCredential.create({
      data: {
        principalId: record.principalId,
        passwordHash: record.passwordHash,
        passwordChangedAt: new Date(record.passwordChangedAt),
        failedLoginCount: record.failedLoginCount,
        lockedUntil: record.lockedUntil === null ? null : new Date(record.lockedUntil),
      },
    });
  }

  async updateCredential(record: PlatformCredentialRecord) {
    await this.client.platformCredential.update({
      where: { principalId: record.principalId },
      data: {
        passwordHash: record.passwordHash,
        passwordChangedAt: new Date(record.passwordChangedAt),
        failedLoginCount: record.failedLoginCount,
        lockedUntil: record.lockedUntil === null ? null : new Date(record.lockedUntil),
      },
    });
  }

  async createSession(record: PlatformRefreshSessionRecord) {
    await this.client.platformRefreshSession.create({
      data: {
        id: record.id,
        principalId: record.principalId,
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
    const value = await this.client.platformRefreshSession.findUnique({
      where: { id: sessionId },
    });
    return value === null ? null : sessionRecord(value);
  }

  async updateSession(record: PlatformRefreshSessionRecord) {
    await this.client.platformRefreshSession.update({
      where: { id: record.id },
      data: {
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
      },
    });
  }

  async revokeSessionFamily(familyId: string, at: string, reuseDetected: boolean) {
    await this.client.platformRefreshSession.updateMany({
      where: { familyId },
      data: {
        revokedAt: new Date(at),
        ...(reuseDetected ? { reuseDetectedAt: new Date(at) } : {}),
      },
    });
  }

  async createAudit(record: PlatformAuditRecord) {
    await this.client.platformAuditLog.create({
      data: {
        id: record.id,
        actorPrincipalId: record.actorPrincipalId,
        actorRole: record.actorRole,
        tenantId: record.tenantId,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        result: record.result,
        reason: record.reason,
        correlationId: record.correlationId,
        sourceVersion: record.sourceVersion,
        beforeHash: record.beforeHash,
        afterHash: record.afterHash,
        metadata: record.metadata as Prisma.InputJsonValue,
        occurredAt: new Date(record.occurredAt),
      },
    });
  }
}

export class PrismaPlatformStore implements PlatformStore {
  constructor(private readonly client: PrismaClient) {}

  transaction<T>(work: (transaction: PlatformStoreTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction(
      (transaction) => work(new PrismaPlatformStoreTransaction(transaction)),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 20_000,
      },
    );
  }

  read<T>(work: (transaction: PlatformStoreTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction((transaction) =>
      work(new PrismaPlatformStoreTransaction(transaction)),
    );
  }
}
