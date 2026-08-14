import { randomUUID } from "node:crypto";
import { Phase9ApiError } from "./contracts.js";
import type { Phase9RequestMetadata } from "./auth-service.js";
import { platformPermissionsForRole } from "./platform-authorization.js";
import {
  platformAuthenticatedPrincipalSchema,
  platformLoginRequestSchema,
  platformRefreshRequestSchema,
  platformSessionSchema,
  platformTokenPairSchema,
  type PlatformAuthenticatedPrincipal,
  type PlatformRole,
} from "./platform-contracts.js";
import { PlatformTokenService } from "./platform-security.js";
import {
  Phase9LoginRateLimiter,
  normalizePhase9Email,
  phase9DecoyPasswordHash,
  phase9Sha256,
  verifyPhase9Password,
} from "./security.js";
import type {
  PlatformAuditRecord,
  PlatformCredentialRecord,
  PlatformPrincipalRecord,
  PlatformRefreshSessionRecord,
  PlatformStore,
  PlatformStoreTransaction,
} from "./platform-store.js";

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function platformAuthAudit(
  input: Readonly<{
    id: string;
    actorPrincipalId: string | null;
    actorRole: PlatformRole | null;
    action: string;
    entityId: string;
    result?: PlatformAuditRecord["result"];
    correlationId: string;
    metadata?: Record<string, unknown>;
    occurredAt: string;
  }>,
): PlatformAuditRecord {
  return {
    id: input.id,
    actorPrincipalId: input.actorPrincipalId,
    actorRole: input.actorRole,
    tenantId: null,
    action: input.action,
    entityType: "PLATFORM_IDENTITY_SESSION",
    entityId: input.entityId,
    result: input.result ?? "SUCCESS",
    reason: null,
    correlationId: input.correlationId,
    sourceVersion: "buildwatch-platform-auth-v1",
    beforeHash: null,
    afterHash: null,
    metadata: input.metadata ?? {},
    occurredAt: input.occurredAt,
  };
}

export class PlatformAuthService {
  constructor(
    private readonly store: PlatformStore,
    private readonly tokens: PlatformTokenService,
    private readonly limiter = new Phase9LoginRateLimiter(),
    private readonly now: () => Date = () => new Date(),
    /**
     * Production release gate. While true, a platform principal without an
     * enrolled second factor cannot sign in at all — the console cannot reach
     * production on password-only platform authentication.
     */
    private readonly requireMfa = false,
  ) {}

