import { Phase9ApiError } from "./contracts.js";
import type { Phase9ErrorCode } from "./contracts.js";
import type {
  BillingEntitlementValues,
  BillingFeatureKey,
  SubscriptionStatus,
  TenantLifecycleStatus,
} from "./billing-contracts.js";

/**
 * Subscription-aware authorization boundary (landing-page-roadmap.md §19).
 *
 * Authentication answers "who is this user"; this policy answers "is this tenant
 * currently entitled to this operation". The two are kept apart on purpose: a
 * Company Admin whose payment failed must still be able to sign in and fix it.
 *
 * The policy never calls the payment provider. It reads the locally persisted
 * access snapshot that the verified webhook pipeline maintains, so a provider
 * outage cannot lock every tenant out (§16.5).
 */

export type TenantAccessOperation = "READ" | "WRITE" | "AI_JOB" | "BILLING";

export type TenantAccessDenialReason =
  | "TENANT_NOT_FOUND"
  | "SUBSCRIPTION_REQUIRED"
  | "ACCESS_SUSPENDED"
  | "TENANT_ARCHIVED"
  | "FEATURE_NOT_INCLUDED"
  | "LIMIT_REACHED"
  | "USAGE_UNKNOWN";

export interface TenantAccessSnapshot {
  readonly tenantId: string;
  readonly lifecycleStatus: TenantLifecycleStatus;
  readonly accessReason: string | null;
  readonly subscriptionStatus: SubscriptionStatus | null;
  readonly planCode: string | null;
  readonly graceEndsAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  /**
   * `null` means no plan-level entitlement record exists. That is the shape of a
   * tenant grandfathered by the billing migration, and it means "no plan ceiling",
   * never "every limit is zero" (§33).
   */
  readonly entitlements: BillingEntitlementValues | null;
}

export interface TenantAccessSnapshotReader {
  load(tenantId: string): Promise<TenantAccessSnapshot | null>;
}

export interface TenantAccessDecision {
  readonly allowed: boolean;
  readonly tenantId: string;
  readonly operation: TenantAccessOperation;
  /** Lifecycle after applying time-based corrections such as an elapsed grace. */
  readonly effectiveLifecycle: TenantLifecycleStatus | null;
  readonly reason: TenantAccessDenialReason | null;
  readonly message: string;
  /** Set while the tenant still works but the Company Admin must act. */
  readonly warning: { readonly kind: "PAYMENT_GRACE"; readonly graceEndsAt: Date | null } | null;
}

export interface TenantAccessPolicyMetrics {
  increment(name: string, value?: number): void;
}

export interface TenantAccessPolicyLogger {
  warn(event: string, fields?: Record<string, unknown>): void;
}

export interface TenantAccessPolicyOptions {
  /**
   * How long a loaded snapshot may be reused. Subscription state changes by
   * webhook at any moment, so this is deliberately short rather than tied to the
   * access token lifetime (§16.1).
   */
  readonly cacheTtlMs?: number;
  readonly now?: () => Date;
  readonly metrics?: TenantAccessPolicyMetrics;
  readonly logger?: TenantAccessPolicyLogger;
}

const DEFAULT_CACHE_TTL_MS = 10_000;

const DENIAL_ERROR_CODES = {
  TENANT_NOT_FOUND: "TENANT_SUBSCRIPTION_REQUIRED",
  SUBSCRIPTION_REQUIRED: "TENANT_SUBSCRIPTION_REQUIRED",
  ACCESS_SUSPENDED: "TENANT_ACCESS_SUSPENDED",
  TENANT_ARCHIVED: "TENANT_ACCESS_SUSPENDED",
  FEATURE_NOT_INCLUDED: "FEATURE_NOT_INCLUDED",
  LIMIT_REACHED: "FEATURE_NOT_INCLUDED",
  USAGE_UNKNOWN: "INTERNAL_ERROR",
} as const satisfies Record<TenantAccessDenialReason, Phase9ErrorCode>;

const LIMIT_ERROR_CODES = {
  PROJECT_ACTIVE_MAX: "PROJECT_LIMIT_REACHED",
  USER_ACTIVE_MAX: "USER_LIMIT_REACHED",
  STORAGE_BYTES_MAX: "STORAGE_LIMIT_REACHED",
  AI_MONTHLY_RUNS_INCLUDED: "AI_USAGE_LIMIT_REACHED",
  AI_MONTHLY_MICRO_USD_MAX: "AI_USAGE_LIMIT_REACHED",
} as const satisfies Partial<Record<BillingFeatureKey, Phase9ErrorCode>>;

/**
 * Operations each lifecycle state may perform (§19.1).
 *
 * `BILLING` is allowed everywhere except `ARCHIVED` so that payment recovery is
 * always reachable; the route allowlist decides which endpoints count as billing.
 */
const LIFECYCLE_MATRIX: Record<
  TenantLifecycleStatus,
  Readonly<Record<TenantAccessOperation, boolean>>
