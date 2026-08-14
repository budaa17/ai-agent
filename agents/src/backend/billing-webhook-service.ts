import type { PrismaClient } from "@prisma/client";
import type {
  BillingProviderKind,
  SubscriptionStatus,
  TenantLifecycleStatus,
} from "./billing-contracts.js";
import {
  buildEntitlementSnapshotFromPlanRows,
  serializeEntitlementSnapshot,
} from "./billing-contracts.js";
import type { BillingPriceResolver } from "./billing-price-resolver.js";
import {
  BillingProviderError,
  redactBillingSecrets,
  type BillingProvider,
  type ProviderInvoice,
  type ProviderSubscription,
  type VerifiedBillingEvent,
} from "./billing-provider.js";
import type { TenantAccessPolicy } from "./tenant-access-policy.js";
import { billingMailTemplates, type Mailer } from "./mailer.js";

/**
 * Webhook inbox and subscription state machine
 * (landing-page-roadmap.md §20.3, §24.1, Phase 4).
 *
 * This is the only path that may grant paid access. A browser landing on the
 * success page proves nothing; a signed provider event, recorded exactly once,
 * is the authority.
 *
 * Three properties matter more than throughput here:
 *   - **Exactly once.** The unique `(provider, providerEventId)` index means a
 *     replayed delivery cannot provision a second tenant or double an invoice.
 *   - **Order independent.** Providers retry out of order; an older event must
 *     never undo a newer state.
 *   - **Default deny.** An unknown price, an unknown status or an unmatched
 *     subscription is refused rather than interpreted generously.
 */

export type BillingWebhookOutcome = "PROCESSED" | "DUPLICATE" | "IGNORED" | "FAILED";

export interface BillingWebhookResult {
  readonly outcome: BillingWebhookOutcome;
  readonly providerEventId: string;
  readonly eventType: string;
  readonly detail: string;
}

/**
 * Implemented in Phase 5. Called when a verified payment names a signup intent
 * that has no tenant yet.
 */
export interface SubscriptionProvisioner {
  provision(input: {
    readonly event: VerifiedBillingEvent;
    readonly subscription: ProviderSubscription;
    readonly planId: string;
    readonly correlationId: string;
  }): Promise<{ tenantId: string } | null>;
}

export interface BillingWebhookServiceOptions {
  readonly client: PrismaClient;
  readonly providers: ReadonlyMap<BillingProviderKind, BillingProvider>;
  readonly priceResolver: BillingPriceResolver;
  readonly environment: string;
  readonly accessPolicy?: TenantAccessPolicy;
  readonly provisioner?: SubscriptionProvisioner;
  /** Days of full access after a failed payment before suspension (§9). */
  readonly graceDays?: number;
  readonly mailer?: Mailer;
  readonly publicBaseUrl?: string;
  readonly now?: () => Date;
  readonly logger?: { warn(event: string, fields?: Record<string, unknown>): void };
  readonly metrics?: { increment(name: string, value?: number): void };
}

const DEFAULT_GRACE_DAYS = 7;

/**
 * Canonical subscription status mapped onto the tenant's workspace lifecycle.
 *
 * `PAUSED` suspends rather than keeps access: a paused subscription is not being
 * billed, so continuing to serve writes would be giving the workspace away.
 */
const LIFECYCLE_FOR_STATUS: Readonly<Record<SubscriptionStatus, TenantLifecycleStatus>> = {
  PENDING: "PENDING_PAYMENT",
  TRIALING: "ACTIVE",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAYMENT_GRACE",
  PAUSED: "SUSPENDED",
  CANCELED: "SUSPENDED",
  EXPIRED: "SUSPENDED",
};

const AUDIT_ACTION_FOR_LIFECYCLE: Readonly<Record<TenantLifecycleStatus, string>> = {
  PENDING_PAYMENT: "SUBSCRIPTION_PAST_DUE",
  ACTIVE: "SUBSCRIPTION_RESTORED",
  PAYMENT_GRACE: "SUBSCRIPTION_PAST_DUE",
  SUSPENDED: "SUBSCRIPTION_SUSPENDED",
  ARCHIVED: "SUBSCRIPTION_SUSPENDED",
};