  #buildTokenPair(principal: PlatformPrincipalRecord, session: PlatformRefreshSessionRecord) {
    const access = this.tokens.issueAccess({
      principalId: principal.id,
      platformRole: principal.role,
      sessionId: session.id,
      tokenVersion: principal.tokenVersion,
    });
    const refresh = this.tokens.issueRefresh({
      principalId: principal.id,
      sessionId: session.id,
      familyId: session.familyId,
    });
    return {
      pair: platformTokenPairSchema.parse({
        tokenType: "Bearer",
        accessToken: access.token,
        accessExpiresAt: access.expiresAt.toISOString(),
        refreshToken: refresh.token,
        refreshExpiresAt: refresh.expiresAt.toISOString(),
      }),
      refreshHash: phase9Sha256(refresh.token),
      refreshExpiresAt: refresh.expiresAt.toISOString(),
    };
  }

  async #startSession(
    transaction: PlatformStoreTransaction,
    principal: PlatformPrincipalRecord,
    credential: PlatformCredentialRecord,
    deviceName: string | null,
    metadata: Phase9RequestMetadata,
    current: Date,
  ) {
    const provisional: PlatformRefreshSessionRecord = {
      id: randomUUID(),
      principalId: principal.id,
      familyId: randomUUID(),
      tokenHash: "pending",
      parentSessionId: null,
      replacedById: null,
      deviceName,
      userAgent: metadata.userAgent ?? null,
      ipAddressHash: metadata.ipAddress === undefined ? null : phase9Sha256(metadata.ipAddress),
      expiresAt: current.toISOString(),
      lastUsedAt: current.toISOString(),
      revokedAt: null,
      reuseDetectedAt: null,
      createdAt: current.toISOString(),
    };
    const issued = this.#buildTokenPair(principal, provisional);
    const session = {
      ...provisional,
      tokenHash: issued.refreshHash,
      expiresAt: issued.refreshExpiresAt,
    };
    await transaction.createSession(session);
    await transaction.updateCredential({ ...credential, failedLoginCount: 0, lockedUntil: null });
    await transaction.updatePrincipal({ ...principal, lastLoginAt: current.toISOString() });
    await transaction.createAudit(
      platformAuthAudit({
        id: randomUUID(),
        actorPrincipalId: principal.id,
        actorRole: principal.role,
        action: "PLATFORM_AUTH_LOGIN_SUCCEEDED",
        entityId: session.id,
        correlationId: metadata.correlationId,
        metadata: { familyId: session.familyId, deviceName: session.deviceName },
        occurredAt: current.toISOString(),
      }),
    );
    return issued.pair;
  }

  async login(input: unknown, metadata: Phase9RequestMetadata) {
    const request = platformLoginRequestSchema.parse(input);
    const emailNormalized = normalizePhase9Email(request.email);
    const limiterKey = phase9Sha256(`${emailNormalized}:${metadata.ipAddress ?? "unknown"}`);
    this.limiter.assertAllowed(limiterKey);

    const outcome = await this.store.transaction(async (transaction) => {
      const current = this.now();
      const principal = await transaction.findPrincipalByEmail(emailNormalized);
      const credential = principal === null ? null : await transaction.getCredential(principal.id);
      if (principal === null || credential === null || principal.status !== "ACTIVE") {
        await verifyPhase9Password(request.password, await phase9DecoyPasswordHash());
        return { status: "INVALID" as const };
      }
      if (
        credential.lockedUntil !== null &&
        Date.parse(credential.lockedUntil) > current.getTime()
      ) {
        return { status: "LOCKED" as const };
      }
      if (!(await verifyPhase9Password(request.password, credential.passwordHash))) {
        const failedLoginCount = credential.failedLoginCount + 1;
        await transaction.updateCredential({
          ...credential,
          failedLoginCount,
          lockedUntil:
            failedLoginCount >= 5
              ? new Date(current.getTime() + 15 * 60_000).toISOString()
              : credential.lockedUntil,
        });
        return { status: "INVALID" as const };
      }
      // Checked only after the password verified, so the gate cannot be used to
      // probe which platform accounts exist.
      if (this.requireMfa && principal.mfaEnrolledAt === null) {
        return { status: "MFA_REQUIRED" as const, principalId: principal.id, role: principal.role };
      }
      return {
        status: "OK" as const,
        pair: await this.#startSession(
          transaction,
          principal,
          credential,
          request.deviceName ?? metadata.deviceName ?? null,
          metadata,
          current,
        ),
      };
    });

    if (outcome.status === "MFA_REQUIRED") {
      this.limiter.clear(limiterKey);
      await this.store.transaction(async (transaction) => {
        await transaction.createAudit({
          id: randomUUID(),
          actorPrincipalId: outcome.principalId,
          actorRole: outcome.role,
          tenantId: null,
          action: "PLATFORM_LOGIN",
          entityType: "PLATFORM_PRINCIPAL",
          entityId: outcome.principalId,
          result: "DENIED",
          reason: "Multi-factor enrolment is required for platform sign-in",
          correlationId: metadata.correlationId,
          sourceVersion: "platform-auth.v1",
          beforeHash: null,
          afterHash: null,
          metadata: { gate: "PLATFORM_MFA_REQUIRED" },
          occurredAt: this.now().toISOString(),
        });
      });
      throw new Phase9ApiError(
        "AUTH_FORBIDDEN",
        403,
        "Platform sign-in requires an enrolled second factor",
      );
    }
    if (outcome.status !== "OK") {
      this.limiter.recordFailure(limiterKey);
      throw new Phase9ApiError(
        outcome.status === "LOCKED" ? "AUTH_ACCOUNT_LOCKED" : "AUTH_INVALID_CREDENTIALS",
        401,
        "Invalid email or password",
      );
    }
    this.limiter.clear(limiterKey);
    return outcome.pair;
  }

  async authenticateAccess(accessToken: string): Promise<PlatformAuthenticatedPrincipal> {
    const claims = this.tokens.verifyAccess(accessToken);
    const principal = await this.store.read(async (transaction) => {
      const [candidate, session] = await Promise.all([
        transaction.findPrincipalById(claims.sub),
        transaction.findSession(claims.sessionId),
      ]);
      if (
        candidate === null ||
        candidate.status !== "ACTIVE" ||
        candidate.tokenVersion !== claims.tokenVersion ||
        candidate.role !== claims.platformRole ||
        session === null ||
        session.principalId !== claims.sub ||
        session.revokedAt !== null ||
        Date.parse(session.expiresAt) <= this.now().getTime()
      ) {
        return null;
      }
      return platformAuthenticatedPrincipalSchema.parse({
        principalKind: "PLATFORM",
        principalId: candidate.id,
        platformRole: candidate.role,
        sessionId: session.id,
        tokenVersion: candidate.tokenVersion,
      });
    });
    if (principal === null) {
      throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
    }
    return principal;
  }

  async session(authenticated: PlatformAuthenticatedPrincipal) {
    return this.store.read(async (transaction) => {
      const principal = await transaction.findPrincipalById(authenticated.principalId);
      if (principal === null || principal.status !== "ACTIVE") {
        throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
      }
      return platformSessionSchema.parse({
        schemaVersion: 1,
        principal: {
          principalKind: "PLATFORM",
          id: principal.id,
          email: principal.email,
          displayName: principal.displayName,
          role: principal.role,
        },
        permissions: [...platformPermissionsForRole(principal.role)].sort(),
      });
    });
  }

  async refresh(input: unknown, metadata: Phase9RequestMetadata) {
    const request = platformRefreshRequestSchema.parse(input);
    const claims = this.tokens.verifyRefresh(request.refreshToken);
    const tokenHash = phase9Sha256(request.refreshToken);
    const outcome = await this.store.transaction(async (transaction) => {
      const session = await transaction.findSession(claims.sessionId);
      const current = nowIso(this.now);
      if (
        session === null ||
        session.principalId !== claims.sub ||
        session.familyId !== claims.familyId ||
        session.tokenHash !== tokenHash
      ) {
        return { status: "INVALID" as const };
      }
      if (
        session.revokedAt !== null ||
        session.replacedById !== null ||
        Date.parse(session.expiresAt) <= Date.parse(current)
      ) {
        await transaction.revokeSessionFamily(session.familyId, current, true);
        await transaction.createAudit(
          platformAuthAudit({
            id: randomUUID(),
            actorPrincipalId: session.principalId,
            actorRole: null,
            action: "PLATFORM_AUTH_REFRESH_REUSE_DETECTED",
            entityId: session.id,
            result: "DENIED",
            correlationId: metadata.correlationId,
            metadata: { familyId: session.familyId },
            occurredAt: current,
          }),
        );
        return { status: "REUSED" as const };
      }
      const principal = await transaction.findPrincipalById(session.principalId);
      if (principal === null || principal.status !== "ACTIVE") {
        return { status: "INVALID" as const };
      }
      const nextSessionId = randomUUID();
      const provisional: PlatformRefreshSessionRecord = {
        ...session,
        id: nextSessionId,
        tokenHash: "pending",
        parentSessionId: session.id,
        replacedById: null,
        deviceName: metadata.deviceName ?? session.deviceName,
        userAgent: metadata.userAgent ?? session.userAgent,
        ipAddressHash:
          metadata.ipAddress === undefined
            ? session.ipAddressHash
            : phase9Sha256(metadata.ipAddress),
        expiresAt: current,
        lastUsedAt: current,
        revokedAt: null,
        reuseDetectedAt: null,
        createdAt: current,
      };
      const issued = this.#buildTokenPair(principal, provisional);
      await transaction.updateSession({
        ...session,
        replacedById: nextSessionId,
        revokedAt: current,
        lastUsedAt: current,
      });
      await transaction.createSession({
        ...provisional,
        tokenHash: issued.refreshHash,
        expiresAt: issued.refreshExpiresAt,
      });
      await transaction.createAudit(
        platformAuthAudit({
          id: randomUUID(),
          actorPrincipalId: principal.id,
          actorRole: principal.role,
          action: "PLATFORM_AUTH_REFRESH_ROTATED",
          entityId: nextSessionId,
          correlationId: metadata.correlationId,
          metadata: { familyId: session.familyId, previousSessionId: session.id },
          occurredAt: current,
        }),
      );
      return { status: "OK" as const, pair: issued.pair };
    });

    if (outcome.status === "REUSED") {
      throw new Phase9ApiError("AUTH_REFRESH_REUSED", 401, "Refresh token reuse detected");
    }
    if (outcome.status === "INVALID") {
      throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
    }
    return outcome.pair;
  }

  async logout(input: unknown, metadata: Phase9RequestMetadata): Promise<void> {
    const request = platformRefreshRequestSchema.parse(input);
    const claims = this.tokens.verifyRefresh(request.refreshToken);
    const tokenHash = phase9Sha256(request.refreshToken);
    await this.store.transaction(async (transaction) => {
      const session = await transaction.findSession(claims.sessionId);
      if (
        session === null ||
        session.principalId !== claims.sub ||
        session.tokenHash !== tokenHash
      ) {
        return;
      }
      const current = nowIso(this.now);
      await transaction.updateSession({ ...session, revokedAt: current, lastUsedAt: current });
      const principal = await transaction.findPrincipalById(session.principalId);
      await transaction.createAudit(
        platformAuthAudit({
          id: randomUUID(),
          actorPrincipalId: session.principalId,
          actorRole: principal?.role ?? null,
          action: "PLATFORM_AUTH_LOGOUT",
          entityId: session.id,
          correlationId: metadata.correlationId,
          occurredAt: current,
        }),
      );
    });
  }
}
