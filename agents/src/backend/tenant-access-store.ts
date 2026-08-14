import type { PrismaClient } from "@prisma/client";
import { parseEntitlementSnapshot } from "./billing-contracts.js";
import type { TenantAccessSnapshot, TenantAccessSnapshotReader } from "./tenant-access-policy.js";
import { CANONICAL_SUBSCRIPTION_STATUSES } from "./billing-contracts.js";

/**
 * Loads the locally persisted access snapshot the policy decides on
 * (landing-page-roadmap.md §19.2).
 *
 * Everything here is a plain read of BuildWatch's own tables. The payment
 * provider is never contacted on the request path.
 */
export class PrismaTenantAccessSnapshotReader implements TenantAccessSnapshotReader {
  readonly #client: PrismaClient;
  readonly #logger: { warn(event: string, fields?: Record<string, unknown>): void } | undefined;

  constructor(
    client: PrismaClient,
    logger?: { warn(event: string, fields?: Record<string, unknown>): void },
  ) {
    this.#client = client;
    this.#logger = logger;
  }

  async load(tenantId: string): Promise<TenantAccessSnapshot | null> {
    const tenant = await this.#client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        lifecycleStatus: true,
        accessReason: true,
        entitlementSnapshot: { select: { entitlements: true } },
        subscriptions: {
          where: { status: { in: [...CANONICAL_SUBSCRIPTION_STATUSES] } },
          select: {
            status: true,
            graceEndsAt: true,
            currentPeriodEnd: true,
            plan: { select: { code: true } },
          },
          take: 1,
        },
      },
    });

    if (tenant === null) return null;

    const subscription = tenant.subscriptions[0] ?? null;

    return {
      tenantId: tenant.id,
      lifecycleStatus: tenant.lifecycleStatus,
      accessReason: tenant.accessReason,
      subscriptionStatus: subscription?.status ?? null,
      planCode: subscription?.plan.code ?? null,
      graceEndsAt: subscription?.graceEndsAt ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      entitlements: this.#readEntitlements(tenantId, tenant.entitlementSnapshot?.entitlements),
    };
  }

  /**
   * A snapshot that fails to parse is treated as absent rather than as a set of
   * zero limits: fabricating "you may do nothing" out of a corrupt row would take
   * a paying tenant offline. The lifecycle gate still applies, so this cannot
   * hand access to an unpaid tenant.
   */
  #readEntitlements(tenantId: string, value: unknown): TenantAccessSnapshot["entitlements"] {
    if (value === undefined || value === null) return null;
    try {
      return parseEntitlementSnapshot(value).values;
    } catch (error) {
      this.#logger?.warn("tenant_entitlement_snapshot_unreadable", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
