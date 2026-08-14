import type { PrismaClient } from "@prisma/client";
import { Phase9ApiError } from "./contracts.js";
import type { BillingFeatureKey } from "./billing-contracts.js";
import { parseEntitlementSnapshot } from "./billing-contracts.js";
import { BillingProviderError, type BillingProvider } from "./billing-provider.js";
import type { BillingProviderKind } from "./billing-contracts.js";
import type { TenantAccessPolicy } from "./tenant-access-policy.js";

/**
 * Company Admin billing read model and actions
 * (landing-page-roadmap.md §21, §23.2).
 *
 * Everything here must keep working while the workspace itself is gated: this is
 * the screen a company uses to get out of a failed payment.
 */

export interface TenantUsageSnapshot {
  readonly activeProjects: number;
  readonly activeUsers: number;
  readonly storageBytes: bigint;
  readonly aiRunsThisMonth: number;
  readonly aiMicroUsdThisMonth: bigint;
  readonly periodStart: Date;
}

/**
 * Counts what the plan limits are measured against.
 *
 * Every value is a real count. When one cannot be read the caller receives
 * `null` rather than zero: reporting unknown usage as none would hand out
 * capacity nobody paid for (§28).
 */
export class PrismaTenantUsageReader {
  readonly #client: PrismaClient;
  readonly #now: () => Date;

  constructor(client: PrismaClient, now: () => Date = () => new Date()) {
    this.#client = client;
    this.#now = now;
  }

  monthStart(): Date {
    const now = this.#now();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  async read(tenantId: string): Promise<TenantUsageSnapshot> {
    const periodStart = this.monthStart();
    const [activeProjects, activeUsers, storage, agentRuns, budget] = await Promise.all([
      this.#client.project.count({
        where: { tenantId, status: { in: ["PLANNED", "ACTIVE", "PAUSED"] } },
      }),
      this.#client.user.count({
        where: { tenantId, deletedAt: null, status: { in: ["ACTIVE", "INVITED"] } },
      }),
      this.#client.fileAsset.aggregate({ where: { tenantId }, _sum: { sizeBytes: true } }),
      this.#client.agentRun.count({ where: { tenantId, startedAt: { gte: periodStart } } }),
      this.#client.agentUsageBudget.aggregate({
        where: { tenantId },
        _sum: { usedMicroUsd: true },
      }),
    ]);

    return {
      activeProjects,
      activeUsers,
      storageBytes: BigInt(storage._sum?.sizeBytes ?? 0),
      aiRunsThisMonth: agentRuns,
      aiMicroUsdThisMonth: BigInt(budget._sum.usedMicroUsd ?? 0),
      periodStart,
    };
  }

  /** Reads a single counter, used by the limit gates on the write path. */
  async count(tenantId: string, featureKey: BillingFeatureKey): Promise<number | bigint | null> {
    switch (featureKey) {
      case "PROJECT_ACTIVE_MAX":
        return this.#client.project.count({
          where: { tenantId, status: { in: ["PLANNED", "ACTIVE", "PAUSED"] } },
        });
      case "USER_ACTIVE_MAX":
        return this.#client.user.count({
          where: { tenantId, deletedAt: null, status: { in: ["ACTIVE", "INVITED"] } },
        });
      case "STORAGE_BYTES_MAX": {
        const storage = await this.#client.fileAsset.aggregate({
          where: { tenantId },
          _sum: { sizeBytes: true },
        });
        return BigInt(storage._sum?.sizeBytes ?? 0);
      }
      case "AI_MONTHLY_RUNS_INCLUDED":
        return this.#client.agentRun.count({
          where: { tenantId, startedAt: { gte: this.monthStart() } },
        });
      case "AI_MONTHLY_MICRO_USD_MAX": {
        const budget = await this.#client.agentUsageBudget.aggregate({
          where: { tenantId },
          _sum: { usedMicroUsd: true },
        });
        return BigInt(budget._sum.usedMicroUsd ?? 0);
      }
      default:
        return null;
    }
  }
}

/**
 * Business overage pricing from the roadmap: 65,000₮ per 100 AI runs beyond the
 * plan allowance (§6.2). Kept beside the read model that reports it so the two
 * cannot drift.
 */
const AI_OVERAGE_BLOCK_RUNS = 100;
const AI_OVERAGE_BLOCK_PRICE_MINOR = 6_500_000n;

export interface TenantBillingServiceOptions {
  readonly client: PrismaClient;
  readonly usage: PrismaTenantUsageReader;
  readonly providers: ReadonlyMap<BillingProviderKind, BillingProvider>;
  readonly accessPolicy?: TenantAccessPolicy;
  readonly now?: () => Date;
}

