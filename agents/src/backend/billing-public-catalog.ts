import type { PrismaClient } from "@prisma/client";
import { MONGOLIAN_VAT_RATE_BASIS_POINTS } from "./billing-contracts.js";
import type { BillingInterval } from "./billing-contracts.js";

/**
 * Public pricing read model (landing-page-roadmap.md §13, §23.1).
 *
 * The pricing page renders from this response and nothing else. Limits are not
 * retyped into marketing copy, so an entitlement change cannot leave the page
 * promising a number the backend does not enforce.
 *
 * Internal plan ids, provider price ids, unpublished plans and negotiated
 * Enterprise amounts never appear here (§23.3).
 */

export interface PublicPlanPrice {
  readonly interval: BillingInterval;
  /** VAT-exclusive amount in ISO 4217 minor units, as a string for JSON safety. */
  readonly unitAmountMinor: string;
}

export interface PublicPlanEntitlement {
  readonly featureKey: string;
  readonly enabled: boolean;
  readonly limitValue: string | null;
  readonly unit: string | null;
}

export interface PublicPlanView {
  readonly code: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly currency: string;
  readonly prices: readonly PublicPlanPrice[];
  readonly entitlements: readonly PublicPlanEntitlement[];
}

export interface PublicPlanCatalogResponse {
  readonly currency: string;
  readonly vatRateBasisPoints: number;
  readonly vatIncluded: false;
  readonly plans: readonly PublicPlanView[];
}

export class PrismaPublicPlanCatalog {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async listPublicPlans(): Promise<PublicPlanCatalogResponse> {
    const rows = await this.#client.billingPlan.findMany({
      where: { public: true, active: true, archivedAt: null },
      select: {
        code: true,
        version: true,
        name: true,
        description: true,
        currency: true,
        interval: true,
        unitAmountMinor: true,
        entitlements: {
          select: { featureKey: true, enabled: true, limitValue: true, unit: true },
          orderBy: { featureKey: "asc" },
        },
      },
      orderBy: [{ code: "asc" }, { version: "desc" }],
    });

    const byCode = new Map<string, PublicPlanView & { prices: PublicPlanPrice[] }>();
    for (const row of rows) {
      if (row.unitAmountMinor === null) continue;
      const existing = byCode.get(row.code);
      if (existing === undefined) {
        byCode.set(row.code, {
          code: row.code,
          version: row.version,
          name: row.name,
          description: row.description,
          currency: row.currency,
          prices: [{ interval: row.interval, unitAmountMinor: row.unitAmountMinor.toString() }],
          entitlements: row.entitlements.map((entitlement) => ({
            featureKey: entitlement.featureKey,
            enabled: entitlement.enabled,
            limitValue: entitlement.limitValue?.toString() ?? null,
            unit: entitlement.unit,
          })),
        });
        continue;
      }
      // Only the newest version of a plan code is published, so older rows are
      // skipped rather than merged into it.
      if (row.version !== existing.version) continue;
      existing.prices.push({
        interval: row.interval,
        unitAmountMinor: row.unitAmountMinor.toString(),
      });
    }

    const plans = [...byCode.values()].map((plan) => ({
      ...plan,
      prices: [...plan.prices].sort((left, right) => left.interval.localeCompare(right.interval)),
    }));

    return {
      currency: plans[0]?.currency ?? "MNT",
      vatRateBasisPoints: MONGOLIAN_VAT_RATE_BASIS_POINTS,
      vatIncluded: false,
      plans,
    };
  }
}
