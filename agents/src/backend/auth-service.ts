import { randomUUID } from "node:crypto";
import {
  Phase9ApiError,
  phase9AcceptInviteRequestSchema,
  phase9AuthenticatedPrincipalSchema,
  phase9AuthenticatedResultSchema,
  phase9InviteRequestSchema,
  phase9InviteResultSchema,
  phase9LoginRequestSchema,
  phase9LoginResultSchema,
  phase9RefreshRequestSchema,
  phase9TenantSelectionRequestSchema,
  phase9TokenPairSchema,
  phase10SessionSchema,
  type Phase9AuthenticatedPrincipal,
  type Phase9LoginResult,
} from "./contracts.js";
import { requireTenantPermission } from "./authorization.js";
import { permissionsForRole } from "./authorization.js";
import {
  MAX_TENANT_CANDIDATES,
  Phase9LoginRateLimiter,
  Phase9TokenService,
  hashPhase9Password,
  normalizePhase9Email,
  phase9DecoyPasswordHash,
  phase9Sha256,
  randomPhase9Token,
  verifyPhase9Password,
} from "./security.js";
import type {
  Phase9AuditRecord,
  Phase9CredentialRecord,
  Phase9InvitationRecord,
  Phase9RefreshSessionRecord,
  Phase9Store,
  Phase9StoreTransaction,
  Phase9UserRecord,
} from "./store.js";