export class BillingWebhookService {
  readonly #client: PrismaClient;
  readonly #providers: ReadonlyMap<BillingProviderKind, BillingProvider>;
  readonly #priceResolver: BillingPriceResolver;
  readonly #environment: string;
  readonly #accessPolicy: TenantAccessPolicy | undefined;
  readonly #provisioner: SubscriptionProvisioner | undefined;
  readonly #graceMs: number;
  readonly #mailer: Mailer | undefined;
  readonly #publicBaseUrl: string;
  readonly #now: () => Date;
  readonly #logger: BillingWebhookServiceOptions["logger"];
  readonly #metrics: BillingWebhookServiceOptions["metrics"];

  constructor(options: BillingWebhookServiceOptions) {
    this.#client = options.client;
    this.#providers = options.providers;
    this.#priceResolver = options.priceResolver;
    this.#environment = options.environment;
    this.#accessPolicy = options.accessPolicy;
    this.#provisioner = options.provisioner;
    this.#graceMs = (options.graceDays ?? DEFAULT_GRACE_DAYS) * 24 * 60 * 60 * 1_000;
    this.#mailer = options.mailer;
    this.#publicBaseUrl = (options.publicBaseUrl ?? "").replace(/\/+$/, "");
    this.#now = options.now ?? (() => new Date());
    this.#logger = options.logger;
    this.#metrics = options.metrics;
  }

