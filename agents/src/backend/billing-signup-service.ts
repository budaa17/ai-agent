import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { BillingInterval, BillingProviderKind } from "./billing-contracts.js";
import {
  buildEntitlementSnapshotFromPlanRows,
  serializeEntitlementSnapshot,
} from "./billing-contracts.js";
import type { BillingCheckoutService } from "./billing-checkout-service.js";
import { BillingProviderError } from "./billing-provider.js";
import type { ProviderSubscription, VerifiedBillingEvent } from "./billing-provider.js";
import type { SubscriptionProvisioner } from "./billing-webhook-service.js";
import { hashPhase9Password, normalizePhase9Email, phase9Sha256 } from "./security.js";
import { Phase9ApiError } from "./contracts.js";
import { billingMailTemplates, type Mailer } from "./mailer.js";

/**
 * Public company signup and atomic provisioning
 * (landing-page-roadmap.md §20.1, §20.4, §20.5, Phase 5).
 *
 * A visitor never creates a workspace. They create an *intent*: a short-lived
 * record holding what they asked for. Only a verified payment turns that intent
 * into a tenant, and it does so in a single transaction so a retried webhook
 * cannot leave a half-built company behind.
 *
 * No password is accepted before payment. After provisioning the new Company
 * Admin receives a one-time setup token, stored only as a hash.
 */

export const companySignupRequestSchema = z
  .object({
    companyName: z.string().trim().min(2).max(200),
    desiredSlug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slug must be lower-case letters, digits and dashes"),
    adminEmail: z.string().trim().email().max(320),
    adminDisplayName: z.string().trim().min(2).max(200),
    planCode: z.string().trim().min(2).max(60),
    interval: z.enum(["MONTH", "YEAR"]),
  })
  .strict();

export type CompanySignupRequest = z.infer<typeof companySignupRequestSchema>;

export type CompanySignupPublicStatus = "PENDING" | "CONFIRMING" | "ACTIVE" | "FAILED" | "EXPIRED";

export interface CompanySignupCreated {
  readonly signupIntentId: string;
  readonly status: CompanySignupPublicStatus;
  /**
   * Returned only outside production, mirroring how tenant invitations already
   * hand back their token. Production delivers it by email once an SMTP
   * integration exists.
   */
  readonly verificationCode?: string;
}

export interface CompanySignupVerificationSent {
  readonly status: "PENDING";
  readonly retryAfterSeconds: number;
  /** Development/test fallback only; production always delivers by email. */
  readonly verificationCode?: string;
}

export const companyAccountSetupRequestSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(200),
    setupToken: z.string().trim().min(32).max(1_024),
    password: z.string().min(12).max(200),
  })
  .strict();

export interface CompanySignupServiceOptions {
  readonly client: PrismaClient;
  readonly checkout: BillingCheckoutService;
  readonly provider: BillingProviderKind;
  readonly successUrl: string;
  /** Public origin used to build the links that go into email. */
  readonly publicBaseUrl: string;
  /** Independent server secret used to make a six-digit code safe at rest. */
  readonly verificationSecret: string;
  readonly mailer?: Mailer;
  readonly nodeEnv: "development" | "test" | "production";
  readonly intentTtlMs?: number;
  readonly setupTokenTtlMs?: number;
  readonly verificationCodeTtlMs?: number;
  readonly verificationResendCooldownMs?: number;
  readonly verificationMaxAttempts?: number;
  readonly now?: () => Date;
  readonly logger?: { warn(event: string, fields?: Record<string, unknown>): void };
}

const DEFAULT_INTENT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1_000;
const DEFAULT_VERIFICATION_CODE_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1_000;
const DEFAULT_VERIFICATION_MAX_ATTEMPTS = 5;
const RESERVED_SLUGS = new Set(["admin", "api", "platform", "www", "app", "billing", "public"]);

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Six digits are easy to type; randomInt uses the operating system CSPRNG. */
export function newEmailVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * A plain SHA-256 hash is not enough for a six-digit value: all one million
 * possibilities can be enumerated cheaply after a database leak. HMAC binds
 * the value to an independent server secret and to this exact signup intent.
 */
