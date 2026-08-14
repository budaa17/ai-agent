import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Phase9ApiError } from "./contracts.js";
import {
  buildEntitlementSnapshot,
  findPlanCatalogEntry,
  serializeEntitlementSnapshot,
} from "./billing-contracts.js";
import type { TenantAccessPolicy } from "./tenant-access-policy.js";
import type { PlatformAuthenticatedPrincipal } from "./platform-contracts.js";

/**
 * Platform billing oversight and operator actions
 * (landing-page-roadmap.md §22, §23.3, Phase 8).
 *
 * The platform team can see every tenant's billing health and can act on the two
 * things automation cannot decide: whether a bank transfer actually arrived, and
 * whether a tenant deserves a time-boxed exception. Both are audited; neither
 * touches the tenant's business data.
 */

export interface PlatformBillingOverview {
  /** @deprecated Use activeTenants; retained for older clients. */
  readonly active: number;
  readonly activeTenants: number;
  readonly activeSubscriptions: number;
  readonly activeWithoutSubscription: number;
  readonly pendingPayment: number;
  readonly inGrace: number;
  readonly suspended: number;
  readonly graceEndingWithin7Days: number;
  readonly failedWebhooks: number;
  readonly unpaidInvoices: number;
}

export interface PlatformBillingServiceOptions {
  readonly client: PrismaClient;
  readonly accessPolicy?: TenantAccessPolicy;
  readonly now?: () => Date;
}

const OVERRIDE_MAX_DAYS = 90;

export class PlatformBillingService {
  readonly #client: PrismaClient;
  readonly #accessPolicy: TenantAccessPolicy | undefined;
  readonly #now: () => Date;

  constructor(options: PlatformBillingServiceOptions) {
    this.#client = options.client;
    this.#accessPolicy = options.accessPolicy;
    this.#now = options.now ?? (() => new Date());
  }