  async receive(
    providerKind: BillingProviderKind,
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    correlationId: string,
  ): Promise<BillingWebhookResult> {
    const provider = this.#providers.get(providerKind);
    if (provider === undefined) {
      throw new BillingProviderError(
        "NOT_CONFIGURED",
        "No webhook endpoint is configured for this channel",
        providerKind,
      );
    }

    this.#metrics?.increment("billing_webhook_received_total");
    // Signature failures propagate to the route, which answers with a generic
    // status. Nothing is written: an unsigned body never reaches the inbox.
    const event = await provider.verifyWebhook({
      rawBody,
      headers,
      receivedAt: this.#now(),
    });

    const inserted = await this.#insertInboxRow(event, correlationId);
    if (!inserted) {
      this.#metrics?.increment("billing_webhook_duplicate_total");
      return {
        outcome: "DUPLICATE",
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        detail: "already processed",
      };
    }

    try {
      const result = await this.#process(event, correlationId);
      await this.#finish(event, result.outcome, result.detail);
      return result;
    } catch (error) {
      const detail = redactBillingSecrets(error instanceof Error ? error.message : String(error));
      this.#metrics?.increment("billing_webhook_failed_total");
      this.#logger?.warn("billing_webhook_failed", {
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        detail,
      });
      await this.#finish(event, "FAILED", detail);
      return {
        outcome: "FAILED",
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        detail,
      };
    }
  }

  /**
   * Claims the event. Returns false when another delivery already claimed it,
   * which is how a replay becomes a no-op rather than a second provisioning.
   */
  async #insertInboxRow(event: VerifiedBillingEvent, correlationId: string): Promise<boolean> {
    try {
      await this.#client.billingWebhookEvent.create({
        data: {
          provider: event.provider,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          payloadHash: event.payloadHash,
          occurredAt: event.occurredAt,
          status: "PROCESSING",
          attemptCount: 1,
          correlationId,
        },
      });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return false;
      throw error;
    }
  }

  async #finish(
    event: VerifiedBillingEvent,
    outcome: BillingWebhookOutcome,
    detail: string,
  ): Promise<void> {
    await this.#client.billingWebhookEvent.update({
      where: {
        provider_providerEventId: {
          provider: event.provider,
          providerEventId: event.providerEventId,
        },
      },
      data: {
        status: outcome === "DUPLICATE" ? "PROCESSED" : outcome,
        processedAt: this.#now(),
        lastErrorCode: outcome === "FAILED" ? detail.slice(0, 200) : null,
      },
    });
  }

  async #process(
    event: VerifiedBillingEvent,
    correlationId: string,
  ): Promise<BillingWebhookResult> {
    const base = { providerEventId: event.providerEventId, eventType: event.eventType };

    if (!event.recognized) {
      return { ...base, outcome: "IGNORED", detail: "event type is not modelled" };
    }

    if (event.subscription !== null) {
      const detail = await this.#applySubscription(event, event.subscription, correlationId);
      if (detail.startsWith("ignored:")) {
        return { ...base, outcome: "IGNORED", detail: detail.slice("ignored:".length) };
      }
      if (event.invoice !== null) {
        await this.#projectInvoice(event.invoice, event.provider);
      }
      this.#metrics?.increment("billing_webhook_processed_total");
      return { ...base, outcome: "PROCESSED", detail };
    }

    if (event.invoice !== null) {
      const projected = await this.#projectInvoice(event.invoice, event.provider);
      this.#metrics?.increment("billing_webhook_processed_total");
      return {
        ...base,
        outcome: projected ? "PROCESSED" : "IGNORED",
        detail: projected ? "invoice recorded" : "invoice has no known subscription",
      };
    }

    return { ...base, outcome: "IGNORED", detail: "nothing to apply" };
  }

  async #applySubscription(
    event: VerifiedBillingEvent,
    subscription: ProviderSubscription,
    correlationId: string,
  ): Promise<string> {
    // An event naming a price BuildWatch never published must not grant
    // anything, whatever else it claims (§24.1).
    let planId: string | null = null;
    if (subscription.externalPriceId !== null) {
      const price = await this.#priceResolver.resolveByExternalPriceId({
        provider: event.provider,
        environment: this.#environment,
        externalPriceId: subscription.externalPriceId,
      });
      if (price === null) {
        throw new BillingProviderError(
          "PRICE_NOT_ALLOWED",
          "Event references a price that is not in the allowlist",
          event.provider,
        );
      }
      if (
        subscription.externalProductId !== null &&
        subscription.externalProductId !== price.externalProductId
      ) {
        throw new BillingProviderError(
          "PRICE_NOT_ALLOWED",
          "Event product does not match the published price",
          event.provider,
        );
      }
      planId = price.planId;
    }

    const existing = await this.#client.tenantSubscription.findUnique({
      where: {
        provider_providerSubscriptionId: {
          provider: event.provider,
          providerSubscriptionId: subscription.providerSubscriptionId,
        },
      },
      select: {
        id: true,
        tenantId: true,
        planId: true,
        status: true,
        graceEndsAt: true,
        providerUpdatedAt: true,
      },
    });

    if (existing === null) {
      if (this.#provisioner === undefined || planId === null) {
        return "ignored:no subscription for this provider id";
      }
      const provisioned = await this.#provisioner.provision({
        event,
        subscription,
        planId,
        correlationId,
      });
      if (provisioned === null) return "ignored:signup intent could not be completed";
      this.#accessPolicy?.invalidate(provisioned.tenantId);
      return `provisioned tenant ${provisioned.tenantId}`;
    }

    // Providers retry out of order. An event older than the state we already
    // hold must not roll a tenant backwards (§20.3).
    if (
      existing.providerUpdatedAt !== null &&
      subscription.providerUpdatedAt !== null &&
      subscription.providerUpdatedAt.getTime() < existing.providerUpdatedAt.getTime()
    ) {
      this.#metrics?.increment("billing_webhook_out_of_order_total");
      return "ignored:event is older than the stored subscription state";
    }

    const lifecycle = LIFECYCLE_FOR_STATUS[subscription.status];
    const graceEndsAt = this.#resolveGrace(subscription.status, existing.graceEndsAt);
    const effectivePlanId = planId ?? existing.planId;

    await this.#client.$transaction(async (transaction) => {
      await transaction.tenantSubscription.update({
        where: { id: existing.id },
        data: {
          planId: effectivePlanId,
          status: subscription.status,
          providerCustomerId: subscription.providerCustomerId,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          canceledAt: subscription.canceledAt,
          providerUpdatedAt: subscription.providerUpdatedAt,
          graceEndsAt,
        },
      });

      await transaction.tenant.update({
        where: { id: existing.tenantId },
        data: {
          lifecycleStatus: lifecycle,
          accessChangedAt: this.#now(),
          accessReason: `SUBSCRIPTION_${subscription.status}`,
        },
      });

      await this.#refreshEntitlementSnapshot(
        transaction,
        existing.tenantId,
        effectivePlanId,
        existing.id,
      );

      await transaction.auditLog.create({
        data: {
          tenantId: existing.tenantId,
          action: AUDIT_ACTION_FOR_LIFECYCLE[lifecycle],
          entityType: "TenantSubscription",
          entityId: existing.id,
          correlationId,
          reason: `provider status ${subscription.providerStatus}`,
          metadata: {
            provider: event.provider,
            providerEventId: event.providerEventId,
            fromStatus: existing.status,
            toStatus: subscription.status,
            toLifecycle: lifecycle,
          },
        },
      });
    });

    // A cached decision must not outlive the transition that just happened.
    this.#accessPolicy?.invalidate(existing.tenantId);
    // Notified after the transaction, best effort: a mail outage must not turn a
    // recorded subscription change into a failed webhook (§26).
    await this.#notifyLifecycleChange(existing.tenantId, existing.status, lifecycle, graceEndsAt);
    return `${existing.status} → ${subscription.status} (${lifecycle})`;
  }

  /**
   * Tells the Company Admin the two things they must act on: the grace window
   * opening, and the workspace closing. Nothing is sent when the lifecycle did
   * not actually change, so a retried webhook does not spam an inbox.
   */
  async #notifyLifecycleChange(
    tenantId: string,
    fromStatus: SubscriptionStatus,
    toLifecycle: TenantLifecycleStatus,
    graceEndsAt: Date | null,
  ): Promise<void> {
    if (this.#mailer === undefined) return;
    if (toLifecycle !== "PAYMENT_GRACE" && toLifecycle !== "SUSPENDED") return;
    if (toLifecycle === "PAYMENT_GRACE" && fromStatus === "PAST_DUE") return;

    const tenant = await this.#client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        billingCustomer: { select: { billingEmail: true } },
        users: {
          where: { tenantRole: "COMPANY_ADMIN", deletedAt: null },
          select: { email: true },
          take: 1,
        },
      },
    });
    const to = tenant?.billingCustomer?.billingEmail ?? tenant?.users[0]?.email;
    if (tenant === null || to === undefined) return;

    const billingUrl = `${this.#publicBaseUrl}/admin/billing`;
    const message =
      toLifecycle === "PAYMENT_GRACE"
        ? billingMailTemplates.paymentFailed({
            companyName: tenant.name,
            graceEndsAt: graceEndsAt ?? new Date(this.#now().getTime() + this.#graceMs),
            billingUrl,
          })
        : billingMailTemplates.suspended({ companyName: tenant.name, billingUrl });
    await this.#mailer.send({ to, ...message });
  }

  /**
   * Grace starts once and is not extended by every retry of the same failure;
   * recovering to a paying state clears it.
   */
  #resolveGrace(status: SubscriptionStatus, current: Date | null): Date | null {
    if (status !== "PAST_DUE") return null;
    return current ?? new Date(this.#now().getTime() + this.#graceMs);
  }

  async #refreshEntitlementSnapshot(
    transaction: Pick<PrismaClient, "billingPlan" | "tenantEntitlementSnapshot">,
    tenantId: string,
    planId: string,
    subscriptionId: string,
  ): Promise<void> {
    const plan = await transaction.billingPlan.findUnique({
      where: { id: planId },
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

    const snapshot = buildEntitlementSnapshotFromPlanRows(plan, plan.entitlements);
    const now = this.#now();
    await transaction.tenantEntitlementSnapshot.upsert({
      where: { tenantId },
      create: {
        tenantId,
        subscriptionId,
        sourceVersion: `plan:${plan.code}@${plan.version}`,
        entitlements: serializeEntitlementSnapshot(snapshot) as never,
        effectiveFrom: now,
        refreshedAt: now,
      },
      update: {
        subscriptionId,
        sourceVersion: `plan:${plan.code}@${plan.version}`,
        entitlements: serializeEntitlementSnapshot(snapshot) as never,
        effectiveFrom: now,
        effectiveUntil: null,
        refreshedAt: now,
      },
    });
  }

  /** Records the money trail. Returns false when the invoice has no known home. */
  async #projectInvoice(invoice: ProviderInvoice, provider: BillingProviderKind): Promise<boolean> {
    if (invoice.providerSubscriptionId === null) return false;
    const subscription = await this.#client.tenantSubscription.findUnique({
      where: {
        provider_providerSubscriptionId: {
          provider,
          providerSubscriptionId: invoice.providerSubscriptionId,
        },
      },
      select: { id: true, tenantId: true },
    });
    if (subscription === null) return false;

    await this.#client.billingInvoice.upsert({
      where: {
        provider_providerInvoiceId: { provider, providerInvoiceId: invoice.providerInvoiceId },
      },
      create: {
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        provider,
        providerInvoiceId: invoice.providerInvoiceId,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        currency: invoice.currency,
        subtotalMinor: invoice.subtotalMinor,
        taxMinor: invoice.taxMinor,
        totalMinor: invoice.totalMinor,
        paidAt: invoice.paidAt,
        dueAt: invoice.dueAt,
        hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      },
      update: {
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        currency: invoice.currency,
        subtotalMinor: invoice.subtotalMinor,
        taxMinor: invoice.taxMinor,
        totalMinor: invoice.totalMinor,
        paidAt: invoice.paidAt,
        dueAt: invoice.dueAt,
        hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      },
    });
    return true;
  }
}