export interface Phase9RequestMetadata {
  correlationId: string;
  userAgent?: string;
  ipAddress?: string;
  deviceName?: string;
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function authAudit(
  input: Readonly<{
    id: string;
    tenantId: string;
    actorUserId: string | null;
    actorRole: Phase9AuditRecord["actorRole"];
    action: string;
    entityId: string;
    correlationId: string;
    metadata: Record<string, unknown>;
    occurredAt: string;
  }>,
): Phase9AuditRecord {
  return {
    id: input.id,
    tenantId: input.tenantId,
    projectId: null,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    entityType: "IDENTITY_SESSION",
    entityId: input.entityId,
    reason: null,
    correlationId: input.correlationId,
    sourceVersion: "buildwatch-v22-phase9-auth-v1",
    beforeHash: null,
    afterHash: null,
    metadata: input.metadata,
    occurredAt: input.occurredAt,
  };
}

export class Phase9AuthService {
  constructor(
    private readonly store: Phase9Store,
    private readonly tokens: Phase9TokenService,
    private readonly limiter = new Phase9LoginRateLimiter(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  #buildTokenPair(user: Phase9UserRecord, session: Phase9RefreshSessionRecord) {
    const access = this.tokens.issueAccess({
      userId: user.id,
      tenantId: user.tenantId,
      tenantRole: user.tenantRole,
      sessionId: session.id,
      tokenVersion: user.tokenVersion,
    });
    const refresh = this.tokens.issueRefresh({
      userId: user.id,
      tenantId: user.tenantId,
      sessionId: session.id,
      familyId: session.familyId,
    });
    return {
      pair: phase9TokenPairSchema.parse({
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

  /** Signs a verified user in: creates the refresh session, clears lock state, audits. */
  async #startSession(
    transaction: Phase9StoreTransaction,
    user: Phase9UserRecord,
    credential: Phase9CredentialRecord,
    deviceName: string | null,
    metadata: Phase9RequestMetadata,
    current: Date,
  ) {
    const provisional: Phase9RefreshSessionRecord = {
      id: randomUUID(),
      tenantId: user.tenantId,
      userId: user.id,
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
    const issued = this.#buildTokenPair(user, provisional);
    const session = {
      ...provisional,
      tokenHash: issued.refreshHash,
      expiresAt: issued.refreshExpiresAt,
    };
    await transaction.createSession(session);
    await transaction.updateCredential({ ...credential, failedLoginCount: 0, lockedUntil: null });
    await transaction.updateUser({ ...user, lastLoginAt: current.toISOString() });
    await transaction.createAudit(
      authAudit({
        id: randomUUID(),
        tenantId: user.tenantId,
        actorUserId: user.id,
        actorRole: user.tenantRole,
        action: "AUTH_LOGIN_SUCCEEDED",
        entityId: session.id,
        correlationId: metadata.correlationId,
        metadata: { familyId: session.familyId, deviceName: session.deviceName },
        occurredAt: current.toISOString(),
      }),
    );
    return issued.pair;
  }

  /**
   * Verifies one password against every account that shares the email, and
   * reports which ones it unlocked.
   *
   * The order matters for privacy: the caller only ever learns which tenants an
   * email belongs to *after* proving the password. Doing it the other way --
   * asking for the organization first -- would turn the sign-in form into a
   * directory of who works where.
   */
  async #verifyCandidates(
    transaction: Phase9StoreTransaction,
    candidates: readonly Phase9UserRecord[],
    password: string,
    current: Date,
  ) {
    const matched: Array<{ user: Phase9UserRecord; credential: Phase9CredentialRecord }> = [];
    const unmatched: Phase9CredentialRecord[] = [];
    let anyLocked = false;
    let verifications = 0;

    for (const user of candidates) {
      const credential = await transaction.getCredential(user.id);
      if (credential === null || user.status !== "ACTIVE") continue;
      if (
        credential.lockedUntil !== null &&
        Date.parse(credential.lockedUntil) > current.getTime()
      ) {
        anyLocked = true;
        continue;
      }
      verifications += 1;
      if (await verifyPhase9Password(password, credential.passwordHash)) {
        matched.push({ user, credential });
      } else {
        unmatched.push(credential);
      }
    }

    // An unknown email would otherwise return without doing any scrypt work and
    // so answer measurably faster than a known one.
    if (verifications === 0) {
      await verifyPhase9Password(password, await phase9DecoyPasswordHash());
    }
    return { matched, unmatched, anyLocked };
  }

  /**
   * Counts a failed attempt only when nothing matched. A person whose email
   * exists in two tenants with different passwords signs in legitimately every
   * day; charging the other tenant's account a failure each time would lock
   * them out through normal use.
   */
  async #recordFailures(
    transaction: Phase9StoreTransaction,
    credentials: readonly Phase9CredentialRecord[],
    current: Date,
  ) {
    for (const credential of credentials) {
      const failedLoginCount = credential.failedLoginCount + 1;
      await transaction.updateCredential({
        ...credential,
        failedLoginCount,
        lockedUntil:
          failedLoginCount >= 5
            ? new Date(current.getTime() + 15 * 60_000).toISOString()
            : credential.lockedUntil,
      });
    }
  }

  async login(input: unknown, metadata: Phase9RequestMetadata): Promise<Phase9LoginResult> {
    const request = phase9LoginRequestSchema.parse(input);
    const emailNormalized = normalizePhase9Email(request.email);
    // Keyed on email and IP only. Including the tenant would let an attacker
    // multiply their allowance by varying it.
    const limiterKey = phase9Sha256(`${emailNormalized}:${metadata.ipAddress ?? "unknown"}`);
    this.limiter.assertAllowed(limiterKey);
    const deviceName = request.deviceName ?? metadata.deviceName ?? null;

    const outcome = await this.store.transaction(async (transaction) => {
      const current = this.now();
      const candidates =
        request.tenantSlug === undefined
          ? await transaction.findActiveUsersByEmail(emailNormalized, MAX_TENANT_CANDIDATES)
          : await (async () => {
              const tenant = await transaction.findTenantBySlug(request.tenantSlug!);
              if (tenant === null) return [];
              const user = await transaction.findUserByEmail(tenant.id, emailNormalized);
              return user === null ? [] : [user];
            })();

      const { matched, unmatched, anyLocked } = await this.#verifyCandidates(
        transaction,
        candidates,
        request.password,
        current,
      );

      if (matched.length === 0) {
        await this.#recordFailures(transaction, unmatched, current);
        return { ok: false as const, locked: anyLocked && unmatched.length === 0 };
      }

      if (matched.length === 1) {
        const only = matched[0]!;
        const pair = await this.#startSession(
          transaction,
          only.user,
          only.credential,
          deviceName,
          metadata,
          current,
        );
        return { ok: true as const, result: { status: "AUTHENTICATED" as const, ...pair } };
      }

      const selection = this.tokens.issueTenantSelection({
        emailNormalized,
        userIds: matched.map((entry) => entry.user.id),
      });
      const tenants = await Promise.all(
        matched.map(async (entry) => {
          const tenant = await transaction.findTenantById(entry.user.tenantId);
          return {
            tenantSlug: tenant?.slug ?? entry.user.tenantId,
            tenantName: tenant?.name ?? entry.user.tenantId,
          };
        }),
      );
      return {
        ok: true as const,
        result: {
          status: "TENANT_SELECTION_REQUIRED" as const,
          selectionToken: selection.token,
          expiresAt: selection.expiresAt.toISOString(),
          tenants,
        },
      };
    });

    if (!outcome.ok) {
      this.limiter.recordFailure(limiterKey);
      throw new Phase9ApiError(
        outcome.locked ? "AUTH_ACCOUNT_LOCKED" : "AUTH_INVALID_CREDENTIALS",
        401,
        "Invalid email or password",
      );
    }
    this.limiter.clear(limiterKey);
    return phase9LoginResultSchema.parse(outcome.result);
  }

  /**
   * Second half of sign-in when one email and password unlocked accounts in
   * several tenants. The selection token is the proof that the password was
   * already verified, so this never re-reads it.
   */
  async completeTenantSelection(input: unknown, metadata: Phase9RequestMetadata) {
    const request = phase9TenantSelectionRequestSchema.parse(input);
    const claims = this.tokens.verifyTenantSelection(request.selectionToken);

    const outcome = await this.store.transaction(async (transaction) => {
      const current = this.now();
      const tenant = await transaction.findTenantBySlug(request.tenantSlug);
      if (tenant === null) return { ok: false as const };
      const user = await transaction.findUserByEmail(tenant.id, claims.sub);
      // The chosen tenant must be one the password actually unlocked.
      if (user === null || !claims.userIds.includes(user.id) || user.status !== "ACTIVE") {
        return { ok: false as const };
      }
      const credential = await transaction.getCredential(user.id);
      if (credential === null) return { ok: false as const };
      const pair = await this.#startSession(
        transaction,
        user,
        credential,
        request.deviceName ?? metadata.deviceName ?? null,
        metadata,
        current,
      );
      return { ok: true as const, result: { status: "AUTHENTICATED" as const, ...pair } };
    });

    if (!outcome.ok) {
      throw new Phase9ApiError("AUTH_INVALID_CREDENTIALS", 401, "Invalid organization selection");
    }
    return phase9AuthenticatedResultSchema.parse(outcome.result);
  }

