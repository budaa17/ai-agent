import "dotenv/config";
import Stripe from "stripe";
import { BUILDWATCH_PLAN_CATALOG } from "../backend/billing-contracts.js";
import { resolveBillingConfig } from "../backend/billing-config.js";
import { prisma } from "../prisma.js";

const PRICE_ENV: Readonly<Record<string, string>> = {
  "starter:MONTH": "STRIPE_STARTER_MONTH_PRICE_ID",
  "starter:YEAR": "STRIPE_STARTER_YEAR_PRICE_ID",
  "business:MONTH": "STRIPE_BUSINESS_MONTH_PRICE_ID",
  "business:YEAR": "STRIPE_BUSINESS_YEAR_PRICE_ID",
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || !/^price_[A-Za-z0-9]+$/u.test(value)) {
    throw new Error(`${name} must contain a Stripe Price id (price_...)`);
  }
  return value;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const config = resolveBillingConfig();
  if (config.provider !== "STRIPE" || config.stripe === null) {
    throw new Error("BILLING_PROVIDER=STRIPE and Stripe credentials are required");
  }
  const stripe = new Stripe(config.stripe.secretKey);

  for (const [key, environmentName] of Object.entries(PRICE_ENV)) {
    const [planCode, interval] = key.split(":") as [string, "MONTH" | "YEAR"];
    const catalog = BUILDWATCH_PLAN_CATALOG.find((entry) => entry.code === planCode);
    const catalogPrice = catalog?.prices.find((entry) => entry.interval === interval);
    if (
      catalog === undefined ||
      catalogPrice?.unitAmountMinor === null ||
      catalogPrice === undefined
    ) {
      throw new Error(`Local catalog price ${key} is missing`);
    }

    const externalPriceId = required(environmentName);
    const remote = await stripe.prices.retrieve(externalPriceId, { expand: ["product"] });
    const remoteProduct = remote.product;
    const externalProductId = typeof remoteProduct === "string" ? remoteProduct : remoteProduct.id;
    const expectedRecurring = interval === "MONTH" ? "month" : "year";
    const expectedAmount = Number(catalogPrice.unitAmountMinor);
    if (
      !remote.active ||
      remote.currency.toUpperCase() !== catalog.currency ||
      remote.unit_amount !== expectedAmount ||
      remote.recurring?.interval !== expectedRecurring ||
      remote.recurring.interval_count !== 1
    ) {
      throw new Error(
        `${environmentName} does not match ${catalog.code}/${interval} ` +
          `(${catalog.currency} ${expectedAmount} minor units, every 1 ${expectedRecurring})`,
      );
    }

    const plan = await prisma.billingPlan.findUnique({
      where: {
        code_version_interval: {
          code: catalog.code,
          version: catalog.version,
          interval,
        },
      },
      select: { id: true },
    });
    if (plan === null) {
      throw new Error(`Run seed:billing:plans first; local plan ${key} is missing`);
    }

    if (!dryRun) {
      await prisma.billingProviderPrice.upsert({
        where: {
          planId_provider_environment: {
            planId: plan.id,
            provider: "STRIPE",
            environment: config.environment,
          },
        },
        create: {
          planId: plan.id,
          provider: "STRIPE",
          environment: config.environment,
          externalProductId,
          externalPriceId,
        },
        update: { externalProductId, externalPriceId },
      });
    }
    process.stdout.write(
      `${dryRun ? "VALID" : "MAPPED"} ${catalog.code}/${interval} -> ${externalPriceId}\n`,
    );
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Stripe catalog failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
