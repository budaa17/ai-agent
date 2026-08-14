import type { PrismaClient } from "@prisma/client";
import type { BillingProviderKind, SubscriptionStatus } from "./billing-contracts.js";
import { BillingProviderError, type BillingProvider } from "./billing-provider.js";
import type { TenantAccessPolicy } from "./tenant-access-policy.js";

/**
 * Subscription reconciliation (landing-page-roadmap.md §25, Phase 4).
 *
 * Webhooks are the fast path, not the only path. A delivery can be lost, a
 * deploy can drop one mid-flight, and a signature secret can be rotated at the
 * wrong moment. This job asks the provider what it believes and repairs the
 * local record where the two disagree.
 *
 * Its most important property is restraint: when the provider is unreachable it
 * reports `UNKNOWN` and changes nothing. A provider outage must never cascade
 * into mass suspension (§16.5).
 */

export type ReconciliationOutcome = "IN_SYNC" | "REPAIRED" | "UNKNOWN" | "SKIPPED";

export interface ReconciliationEntry {
  readonly subscriptionId: string;
  readonly tenantId: string;
  readonly outcome: ReconciliationOutcome;
  readonly detail: string;
}

export interface ReconciliationReport {
  readonly checked: number;
  readonly inSync: number;
  readonly repaired: number;
  readonly unknown: number;
  readonly skipped: number;
  readonly entries: readonly ReconciliationEntry[];
}

export interface BillingReconciliationOptions {
  readonly client: PrismaClient;
  readonly providers: ReadonlyMap<BillingProviderKind, BillingProvider>;
  readonly accessPolicy?: TenantAccessPolicy;
  readonly graceDays?: number;
  readonly now?: () => Date;
  readonly logger?: { warn(event: string, fields?: Record<string, unknown>): void };
}

const LIFECYCLE_FOR_STATUS: Readonly<Record<SubscriptionStatus, string>> = {
  PENDING: "PENDING_PAYMENT",
  TRIALING: "ACTIVE",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAYMENT_GRACE",
  PAUSED: "SUSPENDED",
  CANCELED: "SUSPENDED",
  EXPIRED: "SUSPENDED",
};

export class BillingReconciliationService {
  readonly #client: PrismaClient;
  readonly #providers: ReadonlyMap<BillingProviderKind, BillingProvider>;
  readonly #accessPolicy: TenantAccessPolicy | undefined;
  readonly #graceMs: number;
  readonly #now: () => Date;
  readonly #logger: BillingReconciliationOptions["logger"];

  constructor(options: BillingReconciliationOptions) {
    this.#client = options.client;
    this.#providers = options.providers;
    this.#accessPolicy = options.accessPolicy;
    this.#graceMs = (options.graceDays ?? 7) * 24 * 60 * 60 * 1_000;
    this.#now = options.now ?? (() => new Date());
    this.#logger = options.logger;
  }

  async reconcile(limit = 200): Promise<ReconciliationReport> {
    const subscriptions = await this.#client.tenantSubscription.findMany({
      where: {
        status: { in: ["PENDING", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"] },
        providerSubscriptionId: { not: null },
      },
      orderBy: { updatedAt: "asc" },
      take: Math.min(Math.max(limit, 1), 500),
      select: {
        id: true,
        tenantId: true,
        provider: true,
        providerSubscriptionId: true,
        status: true,
        graceEndsAt: true,
        providerUpdatedAt: true,
      },
    });

    const entries: ReconciliationEntry[] = [];
    for (const subscription of subscriptions) {
      entries.push(await this.#reconcileOne(subscription));
    }

    const count = (outcome: ReconciliationOutcome) =>
      entries.filter((entry) => entry.outcome === outcome).length;
    return {
      checked: entries.length,
      inSync: count("IN_SYNC"),
      repaired: count("REPAIRED"),
      unknown: count("UNKNOWN"),
      skipped: count("SKIPPED"),
      entries,
    };
  }

  async #reconcileOne(subscription: {
    id: string;
    tenantId: string;
    provider: BillingProviderKind;
    providerSubscriptionId: string | null;
    status: SubscriptionStatus;
    graceEndsAt: Date | null;
    providerUpdatedAt: Date | null;
  }): Promise<ReconciliationEntry> {
    const base = { subscriptionId: subscription.id, tenantId: subscription.tenantId };
    const provider = this.#providers.get(subscription.provider);
    if (provider === undefined || subscription.providerSubscriptionId === null) {
      // The contract channel has no remote authority to ask, by design.
      return { ...base, outcome: "SKIPPED", detail: "channel has no remote state" };
    }

    let remote;
    try {
      remote = await provider.getSubscription(subscription.providerSubscriptionId);
    } catch (error) {
      const code = error instanceof BillingProviderError ? error.code : "UNKNOWN";
      if (code === "UNSUPPORTED_OPERATION") {
        return { ...base, outcome: "SKIPPED", detail: "channel has no remote state" };
      }
      // Deliberately no state change: an unreachable provider is not evidence
      // that a tenant stopped paying.
      this.#logger?.warn("billing_reconciliation_unavailable", {
        subscriptionId: subscription.id,
        code,
      });
      return { ...base, outcome: "UNKNOWN", detail: `provider unreachable (${code})` };
    }

    if (remote.status === subscription.status) {
      return { ...base, outcome: "IN_SYNC", detail: remote.status };
    }

    // The provider is authoritative about its own subscription, so a mismatch is
    // a missed event rather than a conflict to arbitrate.
    const lifecycle = LIFECYCLE_FOR_STATUS[remote.status] as never;
    const graceEndsAt =
      remote.status === "PAST_DUE"
        ? (subscription.graceEndsAt ?? new Date(this.#now().getTime() + this.#graceMs))
        : null;

    await this.#client.$transaction(async (transaction) => {
      await transaction.tenantSubscription.update({
        where: { id: subscription.id },
        data: {
          status: remote.status,
          currentPeriodStart: remote.currentPeriodStart,
          currentPeriodEnd: remote.currentPeriodEnd,
          cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
          canceledAt: remote.canceledAt,
          providerUpdatedAt: remote.providerUpdatedAt,
          graceEndsAt,
        },
      });
      await transaction.tenant.update({
        where: { id: subscription.tenantId },
        data: {
          lifecycleStatus: lifecycle,
          accessChangedAt: this.#now(),
          accessReason: `RECONCILED_${remote.status}`,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: subscription.tenantId,
          action: "BILLING_WEBHOOK_PROCESSED",
          entityType: "TenantSubscription",
          entityId: subscription.id,
          correlationId: `reconcile-${subscription.id}`,
          reason: "reconciliation repaired a missed provider event",
          metadata: {
            provider: subscription.provider,
            fromStatus: subscription.status,
            toStatus: remote.status,
            providerStatus: remote.providerStatus,
          },
        },
      });
    });

    this.#accessPolicy?.invalidate(subscription.tenantId);
    return {
      ...base,
      outcome: "REPAIRED",
      detail: `${subscription.status} → ${remote.status}`,
    };
  }
}
