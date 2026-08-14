import type { PrismaClient } from "@prisma/client";
import type { BillingInterval, BillingProviderKind } from "./billing-contracts.js";
import { BillingProviderError, type BillingProviderPriceRef } from "./billing-provider.js";

/**
 * Server-side price allowlist (landing-page-roadmap.md §20.2, §24.2).
 *
 * The browser sends a plan code and a billing interval — never an amount, a
 * currency or a provider price identifier. Everything chargeable is looked up
 * here, from BuildWatch's own tables, so a tampered request can at worst name a
 * plan that does not exist.
 */

export interface BillingPriceResolver {
  /** Resolves a plan a visitor is allowed to buy without talking to sales. */
  resolvePublicPrice(input: {
    planCode: string;
    interval: BillingInterval;
    provider: BillingProviderKind;
    environment: string;
  }): Promise<BillingProviderPriceRef>;

  /**
   * Reverse lookup used while processing a webhook. An event naming a price that
   * is not in the allowlist is refused rather than trusted (§24.1).
   */
  resolveByExternalPriceId(input: {
    provider: BillingProviderKind;
    environment: string;
    externalPriceId: string;
  }): Promise<BillingProviderPriceRef | null>;
}

interface PriceRow {
  readonly externalProductId: string;
  readonly externalPriceId: string;
  readonly environment: string;
  readonly provider: BillingProviderKind;
  readonly plan: {
    readonly id: string;
    readonly code: string;
    readonly version: number;
    readonly interval: BillingInterval;
    readonly currency: string;
    readonly unitAmountMinor: bigint | null;
    readonly active: boolean;
    readonly public: boolean;
    readonly archivedAt: Date | null;
  };
}

function toRef(row: PriceRow): BillingProviderPriceRef {
  return {
    planId: row.plan.id,
    planCode: row.plan.code,
    planVersion: row.plan.version,
    interval: row.plan.interval,
    currency: row.plan.currency,
    unitAmountMinor: row.plan.unitAmountMinor,
    provider: row.provider,
    environment: row.environment,
    externalProductId: row.externalProductId,
    externalPriceId: row.externalPriceId,
  };
}

const PRICE_SELECTION = {
  externalProductId: true,
  externalPriceId: true,
  environment: true,
  provider: true,
  plan: {
    select: {
      id: true,
      code: true,
      version: true,
      interval: true,
      currency: true,
      unitAmountMinor: true,
      active: true,
      public: true,
      archivedAt: true,
    },
  },
} as const;

export class PrismaBillingPriceResolver implements BillingPriceResolver {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async resolvePublicPrice(input: {
    planCode: string;
    interval: BillingInterval;
    provider: BillingProviderKind;
    environment: string;
  }): Promise<BillingProviderPriceRef> {
    const rows = await this.#client.billingProviderPrice.findMany({
      where: {
        provider: input.provider,
        environment: input.environment,
        plan: {
          code: input.planCode,
          interval: input.interval,
          active: true,
          public: true,
          archivedAt: null,
        },
      },
      select: PRICE_SELECTION,
      orderBy: { plan: { version: "desc" } },
      take: 1,
    });

    const row = rows[0];
    if (row === undefined) {
      // Deliberately identical whether the plan is unknown, archived, private
      // (Enterprise) or simply unmapped for this environment: a caller probing
      // plan codes learns nothing from the answer.
      throw new BillingProviderError(
        "PRICE_NOT_ALLOWED",
        "No purchasable price is configured for the requested plan",
        input.provider,
      );
    }
    if (row.plan.unitAmountMinor === null) {
      throw new BillingProviderError(
        "PRICE_NOT_ALLOWED",
        "A negotiated plan cannot be bought through self-serve checkout",
        input.provider,
      );
    }
    return toRef(row as PriceRow);
  }

  async resolveByExternalPriceId(input: {
    provider: BillingProviderKind;
    environment: string;
    externalPriceId: string;
  }): Promise<BillingProviderPriceRef | null> {
    const row = await this.#client.billingProviderPrice.findUnique({
      where: {
        provider_environment_externalPriceId: {
          provider: input.provider,
          environment: input.environment,
          externalPriceId: input.externalPriceId,
        },
      },
      select: PRICE_SELECTION,
    });
    return row === null ? null : toRef(row as PriceRow);
  }
}