> = {
  PENDING_PAYMENT: { READ: false, WRITE: false, AI_JOB: false, BILLING: true },
  ACTIVE: { READ: true, WRITE: true, AI_JOB: true, BILLING: true },
  PAYMENT_GRACE: { READ: true, WRITE: true, AI_JOB: true, BILLING: true },
  SUSPENDED: { READ: true, WRITE: false, AI_JOB: false, BILLING: true },
  ARCHIVED: { READ: false, WRITE: false, AI_JOB: false, BILLING: false },
};

function denialReasonFor(
  lifecycle: TenantLifecycleStatus,
): Exclude<TenantAccessDenialReason, "FEATURE_NOT_INCLUDED" | "LIMIT_REACHED" | "USAGE_UNKNOWN"> {
  switch (lifecycle) {
    case "PENDING_PAYMENT":
      return "SUBSCRIPTION_REQUIRED";
    case "ARCHIVED":
      return "TENANT_ARCHIVED";
    default:
      return "ACCESS_SUSPENDED";
  }
}

function denialMessage(reason: TenantAccessDenialReason): string {
  switch (reason) {
    case "TENANT_NOT_FOUND":
    case "SUBSCRIPTION_REQUIRED":
      return "An active subscription is required for this workspace";
    case "ACCESS_SUSPENDED":
      return "Workspace access is suspended until billing is restored";
    case "TENANT_ARCHIVED":
      return "This workspace is archived";
    case "FEATURE_NOT_INCLUDED":
      return "This feature is not included in the current plan";
    case "LIMIT_REACHED":
      return "The current plan limit has been reached";
    case "USAGE_UNKNOWN":
      return "Current usage could not be determined";
  }
}

function httpStatusFor(reason: TenantAccessDenialReason): number {
  return reason === "USAGE_UNKNOWN" ? 503 : 402;
}

export class TenantAccessDeniedError extends Phase9ApiError {
  readonly decision: TenantAccessDecision;

  constructor(decision: TenantAccessDecision, code: Phase9ErrorCode, status: number) {
    super(code, status, decision.message);
    this.decision = decision;
  }
}

interface CacheEntry {
  readonly snapshot: TenantAccessSnapshot | null;
  readonly expiresAt: number;
}

export class TenantAccessPolicy {
  readonly #reader: TenantAccessSnapshotReader;
  readonly #cacheTtlMs: number;
  readonly #now: () => Date;
  readonly #metrics: TenantAccessPolicyMetrics | undefined;
  readonly #logger: TenantAccessPolicyLogger | undefined;
  readonly #cache = new Map<string, CacheEntry>();

  constructor(reader: TenantAccessSnapshotReader, options: TenantAccessPolicyOptions = {}) {
    this.#reader = reader;
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.#now = options.now ?? (() => new Date());
    this.#metrics = options.metrics;
    this.#logger = options.logger;
  }

  /** Drops a cached snapshot so a processed webhook takes effect immediately. */
  invalidate(tenantId: string): void {
    this.#cache.delete(tenantId);
  }

  invalidateAll(): void {
    this.#cache.clear();
  }

  async snapshot(tenantId: string): Promise<TenantAccessSnapshot | null> {
    const cached = this.#cache.get(tenantId);
    const nowMs = this.#now().getTime();
    if (cached !== undefined && cached.expiresAt > nowMs) {
      return cached.snapshot;
    }
    const snapshot = await this.#reader.load(tenantId);
    this.#cache.set(tenantId, { snapshot, expiresAt: nowMs + this.#cacheTtlMs });
    return snapshot;
  }