export class TenantBillingService {
  readonly #client: PrismaClient;
  readonly #usage: PrismaTenantUsageReader;
  readonly #providers: ReadonlyMap<BillingProviderKind, BillingProvider>;
  readonly #accessPolicy: TenantAccessPolicy | undefined;
  readonly #now: () => Date;

  constructor(options: TenantBillingServiceOptions) {
    this.#client = options.client;
    this.#usage = options.usage;
    this.#providers = options.providers;
    this.#accessPolicy = options.accessPolicy;
    this.#now = options.now ?? (() => new Date());
  }

  async subscription(tenantId: string) {
    const tenant = await this.#client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        lifecycleStatus: true,
        accessReason: true,
        accessChangedAt: true,
        billingCustomer: { select: { provider: true, billingEmail: true, vatPayer: true } },
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            provider: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            graceEndsAt: true,
            cancelAtPeriodEnd: true,
            canceledAt: true,
            plan: {
              select: {
                code: true,
                version: true,
                name: true,
                interval: true,
                currency: true,
                unitAmountMinor: true,
              },
            },
          },
        },
      },
    });
    if (tenant === null) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Workspace not found");
    }
    const subscription = tenant.subscriptions[0] ?? null;
    return {
      lifecycleStatus: tenant.lifecycleStatus,
      accessReason: tenant.accessReason,
      accessChangedAt: tenant.accessChangedAt?.toISOString() ?? null,
      billingEmail: tenant.billingCustomer?.billingEmail ?? null,
      vatPayer: tenant.billingCustomer?.vatPayer ?? false,
      subscription:
        subscription === null
          ? null
          : {
              status: subscription.status,
              provider: subscription.provider,
              planCode: subscription.plan.code,
              planName: subscription.plan.name,
              planVersion: subscription.plan.version,
              interval: subscription.plan.interval,
              currency: subscription.plan.currency,
              unitAmountMinor: subscription.plan.unitAmountMinor?.toString() ?? null,
              currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
              currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
              graceEndsAt: subscription.graceEndsAt?.toISOString() ?? null,
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
              canceledAt: subscription.canceledAt?.toISOString() ?? null,
            },
    };
  }

  async entitlements(tenantId: string) {
    const snapshot = await this.#client.tenantEntitlementSnapshot.findUnique({
      where: { tenantId },
      select: { entitlements: true, sourceVersion: true, refreshedAt: true },
    });
    if (snapshot === null) {
      // A grandfathered workspace has no plan record; saying so is more useful
      // than pretending every limit is zero.
      return { source: "GRANDFATHERED", refreshedAt: null, values: null };
    }
    try {
      const parsed = parseEntitlementSnapshot(snapshot.entitlements);
      return {
        source: snapshot.sourceVersion,
        refreshedAt: snapshot.refreshedAt.toISOString(),
        values: Object.fromEntries(
          Object.entries(parsed.values).map(([key, value]) => [
            key,
            {
              enabled: value.enabled,
              limitValue: value.limitValue?.toString() ?? null,
              unit: value.unit,
            },
          ]),
        ),
      };
    } catch {
      return { source: "UNREADABLE", refreshedAt: null, values: null };
    }
  }

  async usage(tenantId: string) {
    const snapshot = await this.#usage.read(tenantId);
    return {
      periodStart: snapshot.periodStart.toISOString(),
      activeProjects: snapshot.activeProjects,
      activeUsers: snapshot.activeUsers,
      storageBytes: snapshot.storageBytes.toString(),
      aiRunsThisMonth: snapshot.aiRunsThisMonth,
      aiMicroUsdThisMonth: snapshot.aiMicroUsdThisMonth.toString(),
      overage: await this.overage(tenantId, snapshot),
    };
  }

  /**
   * What this month's AI use beyond the plan will cost (roadmap §6.2).
   *
   * Shown to the Company Admin as it accrues rather than appearing for the first
   * time on an invoice. Plans without overage report zero: the gate stops them
   * instead of charging them.
   */
  async overage(
    tenantId: string,
    snapshot?: TenantUsageSnapshot,
  ): Promise<{
    allowed: boolean;
    includedRuns: string | null;
    overageRuns: number;
    blockSize: number;
    blockPriceMinor: string;
    amountMinor: string;
    currency: string;
  }> {
    const usage = snapshot ?? (await this.#usage.read(tenantId));
    const entitlements = await this.#client.tenantEntitlementSnapshot.findUnique({
      where: { tenantId },
      select: { entitlements: true },
    });

    const empty = {
      allowed: false,
      includedRuns: null,
      overageRuns: 0,
      blockSize: AI_OVERAGE_BLOCK_RUNS,
      blockPriceMinor: AI_OVERAGE_BLOCK_PRICE_MINOR.toString(),
      amountMinor: "0",
      currency: "MNT",
    };
    if (entitlements === null) return empty;

    let values;
    try {
      values = parseEntitlementSnapshot(entitlements.entitlements).values;
    } catch {
      return empty;
    }
    const allowed = values.AI_OVERAGE_ALLOWED.enabled;
    const included = values.AI_MONTHLY_RUNS_INCLUDED.limitValue;
    if (!allowed || included === null) return { ...empty, allowed };

    const over = BigInt(usage.aiRunsThisMonth) - included;
    if (over <= 0n) {
      return { ...empty, allowed: true, includedRuns: included.toString() };
    }
    // Billed in whole blocks, rounded up: a single run past the allowance costs
    // one block, which is what the pricing page states.
    const blocks = (over + BigInt(AI_OVERAGE_BLOCK_RUNS) - 1n) / BigInt(AI_OVERAGE_BLOCK_RUNS);
    return {
      allowed: true,
      includedRuns: included.toString(),
      overageRuns: Number(over),
      blockSize: AI_OVERAGE_BLOCK_RUNS,
      blockPriceMinor: AI_OVERAGE_BLOCK_PRICE_MINOR.toString(),
      amountMinor: (blocks * AI_OVERAGE_BLOCK_PRICE_MINOR).toString(),
      currency: "MNT",
    };
  }

  async invoices(tenantId: string, limit = 50) {
    const invoices = await this.#client.billingInvoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        currency: true,
        subtotalMinor: true,
        taxMinor: true,
        totalMinor: true,
        paidAt: true,
        dueAt: true,
        hostedInvoiceUrl: true,
        createdAt: true,
      },
    });
    return invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      currency: invoice.currency,
      subtotalMinor: invoice.subtotalMinor.toString(),
      taxMinor: invoice.taxMinor.toString(),
      totalMinor: invoice.totalMinor.toString(),
      paidAt: invoice.paidAt?.toISOString() ?? null,
      dueAt: invoice.dueAt?.toISOString() ?? null,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      createdAt: invoice.createdAt.toISOString(),
    }));
  }

  /**
   * Hands the admin to the provider's own portal. Payment methods are changed
   * there, never here, so no card data reaches BuildWatch (§24.4).
   */
  async portal(tenantId: string, correlationId: string): Promise<{ url: string }> {
    const subscription = await this.#requireCanonicalSubscription(tenantId);
    const provider = this.#providers.get(subscription.provider);
    if (provider === undefined) {
      throw new Phase9ApiError("INTERNAL_ERROR", 503, "Billing channel is unavailable");
    }
    try {
      const portal = await provider.createCustomerPortal({
        providerSubscriptionId: subscription.providerSubscriptionId ?? "",
        providerCustomerId: subscription.providerCustomerId,
        correlationId,
      });
      return { url: portal.url };
    } catch (error) {
      if (error instanceof BillingProviderError && error.code === "UNSUPPORTED_OPERATION") {
        // The domestic invoice channel has no provider portal; that is a product
        // fact, not a server fault.
        throw new Phase9ApiError(
          "FEATURE_NOT_INCLUDED",
          409,
          "This billing channel is managed through your invoices, not a provider portal",
        );
      }
      throw error;
    }
  }

  async cancel(
    tenantId: string,
    actorUserId: string,
    correlationId: string,
    reason: string | null,
  ): Promise<{ cancelAtPeriodEnd: true; currentPeriodEnd: string | null }> {
    const subscription = await this.#requireCanonicalSubscription(tenantId);
    const provider = this.#providers.get(subscription.provider);
    if (provider !== undefined && subscription.providerSubscriptionId !== null) {
      try {
        await provider.cancelAtPeriodEnd(subscription.providerSubscriptionId);
      } catch (error) {
        // The contract channel is ended by the platform team; the local flag is
        // still recorded so the intent is not lost.
        if (!(error instanceof BillingProviderError && error.code === "UNSUPPORTED_OPERATION")) {
          throw error;
        }
      }
    }

    await this.#client.$transaction(async (transaction) => {
      await transaction.tenantSubscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: true, canceledAt: this.#now() },
      });
      await transaction.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: "SUBSCRIPTION_CANCELED",
          entityType: "TenantSubscription",
          entityId: subscription.id,
          correlationId,
          reason,
          metadata: { cancelAtPeriodEnd: true, provider: subscription.provider },
        },
      });
    });
    this.#accessPolicy?.invalidate(tenantId);

    return {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    };
  }

  async #requireCanonicalSubscription(tenantId: string) {
    const subscription = await this.#client.tenantSubscription.findFirst({
      where: {
        tenantId,
        status: { in: ["PENDING", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"] },
      },
      select: {
        id: true,
        provider: true,
        providerSubscriptionId: true,
        providerCustomerId: true,
        currentPeriodEnd: true,
      },
    });
    if (subscription === null) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "No active subscription");
    }
    return subscription;
  }
}
