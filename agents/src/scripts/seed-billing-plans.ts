import "dotenv/config";
import { prisma } from "../prisma.js";
import {
  BUILDWATCH_PLAN_CATALOG,
  BUILDWATCH_PLAN_CATALOG_VERSION,
  BILLING_FEATURE_KEYS,
  minorToMajor,
} from "../backend/billing-contracts.js";
import { resolveBillingConfig } from "../backend/billing-config.js";
import type { BillingPlanCatalogEntry } from "../backend/billing-contracts.js";

/**
 * Publishes the plan catalog from landing-page-roadmap.md §5 into BillingPlan
 * and PlanEntitlement. Safe to re-run: plans are matched on (code, version,
 * interval) and entitlements on (planId, featureKey).
 *
 * This is production configuration, not demo data, so it is not behind the demo
 * seed guard. Its own safety rule is stricter instead: a plan version that
 * already has subscriptions is never re-priced in place (roadmap §18.3). To
 * change money or limits, bump BUILDWATCH_PLAN_CATALOG_VERSION and publish a new
 * version, then migrate subscribers deliberately.
 *
 * Provider price IDs are intentionally not seeded here; they are mapped in
 * Phase 3 once the Lemon Squeezy products exist.
 */

const HELP_TEXT = `
Usage:
  pnpm.cmd run seed:billing:plans -- [options]

Options:
  --dry-run              Report the changes without writing anything
  --environment <name>   Billing environment to map manual prices into
  --help      Show this help
`.trim();

interface PlannedChange {
  readonly kind: "create" | "update" | "unchanged";
  readonly code: string;
  readonly interval: string;
  readonly detail: string;
}

function formatAmount(minor: bigint | null, currency: string): string {
  return minor === null ? "гэрээт" : `${minorToMajor(minor).toLocaleString("en-US")} ${currency}`;
}

async function seedPlan(
  entry: BillingPlanCatalogEntry,
  dryRun: boolean,
  changes: PlannedChange[],
): Promise<void> {
  for (const price of entry.prices) {
    const existing = await prisma.billingPlan.findUnique({
      where: {
        code_version_interval: {
          code: entry.code,
          version: entry.version,
          interval: price.interval,
        },
      },
      include: { entitlements: true, _count: { select: { subscriptions: true } } },
    });

    const desiredEntitlements = BILLING_FEATURE_KEYS.map((featureKey) => ({
      featureKey,
      ...entry.entitlements[featureKey],
    }));

    if (!existing) {
      changes.push({
        kind: "create",
        code: entry.code,
        interval: price.interval,
        detail: formatAmount(price.unitAmountMinor, entry.currency),
      });
      if (!dryRun) {
        await prisma.billingPlan.create({
          data: {
            code: entry.code,
            version: entry.version,
            name: entry.name,
            description: entry.description,
            interval: price.interval,
            currency: entry.currency,
            unitAmountMinor: price.unitAmountMinor,
            active: true,
            public: entry.public,
            entitlements: { create: desiredEntitlements },
          },
        });
      }
      continue;
    }

    const entitlementsByKey = new Map(
      existing.entitlements.map((entitlement) => [entitlement.featureKey, entitlement]),
    );
    const drifted = desiredEntitlements.filter((desired) => {
      const current = entitlementsByKey.get(desired.featureKey);
      return (
        !current ||
        current.enabled !== desired.enabled ||
        current.limitValue !== desired.limitValue ||
        current.unit !== desired.unit
      );
    });
    const orphaned = existing.entitlements.filter(
      (entitlement) => !BILLING_FEATURE_KEYS.includes(entitlement.featureKey as never),
    );
    const priceChanged = existing.unitAmountMinor !== price.unitAmountMinor;
    const metadataChanged =
      existing.name !== entry.name ||
      existing.description !== entry.description ||
      existing.currency !== entry.currency ||
      existing.public !== entry.public;

    if (!priceChanged && !metadataChanged && drifted.length === 0 && orphaned.length === 0) {
      changes.push({
        kind: "unchanged",
        code: entry.code,
        interval: price.interval,
        detail: formatAmount(existing.unitAmountMinor, existing.currency),
      });
      continue;
    }

    if ((priceChanged || drifted.length > 0) && existing._count.subscriptions > 0) {
      throw new Error(
        `Plan ${entry.code}@${entry.version}/${price.interval} already has ` +
          `${existing._count.subscriptions} subscription(s); re-pricing it in place would ` +
          "silently change what those tenants bought. Bump BUILDWATCH_PLAN_CATALOG_VERSION " +
          "and publish a new plan version instead (roadmap §18.3).",
      );
    }

    const detailParts: string[] = [];
    if (priceChanged) {
      detailParts.push(
        `${formatAmount(existing.unitAmountMinor, existing.currency)} → ` +
          formatAmount(price.unitAmountMinor, entry.currency),
      );
    }
    if (metadataChanged) detailParts.push("metadata");
    if (drifted.length > 0) detailParts.push(`${drifted.length} entitlement`);
    if (orphaned.length > 0) detailParts.push(`${orphaned.length} orphaned removed`);

    changes.push({
      kind: "update",
      code: entry.code,
      interval: price.interval,
      detail: detailParts.join(", "),
    });

    if (dryRun) continue;

    await prisma.$transaction(async (transaction) => {
      await transaction.billingPlan.update({
        where: { id: existing.id },
        data: {
          name: entry.name,
          description: entry.description,
          currency: entry.currency,
          unitAmountMinor: price.unitAmountMinor,
          public: entry.public,
        },
      });
      for (const desired of drifted) {
        await transaction.planEntitlement.upsert({
          where: {
            planId_featureKey: { planId: existing.id, featureKey: desired.featureKey },
          },
          create: { planId: existing.id, ...desired },
          update: {
            enabled: desired.enabled,
            limitValue: desired.limitValue,
            unit: desired.unit,
          },
        });
      }
      if (orphaned.length > 0) {
        await transaction.planEntitlement.deleteMany({
          where: { id: { in: orphaned.map((entitlement) => entitlement.id) } },
        });
      }
    });
  }
}