  async authenticateAccess(accessToken: string): Promise<Phase9AuthenticatedPrincipal> {
    const claims = this.tokens.verifyAccess(accessToken);
    const outcome = await this.store.read(async (transaction) => {
      const user = await transaction.findUserById(claims.tenantId, claims.sub);
      const session = await transaction.findSession(claims.sessionId);
      if (
        user === null ||
        user.status !== "ACTIVE" ||
        user.tokenVersion !== claims.tokenVersion ||
        session === null ||
        session.tenantId !== claims.tenantId ||
        session.userId !== claims.sub ||
        session.revokedAt !== null ||
        Date.parse(session.expiresAt) <= this.now().getTime()
      ) {
        return null;
      }
      return phase9AuthenticatedPrincipalSchema.parse({
        userId: user.id,
        tenantId: user.tenantId,
        tenantRole: user.tenantRole,
        sessionId: session.id,
        tokenVersion: user.tokenVersion,
      });
    });
    if (outcome === null) {
      throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
    }
    return outcome;
  }

  async session(principal: Phase9AuthenticatedPrincipal) {
    return this.store.read(async (transaction) => {
      const [user, memberships] = await Promise.all([
        transaction.findUserById(principal.tenantId, principal.userId),
        transaction.listMemberships(principal.tenantId, principal.userId),
      ]);
      if (user === null || user.status !== "ACTIVE") {
        throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
      }
      return phase10SessionSchema.parse({
        schemaVersion: 1,
        user: {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          displayName: user.displayName,
          tenantRole: user.tenantRole,
        },
        tenantPermissions: [...permissionsForRole(user.tenantRole)].sort(),
        projectMemberships: memberships
          .map((membership) => ({
            projectId: membership.projectId,
            role: membership.role,
            permissions: [...permissionsForRole(membership.role)].sort(),
          }))
          .sort((left, right) => left.projectId.localeCompare(right.projectId)),
      });
    });
  }

