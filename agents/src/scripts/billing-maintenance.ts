import "dotenv/config";
import { prisma } from "../prisma.js";
import { resolvePhase9BackendConfig } from "../backend/config.js";
import { resolveBillingConfig } from "../backend/billing-config.js";
import { createBillingProviders } from "../backend/billing-checkout-service.js";
import { BillingReconciliationService } from "../backend/billing-reconciliation.js";
import { PlatformBillingService } from "../backend/platform-billing-service.js";
import { CompanySignupService } from "../backend/billing-signup-service.js";
import {
  BillingCheckoutService,
  PrismaCheckoutIdempotencyStore,
} from "../backend/billing-checkout-service.js";
import { PrismaBillingPriceResolver } from "../backend/billing-price-resolver.js";
import { TenantAccessPolicy } from "../backend/tenant-access-policy.js";
import { PrismaTenantAccessSnapshotReader } from "../backend/tenant-access-store.js";

/**
 * Scheduled billing maintenance (landing-page-roadmap.md §25).
 *
 * Three jobs that keep the record honest between webhooks:
 *   - reconcile subscriptions against the provider,
 *   - expire time-boxed access overrides,
 *   - drop abandoned signup intents so unconfirmed personal data does not linger.
 *
 * Run from cron. Safe to run repeatedly; every step is idempotent.
 */

async function main() {
  const config = resolvePhase9BackendConfig();
  const billingConfig = resolveBillingConfig();
  const providers = createBillingProviders({
    config: billingConfig,
    manualInstructionsBaseUrl: `${config.publicBaseUrl.replace(/\/+$/, "")}/company-signup`,
  });
  const accessPolicy = new TenantAccessPolicy(new PrismaTenantAccessSnapshotReader(prisma));

  const reconciliation = new BillingReconciliationService({
    client: prisma,
    providers,
    accessPolicy,
  });
  const platformBilling = new PlatformBillingService({ client: prisma, accessPolicy });
  const signups = new CompanySignupService({
    client: prisma,
    checkout: new BillingCheckoutService({
      config: billingConfig,
      providers,
      priceResolver: new PrismaBillingPriceResolver(prisma),
      idempotency: new PrismaCheckoutIdempotencyStore(prisma),
    }),
    provider: billingConfig.provider,
    successUrl: `${config.publicBaseUrl.replace(/\/+$/, "")}/checkout/success`,
    publicBaseUrl: config.publicBaseUrl,
    verificationSecret: config.emailVerificationSecret,
    nodeEnv: config.nodeEnv,
  });

  const report = await reconciliation.reconcile();
  const expiredOverrides = await platformBilling.expireOverrides();
  const purgedIntents = await signups.purgeExpired();

  process.stdout.write(
    `${JSON.stringify(
      {
        reconciliation: {
          checked: report.checked,
          inSync: report.inSync,
          repaired: report.repaired,
          unknown: report.unknown,
          skipped: report.skipped,
        },
        expiredOverrides,
        purgedIntents,
      },
      null,
      2,
    )}\n`,
  );

  for (const entry of report.entries.filter((item) => item.outcome !== "IN_SYNC")) {
    process.stdout.write(`${entry.outcome}  ${entry.subscriptionId}  ${entry.detail}\n`);
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Billing maintenance failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