  async overview(): Promise<PlatformBillingOverview> {
    const now = this.#now();
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);
    const [
      active,
      activeSubscriptions,
      activeWithoutSubscription,
      pendingPayment,
      inGrace,
      suspended,
      graceSoon,
      failedWebhooks,
      unpaid,
    ] = await Promise.all([
      this.#client.tenant.count({ where: { lifecycleStatus: "ACTIVE" } }),
      this.#client.tenantSubscription.count({
        where: { status: { in: ["ACTIVE", "TRIALING"] } },
      }),
      this.#client.tenant.count({
        where: {
          lifecycleStatus: "ACTIVE",
          subscriptions: { none: { status: { in: ["ACTIVE", "TRIALING"] } } },
        },
      }),
      this.#client.tenant.count({ where: { lifecycleStatus: "PENDING_PAYMENT" } }),
      this.#client.tenant.count({ where: { lifecycleStatus: "PAYMENT_GRACE" } }),
      this.#client.tenant.count({ where: { lifecycleStatus: "SUSPENDED" } }),
      this.#client.tenantSubscription.count({
        where: { status: "PAST_DUE", graceEndsAt: { gte: now, lte: soon } },
      }),
      this.#client.billingWebhookEvent.count({ where: { status: "FAILED" } }),
      this.#client.billingInvoice.count({ where: { status: { in: ["OPEN", "UNCOLLECTIBLE"] } } }),
    ]);

    // MRR is deliberately absent: the roadmap forbids publishing a revenue figure
    // before invoice reconciliation is trustworthy (§22).
    return {
      active,
      activeTenants: active,
      activeSubscriptions,
      activeWithoutSubscription,
      pendingPayment,
      inGrace,
      suspended,
      graceEndingWithin7Days: graceSoon,
      failedWebhooks,
      unpaidInvoices: unpaid,
    };
  }

  async subscriptions(filter: { status?: string; limit?: number } = {}) {
    const rows = await this.#client.tenantSubscription.findMany({
      where: filter.status === undefined ? {} : { status: filter.status as never },
      orderBy: [{ status: "asc" }, { currentPeriodEnd: "asc" }],
      take: Math.min(Math.max(filter.limit ?? 100, 1), 200),
      select: {
        id: true,
        status: true,
        provider: true,
        currentPeriodEnd: true,
        graceEndsAt: true,
        cancelAtPeriodEnd: true,
        providerSubscriptionId: true,
        tenant: { select: { id: true, slug: true, name: true, lifecycleStatus: true } },
        plan: { select: { code: true, interval: true, currency: true, unitAmountMinor: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      provider: row.provider,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      graceEndsAt: row.graceEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      // The provider's own identifier is useful for reconciliation and is not a
      // secret, unlike the API key or the signature.
      providerSubscriptionId: row.providerSubscriptionId,
      tenant: row.tenant,
      planCode: row.plan.code,
      interval: row.plan.interval,
      currency: row.plan.currency,
      unitAmountMinor: row.plan.unitAmountMinor?.toString() ?? null,
    }));
  }

  async webhookHealth(limit = 50) {
    const rows = await this.#client.billingWebhookEvent.findMany({
      where: { status: { in: ["FAILED", "RECEIVED", "PROCESSING"] } },
      orderBy: { receivedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        provider: true,
        providerEventId: true,
        eventType: true,
        status: true,
        attemptCount: true,
        lastErrorCode: true,
        receivedAt: true,
        correlationId: true,
      },
    });
    return rows.map((row) => ({ ...row, receivedAt: row.receivedAt.toISOString() }));
  }

  async invoices(filter: { tenantId?: string; limit?: number } = {}) {
    const rows = await this.#client.billingInvoice.findMany({
      where: filter.tenantId === undefined ? {} : { tenantId: filter.tenantId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(filter.limit ?? 100, 1), 200),
      select: {
        id: true,
        status: true,
        provider: true,
        providerInvoiceId: true,
        invoiceNumber: true,
        currency: true,
        totalMinor: true,
        paidAt: true,
        dueAt: true,
        createdAt: true,
        tenant: { select: { id: true, slug: true, name: true } },
      },
    });
    return rows.map((row) => ({
      ...row,
      totalMinor: row.totalMinor.toString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      dueAt: row.dueAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Confirms a bank transfer against a manual invoice subscription.
   *
   * This is the only way a domestic contract customer becomes active: there is no
   * third party to sign a webhook for a wire transfer. It is therefore the most
   * sensitive action on the platform, and every part of it is recorded — who,
   * when, which invoice, which reference, and what the tenant looked like before.
   */
  async confirmManualPayment(input: {
    actor: PlatformAuthenticatedPrincipal;
    subscriptionId: string;
    paymentReference: string;
    periodEnd: Date;
    amountMinor: bigint;
    currency: string;
    taxMinor: bigint;
    reason: string;
  }): Promise<{ tenantId: string; invoiceId: string }> {
    const subscription = await this.#client.tenantSubscription.findUnique({
      where: { id: input.subscriptionId },
      select: {
        id: true,
        tenantId: true,
        provider: true,
        status: true,
        tenant: { select: { lifecycleStatus: true } },
      },
    });
    if (subscription === null) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Subscription not found");
    }
    if (subscription.provider !== "MANUAL_INVOICE") {
      // A card subscription is activated by a signed provider event. Letting an
      // operator mark one paid by hand would bypass the payment evidence trail.
      throw new Phase9ApiError(
        "VALIDATION_FAILED",
        409,
        "Only manual invoice subscriptions can be confirmed by an operator",
      );
    }
    if (input.periodEnd.getTime() <= this.#now().getTime()) {
      throw new Phase9ApiError("VALIDATION_FAILED", 400, "The paid period must end in the future");
    }

    const now = this.#now();
    const invoiceId = randomUUID();
    const subtotal = input.amountMinor;

    await this.#client.$transaction(async (transaction) => {
      await transaction.billingInvoice.create({
        data: {
          id: invoiceId,
          tenantId: subscription.tenantId,
          subscriptionId: subscription.id,
          provider: "MANUAL_INVOICE",
          providerInvoiceId: `manual:${input.paymentReference}`,
          invoiceNumber: input.paymentReference,
          status: "PAID",
          currency: input.currency,
          subtotalMinor: subtotal,
          taxMinor: input.taxMinor,
          totalMinor: subtotal + input.taxMinor,
          paidAt: now,
        },
      });
      await transaction.tenantSubscription.update({
        where: { id: subscription.id },
        data: {
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd: input.periodEnd,
          graceEndsAt: null,
        },
      });
      await transaction.tenant.update({
        where: { id: subscription.tenantId },
        data: {
          lifecycleStatus: "ACTIVE",
          accessChangedAt: now,
          accessReason: "MANUAL_INVOICE_CONFIRMED",
        },
      });
      await this.#refreshSnapshot(transaction, subscription.tenantId, subscription.id);
      await transaction.platformAuditLog.create({
        data: {
          actorPrincipalId: input.actor.principalId,
          action: "MANUAL_INVOICE_CONFIRMED",
          result: "SUCCESS",
          entityType: "TenantSubscription",
          entityId: subscription.id,
          tenantId: subscription.tenantId,
          reason: input.reason,
          correlationId: randomUUID(),
          metadata: {
            paymentReference: input.paymentReference,
            fromStatus: subscription.status,
            fromLifecycle: subscription.tenant.lifecycleStatus,
            periodEnd: input.periodEnd.toISOString(),
            totalMinor: (subtotal + input.taxMinor).toString(),
            currency: input.currency,
          },
        },
      });
    });

    this.#accessPolicy?.invalidate(subscription.tenantId);
    return { tenantId: subscription.tenantId, invoiceId };
  }

  /**
   * Grants a time-boxed access exception without pretending a payment happened.
   *
   * The subscription is left exactly as it is — only the tenant lifecycle moves,
   * with an expiry, so the override is visibly temporary and reconciliation still
   * sees the unpaid subscription underneath.
   */
  async grantAccessOverride(input: {
    actor: PlatformAuthenticatedPrincipal;
    tenantId: string;
    expiresAt: Date;
    reason: string;
  }): Promise<{ tenantId: string; expiresAt: string }> {
    const now = this.#now();
    const maxExpiry = new Date(now.getTime() + OVERRIDE_MAX_DAYS * 24 * 60 * 60 * 1_000);
    if (input.expiresAt.getTime() <= now.getTime() || input.expiresAt > maxExpiry) {
      throw new Phase9ApiError(
        "VALIDATION_FAILED",
        400,
        `An override must expire within ${OVERRIDE_MAX_DAYS} days`,
      );
    }
    const tenant = await this.#client.tenant.findUnique({
      where: { id: input.tenantId },
      select: { lifecycleStatus: true },
    });
    if (tenant === null) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Workspace not found");
    }

    await this.#client.$transaction(async (transaction) => {
      await transaction.tenant.update({
        where: { id: input.tenantId },
        data: {
          lifecycleStatus: "ACTIVE",
          accessChangedAt: now,
          accessReason: `OVERRIDE_UNTIL_${input.expiresAt.toISOString()}`,
        },
      });
      await transaction.platformAuditLog.create({
        data: {
          actorPrincipalId: input.actor.principalId,
          action: "BILLING_ACCESS_OVERRIDE_CREATED",
          result: "SUCCESS",
          entityType: "Tenant",
          entityId: input.tenantId,
          tenantId: input.tenantId,
          reason: input.reason,
          correlationId: randomUUID(),
          metadata: {
            fromLifecycle: tenant.lifecycleStatus,
            expiresAt: input.expiresAt.toISOString(),
          },
        },
      });
    });

    this.#accessPolicy?.invalidate(input.tenantId);
    return { tenantId: input.tenantId, expiresAt: input.expiresAt.toISOString() };
  }

  /**
   * Expires overrides whose window has passed.
   *
   * Without this an override is permanent in practice, which is exactly what a
   * time-boxed exception must not be. Runs from the scheduled job.
   */
  async expireOverrides(): Promise<number> {
    const now = this.#now();
    const candidates = await this.#client.tenant.findMany({
      where: { lifecycleStatus: "ACTIVE", accessReason: { startsWith: "OVERRIDE_UNTIL_" } },
      select: { id: true, accessReason: true },
    });
    let expired = 0;
    for (const tenant of candidates) {
      const iso = tenant.accessReason?.slice("OVERRIDE_UNTIL_".length) ?? "";
      const expiresAt = new Date(iso);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > now.getTime()) continue;

      await this.#client.$transaction(async (transaction) => {
        await transaction.tenant.update({
          where: { id: tenant.id },
          data: {
            lifecycleStatus: "SUSPENDED",
            accessChangedAt: now,
            accessReason: "OVERRIDE_EXPIRED",
          },
        });
        await transaction.platformAuditLog.create({
          data: {
            actorPrincipalId: null,
            action: "BILLING_ACCESS_OVERRIDE_EXPIRED",
            result: "SUCCESS",
            entityType: "Tenant",
            entityId: tenant.id,
            tenantId: tenant.id,
            reason: "scheduled expiry",
            correlationId: randomUUID(),
            metadata: { expiredAt: iso },
          },
        });
      });
      this.#accessPolicy?.invalidate(tenant.id);
      expired += 1;
    }
    return expired;
  }

  async #refreshSnapshot(
    transaction: Pick<PrismaClient, "tenantSubscription" | "tenantEntitlementSnapshot">,
    tenantId: string,
    subscriptionId: string,
  ): Promise<void> {
    const subscription = await transaction.tenantSubscription.findUnique({
      where: { id: subscriptionId },
      select: { plan: { select: { code: true, interval: true } } },
    });
    // A snapshot refresh must never be the thing that fails a confirmed payment,
    // so an unexpected shape is skipped rather than thrown.
    const planCode = subscription?.plan?.code;
    const entry = planCode === undefined ? undefined : findPlanCatalogEntry(planCode);
    if (subscription === null || entry === undefined) return;
    const now = this.#now();
    const entitlements = serializeEntitlementSnapshot(
      buildEntitlementSnapshot(entry, subscription.plan.interval),
    ) as never;
    await transaction.tenantEntitlementSnapshot.upsert({
      where: { tenantId },
      create: {
        tenantId,
        subscriptionId,
        sourceVersion: `plan:${entry.code}@${entry.version}`,
        entitlements,
        effectiveFrom: now,
        refreshedAt: now,
      },
      update: {
        subscriptionId,
        sourceVersion: `plan:${entry.code}@${entry.version}`,
        entitlements,
        effectiveFrom: now,
        effectiveUntil: null,
        refreshedAt: now,
      },
    });
  }
}