  async refresh(input: unknown, metadata: Phase9RequestMetadata) {
    const request = phase9RefreshRequestSchema.parse(input);
    const claims = this.tokens.verifyRefresh(request.refreshToken);
    const tokenHash = phase9Sha256(request.refreshToken);
    const outcome = await this.store.transaction(async (transaction) => {
      const session = await transaction.findSession(claims.sessionId);
      const current = nowIso(this.now);
      if (
        session === null ||
        session.tenantId !== claims.tenantId ||
        session.userId !== claims.sub ||
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
          authAudit({
            id: randomUUID(),
            tenantId: session.tenantId,
            actorUserId: session.userId,
            actorRole: null,
            action: "AUTH_REFRESH_REUSE_DETECTED",
            entityId: session.id,
            correlationId: metadata.correlationId,
            metadata: { familyId: session.familyId },
            occurredAt: current,
          }),
        );
        return { status: "REUSED" as const };
      }
      const user = await transaction.findUserById(session.tenantId, session.userId);
      if (user === null || user.status !== "ACTIVE") {
        return { status: "INVALID" as const };
      }
      const nextSessionId = randomUUID();
      const provisional: Phase9RefreshSessionRecord = {
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
      const issued = this.#buildTokenPair(user, provisional);
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
        authAudit({
          id: randomUUID(),
          tenantId: user.tenantId,
          actorUserId: user.id,
          actorRole: user.tenantRole,
          action: "AUTH_REFRESH_ROTATED",
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
    const request = phase9RefreshRequestSchema.parse(input);
    const claims = this.tokens.verifyRefresh(request.refreshToken);
    const tokenHash = phase9Sha256(request.refreshToken);
    await this.store.transaction(async (transaction) => {
      const session = await transaction.findSession(claims.sessionId);
      if (session === null || session.tokenHash !== tokenHash) return;
      const current = nowIso(this.now);
      await transaction.updateSession({ ...session, revokedAt: current, lastUsedAt: current });
      await transaction.createAudit(
        authAudit({
          id: randomUUID(),
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorRole: null,
          action: "AUTH_LOGOUT",
          entityId: session.id,
          correlationId: metadata.correlationId,
          metadata: {},
          occurredAt: current,
        }),
      );
    });
  }

  async invite(
    principal: Phase9AuthenticatedPrincipal,
    input: unknown,
    metadata: Phase9RequestMetadata,
  ) {
    requireTenantPermission(principal, "USER_INVITE");
    const request = phase9InviteRequestSchema.parse(input);
    const emailNormalized = normalizePhase9Email(request.email);
    const rawToken = randomPhase9Token(32);
    const tokenHash = phase9Sha256(rawToken);
    const createdAt = this.now();
    const invitation: Phase9InvitationRecord = {
      id: randomUUID(),
      tenantId: principal.tenantId,
      emailNormalized,
      role: request.role,
      projectIds: [...new Set(request.projectIds)].sort(),
      tokenHash,
      status: "PENDING",
      expiresAt: new Date(createdAt.getTime() + request.expiresInHours * 60 * 60_000).toISOString(),
      invitedByUserId: principal.userId,
      acceptedByUserId: null,
      acceptedAt: null,
      createdAt: createdAt.toISOString(),
    };
    await this.store.transaction(async (transaction) => {
      for (const projectId of invitation.projectIds) {
        if ((await transaction.getProject(principal.tenantId, projectId)) === null) {
          throw new Phase9ApiError("PROJECT_NOT_FOUND", 404, "Project not found");
        }
      }
      if ((await transaction.findUserByEmail(principal.tenantId, emailNormalized)) !== null) {
        throw new Phase9ApiError("VALIDATION_FAILED", 409, "User already exists");
      }
      await transaction.createInvitation(invitation);
      await transaction.createAudit(
        authAudit({
          id: randomUUID(),
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          actorRole: principal.tenantRole,
          action: "TENANT_INVITATION_CREATED",
          entityId: invitation.id,
          correlationId: metadata.correlationId,
          metadata: { role: invitation.role, projectIds: invitation.projectIds },
          occurredAt: createdAt.toISOString(),
        }),
      );
    });
    return phase9InviteResultSchema.parse({
      invitationId: invitation.id,
      invitationToken: rawToken,
      expiresAt: invitation.expiresAt,
    });
  }

  async acceptInvitation(input: unknown, metadata: Phase9RequestMetadata) {
    const request = phase9AcceptInviteRequestSchema.parse(input);
    const tokenHash = phase9Sha256(request.invitationToken);
    const passwordHash = await hashPhase9Password(request.password);
    const outcome = await this.store.transaction(async (transaction) => {
      const invitation = await transaction.findInvitationByTokenHash(tokenHash);
      if (invitation === null || invitation.status !== "PENDING") {
        return { status: "INVALID" as const };
      }
      const acceptedAt = nowIso(this.now);
      if (Date.parse(invitation.expiresAt) <= Date.parse(acceptedAt)) {
        await transaction.updateInvitation({ ...invitation, status: "EXPIRED" });
        return { status: "EXPIRED" as const };
      }
      if (
        (await transaction.findUserByEmail(invitation.tenantId, invitation.emailNormalized)) !==
        null
      ) {
        return { status: "INVALID" as const };
      }
      const user: Phase9UserRecord = {
        id: randomUUID(),
        tenantId: invitation.tenantId,
        email: invitation.emailNormalized,
        emailNormalized: invitation.emailNormalized,
        displayName: request.displayName,
        tenantRole: invitation.role,
        status: "ACTIVE",
        tokenVersion: 1,
        emailVerifiedAt: acceptedAt,
        lastLoginAt: null,
      };
      await transaction.createUser(user);
      await transaction.createCredential({
        userId: user.id,
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        passwordChangedAt: acceptedAt,
      });
      for (const projectId of invitation.projectIds) {
        await transaction.createMembership({
          id: randomUUID(),
          tenantId: invitation.tenantId,
          projectId,
          userId: user.id,
          role: invitation.role,
          active: true,
        });
      }
      await transaction.updateInvitation({
        ...invitation,
        status: "ACCEPTED",
        acceptedByUserId: user.id,
        acceptedAt,
      });
      await transaction.createAudit(
        authAudit({
          id: randomUUID(),
          tenantId: user.tenantId,
          actorUserId: user.id,
          actorRole: user.tenantRole,
          action: "TENANT_INVITATION_ACCEPTED",
          entityId: invitation.id,
          correlationId: metadata.correlationId,
          metadata: { projectIds: invitation.projectIds },
          occurredAt: acceptedAt,
        }),
      );
      // The invited user has to sign in next, and the login form is keyed by
      // tenant slug -- which they have no way to know from the token alone.
      const tenant = await transaction.findTenantById(invitation.tenantId);
      return {
        status: "OK" as const,
        userId: user.id,
        email: user.email,
        tenantSlug: tenant?.slug ?? null,
      };
    });
    if (outcome.status === "EXPIRED") {
      throw new Phase9ApiError("INVITATION_EXPIRED", 410, "Invitation expired");
    }
    if (outcome.status === "INVALID") {
      throw new Phase9ApiError("INVITATION_INVALID", 400, "Invalid invitation");
    }
    return {
      userId: outcome.userId,
      email: outcome.email,
      tenantSlug: outcome.tenantSlug,
    };
  }
}