export function hashEmailVerificationCode(
  secret: string,
  signupIntentId: string,
  code: string,
): string {
  return createHmac("sha256", secret).update(`${signupIntentId}:${code}`, "utf8").digest("hex");
}

const emailVerificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/u);

export class CompanySignupService implements SubscriptionProvisioner {
  readonly #client: PrismaClient;
  readonly #checkout: BillingCheckoutService;
  readonly #provider: BillingProviderKind;
  readonly #successUrl: string;
  readonly #publicBaseUrl: string;
  readonly #verificationSecret: string;
  readonly #mailer: Mailer | undefined;
  readonly #nodeEnv: CompanySignupServiceOptions["nodeEnv"];
  readonly #exposeVerificationCode: boolean;
  readonly #intentTtlMs: number;
  readonly #setupTokenTtlMs: number;
  readonly #verificationCodeTtlMs: number;
  readonly #verificationResendCooldownMs: number;
  readonly #verificationMaxAttempts: number;
  readonly #now: () => Date;
  readonly #logger: CompanySignupServiceOptions["logger"];

  constructor(options: CompanySignupServiceOptions) {
    this.#client = options.client;
    this.#checkout = options.checkout;
    this.#provider = options.provider;
    this.#successUrl = options.successUrl;
    this.#publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, "");
    if (Buffer.byteLength(options.verificationSecret, "utf8") < 32) {
      throw new Error("Company signup verification secret must contain at least 32 bytes");
    }
    this.#verificationSecret = options.verificationSecret;
    this.#mailer = options.mailer;
    this.#nodeEnv = options.nodeEnv;
    // The fallback code exists only for a developer with no SMTP transport.
    // Merely running NODE_ENV=development must never duplicate a real emailed
    // credential into the HTTP response/UI.
    this.#exposeVerificationCode =
      this.#nodeEnv !== "production" &&
      (this.#mailer === undefined || this.#mailer.kind === "logging");
    if (this.#nodeEnv === "production" && this.#mailer === undefined) {
      throw new Error("Production company signup requires a mail transport");
    }
    this.#intentTtlMs = options.intentTtlMs ?? DEFAULT_INTENT_TTL_MS;
    this.#setupTokenTtlMs = options.setupTokenTtlMs ?? DEFAULT_SETUP_TOKEN_TTL_MS;
    this.#verificationCodeTtlMs = options.verificationCodeTtlMs ?? DEFAULT_VERIFICATION_CODE_TTL_MS;
    this.#verificationResendCooldownMs =
      options.verificationResendCooldownMs ?? DEFAULT_VERIFICATION_RESEND_COOLDOWN_MS;
    this.#verificationMaxAttempts =
      options.verificationMaxAttempts ?? DEFAULT_VERIFICATION_MAX_ATTEMPTS;
    this.#now = options.now ?? (() => new Date());
    this.#logger = options.logger;
  }

  // -------------------------------------------------------------------------
  // Public signup
  // -------------------------------------------------------------------------

  async createIntent(input: unknown): Promise<CompanySignupCreated> {
    const request = companySignupRequestSchema.parse(input);
    if (RESERVED_SLUGS.has(request.desiredSlug)) {
      throw new Phase9ApiError("VALIDATION_FAILED", 400, "That workspace address is reserved");
    }

    const plan = await this.#requirePublicPlan(request.planCode, request.interval);
    const adminEmailNormalized = normalizePhase9Email(request.adminEmail);
    const now = this.#now();

    // Submitting the same form twice returns the same intent rather than
    // scattering half-finished signups, and keeps the response identical whether
    // or not the address is already in use (§24.2 enumeration).
    const idempotencyKeyHash = phase9Sha256(
      [adminEmailNormalized, request.desiredSlug, plan.id].join("|"),
    );
    const existing = await this.#client.companySignupIntent.findFirst({
      where: {
        idempotencyKeyHash,
        status: { in: ["PENDING_VERIFICATION", "VERIFIED", "CHECKOUT_STARTED"] },
        expiresAt: { gt: now },
      },
      select: { id: true, status: true },
    });
    if (existing !== null) {
      return { signupIntentId: existing.id, status: this.#publicStatus(existing.status) };
    }

    const code = newEmailVerificationCode();
    const intentId = randomUUID();
    const intent = await this.#client.companySignupIntent.create({
      data: {
        id: intentId,
        companyName: request.companyName,
        desiredSlug: request.desiredSlug,
        adminEmail: request.adminEmail,
        adminEmailNormalized,
        adminDisplayName: request.adminDisplayName,
        planId: plan.id,
        provider: this.#provider,
        status: "PENDING_VERIFICATION",
        expiresAt: new Date(now.getTime() + this.#intentTtlMs),
        idempotencyKeyHash,
        // Only a server-secret HMAC is persisted; the six-digit code is never stored.
        emailVerificationTokenHash: hashEmailVerificationCode(
          this.#verificationSecret,
          intentId,
          code,
        ),
        emailVerificationExpiresAt: new Date(now.getTime() + this.#verificationCodeTtlMs),
        emailVerificationSentAt: now,
        emailVerificationAttemptCount: 0,
      },
      select: { id: true },
    });

    try {
      await this.#mailer?.send({
        to: request.adminEmail,
        required: true,
        ...billingMailTemplates.verifySignup({
          companyName: request.companyName,
          verificationCode: code,
          expiresInMinutes: Math.round(this.#verificationCodeTtlMs / 60_000),
        }),
      });
    } catch {
      // No money or workspace exists yet, so a failed first delivery can safely
      // remove this intent and let the visitor retry with the same details.
      await this.#client.companySignupIntent.deleteMany({
        where: { id: intent.id, status: "PENDING_VERIFICATION" },
      });
      throw new Phase9ApiError(
        "INTERNAL_ERROR",
        503,
        "Verification email could not be delivered. Please try again.",
      );
    }

    return {
      signupIntentId: intent.id,
      status: "PENDING",
      ...(this.#exposeVerificationCode ? { verificationCode: code } : {}),
    };
  }

  /**
   * A single atomic compare-and-set: the token hash is part of the WHERE clause
   * and is cleared by the same statement, so a link works exactly once even if
   * two requests arrive together.
   */
  async verifyEmail(
    signupIntentId: string,
    codeInput: string,
  ): Promise<{ status: CompanySignupPublicStatus }> {
    const now = this.#now();
    const parsedCode = emailVerificationCodeSchema.safeParse(codeInput);
    const code = parsedCode.success ? parsedCode.data : "invalid";
    const updated = await this.#client.companySignupIntent.updateMany({
      where: {
        id: signupIntentId,
        status: "PENDING_VERIFICATION",
        expiresAt: { gt: now },
        emailVerificationExpiresAt: { gt: now },
        emailVerificationAttemptCount: { lt: this.#verificationMaxAttempts },
        emailVerificationTokenHash: hashEmailVerificationCode(
          this.#verificationSecret,
          signupIntentId,
          code,
        ),
      },
      data: {
        status: "VERIFIED",
        emailVerifiedAt: now,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    });
    if (updated.count !== 1) {
      // Verification succeeded on a previous request but checkout/response
      // failed afterwards. Retrying the same screen must remain idempotent and
      // must not consume another attempt or falsely report the one-time code as
      // invalid.
      const alreadyVerified = await this.#client.companySignupIntent.findUnique({
        where: { id: signupIntentId },
        select: { status: true, expiresAt: true },
      });
      if (
        alreadyVerified !== null &&
        alreadyVerified.expiresAt.getTime() > now.getTime() &&
        ["VERIFIED", "CHECKOUT_STARTED", "COMPLETED"].includes(alreadyVerified.status)
      ) {
        return { status: this.#publicStatus(alreadyVerified.status) };
      }
      // Count malformed, wrong and expired-code attempts identically. This
      // avoids an oracle and closes the intent after a small online budget.
      await this.#client.companySignupIntent.updateMany({
        where: {
          id: signupIntentId,
          status: "PENDING_VERIFICATION",
          expiresAt: { gt: now },
          emailVerificationAttemptCount: { lt: this.#verificationMaxAttempts },
        },
        data: { emailVerificationAttemptCount: { increment: 1 } },
      });
      throw new Phase9ApiError(
        "INVITATION_INVALID",
        400,
        "Verification code is invalid or expired",
      );
    }
    return { status: "PENDING" };
  }

  async resendVerificationCode(signupIntentId: string): Promise<CompanySignupVerificationSent> {
    const now = this.#now();
    const intent = await this.#client.companySignupIntent.findUnique({
      where: { id: signupIntentId },
      select: {
        id: true,
        companyName: true,
        adminEmail: true,
        status: true,
        expiresAt: true,
        emailVerificationSentAt: true,
      },
    });
    if (
      intent === null ||
      intent.status !== "PENDING_VERIFICATION" ||
      intent.expiresAt.getTime() <= now.getTime()
    ) {
      throw new Phase9ApiError("INVITATION_INVALID", 400, "Verification request is invalid");
    }

    const nextAllowedAt =
      intent.emailVerificationSentAt?.getTime() ??
      now.getTime() - this.#verificationResendCooldownMs;
    const waitMs = nextAllowedAt + this.#verificationResendCooldownMs - now.getTime();
    if (waitMs > 0) {
      throw new Phase9ApiError(
        "AUTH_RATE_LIMITED",
        429,
        "Please wait before requesting a new code",
        {
          retryAfterSeconds: Math.ceil(waitMs / 1_000),
        },
      );
    }

    const code = newEmailVerificationCode();
    const changed = await this.#client.companySignupIntent.updateMany({
      where: {
        id: intent.id,
        status: "PENDING_VERIFICATION",
        emailVerificationSentAt: intent.emailVerificationSentAt,
      },
      data: {
        emailVerificationTokenHash: hashEmailVerificationCode(
          this.#verificationSecret,
          intent.id,
          code,
        ),
        emailVerificationExpiresAt: new Date(now.getTime() + this.#verificationCodeTtlMs),
        emailVerificationSentAt: now,
        emailVerificationAttemptCount: 0,
      },
    });
    if (changed.count !== 1) {
      throw new Phase9ApiError(
        "AUTH_RATE_LIMITED",
        429,
        "Please wait before requesting a new code",
        {
          retryAfterSeconds: Math.ceil(this.#verificationResendCooldownMs / 1_000),
        },
      );
    }

    try {
      await this.#mailer?.send({
        to: intent.adminEmail,
        required: true,
        ...billingMailTemplates.verifySignup({
          companyName: intent.companyName,
          verificationCode: code,
          expiresInMinutes: Math.round(this.#verificationCodeTtlMs / 60_000),
        }),
      });
    } catch {
      // Invalidate the undelivered replacement and restore the previous resend
      // timestamp so the visitor can retry immediately after a transient outage.
      await this.#client.companySignupIntent.updateMany({
        where: {
          id: intent.id,
          status: "PENDING_VERIFICATION",
          emailVerificationTokenHash: hashEmailVerificationCode(
            this.#verificationSecret,
            intent.id,
            code,
          ),
        },
        data: {
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
          emailVerificationSentAt: intent.emailVerificationSentAt,
        },
      });
      throw new Phase9ApiError(
        "INTERNAL_ERROR",
        503,
        "Verification email could not be delivered. Please try again.",
      );
    }
    return {
      status: "PENDING",
      retryAfterSeconds: Math.ceil(this.#verificationResendCooldownMs / 1_000),
      ...(this.#exposeVerificationCode ? { verificationCode: code } : {}),
    };
  }

  async createCheckout(
    signupIntentId: string,
    correlationId: string,
  ): Promise<{ url: string; checkoutId: string }> {
    const intent = await this.#client.companySignupIntent.findUnique({
      where: { id: signupIntentId },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        companyName: true,
        adminEmail: true,
        adminDisplayName: true,
        plan: { select: { code: true, interval: true } },
      },
    });
    if (
      intent === null ||
      intent.expiresAt.getTime() <= this.#now().getTime() ||
      !["VERIFIED", "CHECKOUT_STARTED"].includes(intent.status)
    ) {
      throw new Phase9ApiError("VALIDATION_FAILED", 400, "This signup cannot start a checkout");
    }

    let result;
    try {
      result = await this.#checkout.createCheckout({
        signupIntentId: intent.id,
        planCode: intent.plan.code,
        interval: intent.plan.interval as BillingInterval,
        customerEmail: intent.adminEmail,
        customerName: intent.adminDisplayName,
        companyName: intent.companyName,
        successUrl: this.#successUrl,
        correlationId,
        provider: this.#provider,
      });
    } catch (error) {
      if (error instanceof BillingProviderError && error.code === "NOT_CONFIGURED") {
        throw new Phase9ApiError(
          "INTERNAL_ERROR",
          503,
          "Имэйл баталгаажсан. Stripe Checkout тохиргоо одоогоор хийгдээгүй байна.",
        );
      }
      throw error;
    }

    await this.#client.companySignupIntent.update({
      where: { id: intent.id },
      data: { status: "CHECKOUT_STARTED", providerCheckoutId: result.checkoutId },
    });
    return { url: result.url, checkoutId: result.checkoutId };
  }

  /**
   * Polled by the success page. It reports what the backend has actually
   * confirmed; the browser's arrival on that page proves nothing (§20.5).
   */
  async status(signupIntentId: string): Promise<{ status: CompanySignupPublicStatus }> {
    const intent = await this.#client.companySignupIntent.findUnique({
      where: { id: signupIntentId },
      select: { status: true, expiresAt: true },
    });
    if (intent === null) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Signup not found");
    }
    if (intent.status !== "COMPLETED" && intent.expiresAt.getTime() <= this.#now().getTime()) {
      return { status: "EXPIRED" };
    }
    return { status: this.#publicStatus(intent.status) };
  }

  /**
   * Consumes the post-payment token and activates the already-created Company
   * Admin. The token, credential, user state and audit record change atomically,
   * so replay and partial account setup cannot produce a usable half-account.
   */
  async completeAccountSetup(
    input: unknown,
    correlationId: string,
  ): Promise<{ tenantSlug: string; email: string }> {
    const request = companyAccountSetupRequestSchema.parse(input);
    const tokenHash = phase9Sha256(request.setupToken);
    const passwordHash = await hashPhase9Password(request.password);
    const now = this.#now();

    const completed = await this.#client.$transaction(async (transaction) => {
      const token = await transaction.securityToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          type: true,
          expiresAt: true,
          consumedAt: true,
          user: {
            select: {
              email: true,
              status: true,
              deletedAt: true,
              credential: { select: { userId: true } },
            },
          },
        },
      });
      if (
        token === null ||
        token.tenantId !== request.tenantId ||
        token.type !== "PASSWORD_RESET" ||
        token.consumedAt !== null ||
        token.expiresAt.getTime() <= now.getTime() ||
        token.user.status !== "INVITED" ||
        token.user.deletedAt !== null ||
        token.user.credential !== null
      ) {
        return null;
      }

      const consumed = await transaction.securityToken.updateMany({
        where: {
          id: token.id,
          tenantId: request.tenantId,
          type: "PASSWORD_RESET",
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;

      await transaction.userCredential.create({
        data: {
          userId: token.userId,
          passwordHash,
          passwordChangedAt: now,
        },
      });
      await transaction.user.update({
        where: { tenantId_id: { tenantId: token.tenantId, id: token.userId } },
        data: {
          status: "ACTIVE",
          emailVerifiedAt: now,
          tokenVersion: { increment: 1 },
        },
      });
      const tenant = await transaction.tenant.findUnique({
        where: { id: token.tenantId },
        select: { slug: true },
      });
      if (tenant === null) return null;

      await transaction.auditLog.create({
        data: {
          tenantId: token.tenantId,
          actorUserId: token.userId,
          actorRole: "COMPANY_ADMIN",
          action: "COMPANY_ADMIN_ACCOUNT_SETUP_COMPLETED",
          entityType: "User",
          entityId: token.userId,
          reason: "paid signup account setup",
          correlationId,
          metadata: { tokenType: "PASSWORD_RESET" },
        },
      });
      return { tenantSlug: tenant.slug, email: token.user.email };
    });

    if (completed === null) {
      throw new Phase9ApiError("INVITATION_INVALID", 400, "Setup link is invalid or expired");
    }
    return completed;
  }

  // -------------------------------------------------------------------------
  // Provisioning (called only from the verified webhook pipeline)
  // -------------------------------------------------------------------------

  async provision(input: {
    event: VerifiedBillingEvent;
    subscription: ProviderSubscription;
    planId: string;
    correlationId: string;
  }): Promise<{ tenantId: string } | null> {
    const signupIntentId = input.event.signupIntentId;
    if (signupIntentId === null) return null;

    // Stripe subscription metadata alone is not proof that it came from the
    // Checkout Session BuildWatch minted for this intent. Provision only after
    // the adapter retrieved that exact paid session and supplied its ID.
    if (input.event.provider === "STRIPE" && input.event.providerCheckoutId === null) {
      this.#logger?.warn("company_signup_checkout_binding_missing", {
        signupIntentId,
        provider: input.event.provider,
      });
      return null;
    }

    // A signed event is necessary but not sufficient to grant access. Only an
    // authoritative paid subscription may create an ACTIVE tenant.
    if (input.subscription.status !== "ACTIVE") {
      this.#logger?.warn("company_signup_subscription_not_active", {
        signupIntentId,
        provider: input.event.provider,
        status: input.subscription.status,
      });
      return null;
    }

    const setupToken = newToken();
    const now = this.#now();

    const provisioned = await this.#client.$transaction(async (transaction) => {
      // Claim and provisioning live in this same transaction. If any later
      // write fails, the claim rolls back and a verified webhook retry can
      // safely finish the purchase.
      const claimed = await transaction.companySignupIntent.updateMany({
        where: {
          id: signupIntentId,
          provider: input.event.provider,
          planId: input.planId,
          providerCheckoutId: input.event.providerCheckoutId,
          status: { in: ["VERIFIED", "CHECKOUT_STARTED"] },
          completedTenantId: null,
        },
        data: { status: "COMPLETED" },
      });
      if (claimed.count !== 1) return null;

      const intent = await transaction.companySignupIntent.findUnique({
        where: { id: signupIntentId },
        select: {
          id: true,
          companyName: true,
          desiredSlug: true,
          adminEmail: true,
          adminEmailNormalized: true,
          adminDisplayName: true,
        },
      });
      if (intent === null) return null;

      const slug = await this.#reserveSlug(transaction, intent.desiredSlug);
      const tenant = await transaction.tenant.create({
        data: {
          slug,
          name: intent.companyName,
          lifecycleStatus: "ACTIVE",
          accessChangedAt: now,
          accessReason: "PAYMENT_CONFIRMED",
        },
        select: { id: true },
      });

      await transaction.billingCustomer.create({
        data: {
          tenantId: tenant.id,
          provider: input.event.provider,
          providerCustomerId: input.subscription.providerCustomerId,
          billingEmail: intent.adminEmail,
          legalName: intent.companyName,
        },
      });

      const subscription = await transaction.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          planId: input.planId,
          provider: input.event.provider,
          providerCustomerId: input.subscription.providerCustomerId,
          providerSubscriptionId: input.subscription.providerSubscriptionId,
          status: input.subscription.status,
          currentPeriodStart: input.subscription.currentPeriodStart,
          currentPeriodEnd: input.subscription.currentPeriodEnd,
          cancelAtPeriodEnd: input.subscription.cancelAtPeriodEnd,
          canceledAt: input.subscription.canceledAt,
          providerUpdatedAt: input.subscription.providerUpdatedAt,
        },
        select: { id: true },
      });

      // INVITED, with no credential: the account cannot be signed into until the
      // admin sets a password through the one-time token.
      const admin = await transaction.user.create({
        data: {
          tenantId: tenant.id,
          email: intent.adminEmail,
          emailNormalized: intent.adminEmailNormalized,
          displayName: intent.adminDisplayName,
          tenantRole: "COMPANY_ADMIN",
          status: "INVITED",
        },
        select: { id: true },
      });

      await transaction.securityToken.create({
        data: {
          tenantId: tenant.id,
          userId: admin.id,
          type: "PASSWORD_RESET",
          tokenHash: phase9Sha256(setupToken),
          expiresAt: new Date(now.getTime() + this.#setupTokenTtlMs),
        },
      });

      const plan = await transaction.billingPlan.findUnique({
        where: { id: input.planId },
        select: {
          code: true,
          version: true,
          interval: true,
          entitlements: {
            select: { featureKey: true, enabled: true, limitValue: true, unit: true },
          },
        },
      });
      if (plan === null) throw new Error("Purchased billing plan is unavailable");
      const entitlementSnapshot = buildEntitlementSnapshotFromPlanRows(plan, plan.entitlements);
      await transaction.tenantEntitlementSnapshot.create({
        data: {
          tenantId: tenant.id,
          subscriptionId: subscription.id,
          sourceVersion: `plan:${plan.code}@${plan.version}`,
          entitlements: serializeEntitlementSnapshot(entitlementSnapshot) as never,
          effectiveFrom: now,
          refreshedAt: now,
        },
      });

      await transaction.auditLog.create({
        data: {
          tenantId: tenant.id,
          action: "SUBSCRIPTION_ACTIVATED",
          entityType: "TenantSubscription",
          entityId: subscription.id,
          correlationId: input.correlationId,
          reason: "confirmed payment",
          metadata: {
            provider: input.event.provider,
            providerEventId: input.event.providerEventId,
            planCode: plan?.code ?? null,
            signupIntentId: intent.id,
          },
        },
      });

      await transaction.companySignupIntent.update({
        where: { id: intent.id },
        data: { completedTenantId: tenant.id },
      });

      return { tenantId: tenant.id, intent };
    });

    if (provisioned === null) {
      this.#logger?.warn("company_signup_already_completed_or_mismatched", { signupIntentId });
      return null;
    }
    const { tenantId, intent } = provisioned;

    // Sent after the transaction committed: the workspace exists whether or not
    // the message goes out, and a mail outage must not undo a paid signup.
    const setupUrl =
      `${this.#publicBaseUrl}/register?setup=${encodeURIComponent(setupToken)}` +
      `&tenant=${encodeURIComponent(tenantId)}`;
    await this.#mailer?.send({
      to: intent.adminEmail,
      ...billingMailTemplates.setPassword({
        companyName: intent.companyName,
        setupUrl,
        expiresInHours: Math.round(this.#setupTokenTtlMs / 3_600_000),
      }),
    });
    this.#logger?.warn("company_admin_setup_token_issued", {
      tenantId,
      signupIntentId: intent.id,
      delivered: this.#mailer !== undefined,
    });

    return { tenantId };
  }

  /**
   * Expired and abandoned intents are dropped so the table cannot become a
   * permanent store of names and email addresses nobody ever confirmed.
   */
  async purgeExpired(): Promise<number> {
    const result = await this.#client.companySignupIntent.deleteMany({
      where: {
        status: { in: ["PENDING_VERIFICATION", "VERIFIED", "CHECKOUT_STARTED", "EXPIRED"] },
        expiresAt: { lt: this.#now() },
      },
    });
    return result.count;
  }

  // -------------------------------------------------------------------------

  async #requirePublicPlan(planCode: string, interval: BillingInterval) {
    const plan = await this.#client.billingPlan.findFirst({
      where: { code: planCode, interval, active: true, public: true, archivedAt: null },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    if (plan === null) {
      throw new BillingProviderError("PRICE_NOT_ALLOWED", "That plan cannot be bought online");
    }
    return plan;
  }

  /**
   * Picks the first free workspace address deterministically. The unique index
   * remains the real guard: a lost race fails the transaction and the webhook is
   * retried rather than producing two companies on one address.
   */
  async #reserveSlug(transaction: Pick<PrismaClient, "tenant">, desired: string): Promise<string> {
    const taken = new Set(
      (
        await transaction.tenant.findMany({
          where: { slug: { startsWith: desired } },
          select: { slug: true },
        })
      ).map((row) => row.slug),
    );
    if (!taken.has(desired)) return desired;
    for (let suffix = 2; suffix < 1_000; suffix += 1) {
      const candidate = `${desired}-${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new Phase9ApiError("VALIDATION_FAILED", 409, "Could not allocate a workspace address");
  }

  #publicStatus(status: string): CompanySignupPublicStatus {
    switch (status) {
      case "COMPLETED":
        return "ACTIVE";
      case "VERIFIED":
      case "CHECKOUT_STARTED":
        return "CONFIRMING";
      case "EXPIRED":
      case "ABANDONED":
        return "EXPIRED";
      default:
        return "PENDING";
    }
  }
}