/**
 * Maps the manual invoice channel onto every priced plan.
 *
 * Unlike a card provider, this channel's "external price" is a BuildWatch
 * contract label, so it can be mapped deterministically here and the domestic
 * fallback works without any third-party account. Lemon Squeezy variant ids are
 * deliberately not seeded: they only exist once an operator creates the products
 * in the real store.
 */
async function seedManualInvoicePrices(
  environment: string,
  dryRun: boolean,
  changes: PlannedChange[],
): Promise<void> {
  for (const entry of BUILDWATCH_PLAN_CATALOG) {
    for (const price of entry.prices) {
      if (price.unitAmountMinor === null) continue;
      const plan = await prisma.billingPlan.findUnique({
        where: {
          code_version_interval: {
            code: entry.code,
            version: entry.version,
            interval: price.interval,
          },
        },
        select: { id: true },
      });
      if (plan === null) continue;

      const externalPriceId = `${entry.code}-${price.interval.toLowerCase()}`;
      const existing = await prisma.billingProviderPrice.findUnique({
        where: {
          planId_provider_environment: {
            planId: plan.id,
            provider: "MANUAL_INVOICE",
            environment,
          },
        },
        select: { externalPriceId: true },
      });
      if (existing?.externalPriceId === externalPriceId) continue;

      changes.push({
        kind: existing ? "update" : "create",
        code: `${entry.code} · manual/${environment}`,
        interval: price.interval,
        detail: externalPriceId,
      });
      if (dryRun) continue;

      await prisma.billingProviderPrice.upsert({
        where: {
          planId_provider_environment: {
            planId: plan.id,
            provider: "MANUAL_INVOICE",
            environment,
          },
        },
        create: {
          planId: plan.id,
          provider: "MANUAL_INVOICE",
          environment,
          externalProductId: "buildwatch-contract",
          externalPriceId,
        },
        update: { externalProductId: "buildwatch-contract", externalPriceId },
      });
    }
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(HELP_TEXT);
    return;
  }
  const dryRun = process.argv.includes("--dry-run");
  const environment = argument("--environment") ?? resolveBillingConfig().environment;
  const changes: PlannedChange[] = [];

  for (const entry of BUILDWATCH_PLAN_CATALOG) {
    await seedPlan(entry, dryRun, changes);
  }
  await seedManualInvoicePrices(environment, dryRun, changes);

  console.log(
    `Plan catalog version ${BUILDWATCH_PLAN_CATALOG_VERSION}${dryRun ? " (dry run)" : ""}`,
  );
  for (const change of changes) {
    const marker = change.kind === "create" ? "+" : change.kind === "update" ? "~" : "=";
    console.log(`  ${marker} ${change.code}/${change.interval}: ${change.detail}`);
  }
  const created = changes.filter((change) => change.kind === "create").length;
  const updated = changes.filter((change) => change.kind === "update").length;
  console.log(
    `${created} created, ${updated} updated, ${changes.length - created - updated} unchanged`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