  /**
   * A grace window that has already elapsed is treated as suspended even if the
   * background evaluator has not run yet, so a stalled worker cannot keep handing
   * out unpaid access.
   */
  #effectiveLifecycle(snapshot: TenantAccessSnapshot): TenantLifecycleStatus {
    if (
      snapshot.lifecycleStatus === "PAYMENT_GRACE" &&
      snapshot.graceEndsAt !== null &&
      snapshot.graceEndsAt.getTime() <= this.#now().getTime()
    ) {
      return "SUSPENDED";
    }
    return snapshot.lifecycleStatus;
  }

  async getDecision(
    tenantId: string,
    operation: TenantAccessOperation,
  ): Promise<TenantAccessDecision> {
    const snapshot = await this.snapshot(tenantId);
    if (snapshot === null) {
      return this.#deny(tenantId, operation, null, "TENANT_NOT_FOUND");
    }

    const effectiveLifecycle = this.#effectiveLifecycle(snapshot);
    if (!LIFECYCLE_MATRIX[effectiveLifecycle][operation]) {
      return this.#deny(
        tenantId,
        operation,
        effectiveLifecycle,
        denialReasonFor(effectiveLifecycle),
      );
    }

    return {
      allowed: true,
      tenantId,
      operation,
      effectiveLifecycle,
      reason: null,
      message: "Allowed",
      warning:
        effectiveLifecycle === "PAYMENT_GRACE"
          ? { kind: "PAYMENT_GRACE", graceEndsAt: snapshot.graceEndsAt }
          : null,
    };
  }

  async requireOperation(
    tenantId: string,
    operation: TenantAccessOperation,
  ): Promise<TenantAccessDecision> {
    const decision = await this.getDecision(tenantId, operation);
    if (!decision.allowed) throw this.toError(decision);
    return decision;
  }

  /** Convenience wrapper for the common "can this tenant mutate anything" check. */
  async requireWorkspaceAccess(tenantId: string): Promise<TenantAccessDecision> {
    return this.requireOperation(tenantId, "WRITE");
  }

  async requireFeature(tenantId: string, featureKey: BillingFeatureKey): Promise<void> {
    const snapshot = await this.snapshot(tenantId);
    if (snapshot === null) {
      throw this.toError(this.#deny(tenantId, "WRITE", null, "TENANT_NOT_FOUND"));
    }
    // A grandfathered tenant has no plan record; it keeps every feature until a
    // contract is attached.
    if (snapshot.entitlements === null) return;
    if (!snapshot.entitlements[featureKey].enabled) {
      throw this.toError(
        this.#deny(tenantId, "WRITE", this.#effectiveLifecycle(snapshot), "FEATURE_NOT_INCLUDED"),
        featureKey,
      );
    }
  }

  /**
   * Checks a countable limit.
   *
   * `currentUsage` is `number | null` on purpose: when usage cannot be read the
   * caller must pass `null` rather than `0`. Reporting an unknown count as zero
   * would silently hand out capacity nobody paid for (§28).
   */
  async requireLimit(
    tenantId: string,
    featureKey: BillingFeatureKey,
    currentUsage: number | bigint | null,
    requestedDelta: number | bigint = 1,
  ): Promise<void> {
    const snapshot = await this.snapshot(tenantId);
    if (snapshot === null) {
      throw this.toError(this.#deny(tenantId, "WRITE", null, "TENANT_NOT_FOUND"));
    }
    if (snapshot.entitlements === null) return;

    const entitlement = snapshot.entitlements[featureKey];
    if (!entitlement.enabled) {
      throw this.toError(
        this.#deny(tenantId, "WRITE", this.#effectiveLifecycle(snapshot), "FEATURE_NOT_INCLUDED"),
        featureKey,
      );
    }
    if (entitlement.limitValue === null) return;

    if (currentUsage === null) {
      throw this.toError(
        this.#deny(tenantId, "WRITE", this.#effectiveLifecycle(snapshot), "USAGE_UNKNOWN"),
        featureKey,
      );
    }

    const projected = BigInt(currentUsage) + BigInt(requestedDelta);
    if (projected > entitlement.limitValue) {
      throw this.toError(
        this.#deny(tenantId, "WRITE", this.#effectiveLifecycle(snapshot), "LIMIT_REACHED"),
        featureKey,
      );
    }
  }

  /** Human-readable trace for support tooling; never returned to the browser. */
  explainDecision(decision: TenantAccessDecision): string {
    const lifecycle = decision.effectiveLifecycle ?? "UNKNOWN";
    return decision.allowed
      ? `tenant=${decision.tenantId} operation=${decision.operation} lifecycle=${lifecycle} allowed`
      : `tenant=${decision.tenantId} operation=${decision.operation} lifecycle=${lifecycle} denied=${decision.reason}`;
  }

  toError(decision: TenantAccessDecision, featureKey?: BillingFeatureKey): TenantAccessDeniedError {
    const reason = decision.reason ?? "SUBSCRIPTION_REQUIRED";
    const limitCode: Phase9ErrorCode | undefined =
      featureKey === undefined
        ? undefined
        : (LIMIT_ERROR_CODES as Partial<Record<BillingFeatureKey, Phase9ErrorCode>>)[featureKey];
    const code =
      limitCode !== undefined && (reason === "LIMIT_REACHED" || reason === "FEATURE_NOT_INCLUDED")
        ? limitCode
        : DENIAL_ERROR_CODES[reason];
    return new TenantAccessDeniedError(decision, code, httpStatusFor(reason));
  }

  #deny(
    tenantId: string,
    operation: TenantAccessOperation,
    effectiveLifecycle: TenantLifecycleStatus | null,
    reason: TenantAccessDenialReason,
  ): TenantAccessDecision {
    this.#metrics?.increment("tenant_access_denied_total");
    this.#metrics?.increment(`tenant_access_denied_${reason.toLowerCase()}_total`);
    this.#logger?.warn("tenant_access_denied", {
      tenantId,
      operation,
      lifecycle: effectiveLifecycle,
      reason,
    });
    return {
      allowed: false,
      tenantId,
      operation,
      effectiveLifecycle,
      reason,
      message: denialMessage(reason),
      warning: null,
    };
  }
}
