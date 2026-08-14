import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "../prisma.js";
import {
  BILLING_FEATURE_KEYS,
  BUILDWATCH_PLAN_CATALOG,
  BUILDWATCH_PLAN_CATALOG_VERSION,
  CANONICAL_SUBSCRIPTION_STATUSES,
} from "../backend/billing-contracts.js";
import { TenantAccessPolicy } from "../backend/tenant-access-policy.js";
import { PrismaTenantAccessSnapshotReader } from "../backend/tenant-access-store.js";
import { resolveBillingConfig } from "../backend/billing-config.js";
import { PrismaBillingPriceResolver } from "../backend/billing-price-resolver.js";
import {
  BillingCheckoutService,
  createBillingProviders,
  type CheckoutIdempotencyRecord,
} from "../backend/billing-checkout-service.js";

/**
 * Proves the Phase 1-3 billing invariants against a real PostgreSQL database
 * rather than against the migration text. A constraint that exists in a file but
 * not in the deployed schema protects nothing.
 *
 * Every behavioural probe runs inside a transaction that is always rolled back,
 * so the script is safe to run against a populated development database.
 */

const MIGRATION_NAME = "20260812071010_add_billing_domain";

const REQUIRED_TABLES = [
  "BillingPlan",
  "PlanEntitlement",
  "BillingProviderPrice",
  "BillingCustomer",
  "TenantSubscription",
  "TenantEntitlementSnapshot",
  "CompanySignupIntent",
  "BillingWebhookEvent",
  "BillingInvoice",
];

const REQUIRED_ENUMS = [
  "TenantLifecycleStatus",
  "BillingProviderKind",
  "SubscriptionStatus",
  "BillingInterval",
  "BillingEventProcessingStatus",
  "InvoiceStatus",
  "CompanySignupIntentStatus",
];

interface Check {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

const ROLLBACK = Symbol("rollback");

/**
 * Runs `probe` inside a transaction that never commits and reports which
 * database constraint, if any, rejected it.
 *
 * Prisma keeps the offending constraint name in the driver error metadata
 * rather than in `error.message`, so both are folded into the returned string.
 */
async function rejectionOf(probe: (tx: typeof prisma) => Promise<void>): Promise<string | null> {
  try {
    await prisma.$transaction(async (transaction) => {
      await probe(transaction as unknown as typeof prisma);
      throw ROLLBACK;
    });
    return null;
  } catch (error) {
    if (error === ROLLBACK) return null;
    if (!(error instanceof Error)) return String(error);
    const meta = (error as { meta?: unknown }).meta;
    return meta === undefined ? error.message : `${error.message} ${JSON.stringify(meta)}`;
  }
}

async function main() {
  const checks: Check[] = [];
  const record = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });

  const applied = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
    SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name = ${MIGRATION_NAME}
  `;
  record(
    "migration applied",
    applied.length === 1 && applied[0]!.finished_at !== null,
    applied.length === 1 ? `${MIGRATION_NAME} finished` : "migration not found",
  );

  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `;
  const tableNames = new Set(tables.map((row) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter((table) => !tableNames.has(table));
  record("billing tables exist", missingTables.length === 0, missingTables.join(", ") || "all 9");

  const enums = await prisma.$queryRaw<{ typname: string }[]>`
    SELECT typname FROM pg_type WHERE typtype = 'e'
  `;
  const enumNames = new Set(enums.map((row) => row.typname));
  const missingEnums = REQUIRED_ENUMS.filter((name) => !enumNames.has(name));
  record("billing enums exist", missingEnums.length === 0, missingEnums.join(", ") || "all 7");

  const [defaultRow] = await prisma.$queryRaw<{ column_default: string | null }[]>`
    SELECT column_default FROM information_schema.columns
    WHERE table_name = 'Tenant' AND column_name = 'lifecycleStatus'
  `;
  const lifecycleDefault = defaultRow?.column_default ?? "";
  record(
    "new tenants default to PENDING_PAYMENT",
    lifecycleDefault.includes("PENDING_PAYMENT"),
    lifecycleDefault || "no default",
  );

  const strandedTenants = await prisma.tenant.count({
    where: { lifecycleStatus: "PENDING_PAYMENT", accessReason: "GRANDFATHERED_PRE_BILLING" },
  });
  const grandfathered = await prisma.tenant.count({
    where: { accessReason: "GRANDFATHERED_PRE_BILLING" },
  });
  record(
    "pre-billing tenants keep access",
    strandedTenants === 0,
    `${grandfathered} grandfathered, ${strandedTenants} locked out`,
  );

  const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'TenantSubscription'
      AND indexname = 'TenantSubscription_one_canonical_per_tenant_key'
  `;
  const indexDefinition = indexes[0]?.indexdef ?? "";
  record(
    "canonical subscription index covers every access-granting status",
    CANONICAL_SUBSCRIPTION_STATUSES.every((status) => indexDefinition.includes(status)) &&
      !indexDefinition.includes("CANCELED"),
    indexDefinition || "index missing",
  );

  const constraints = await prisma.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname LIKE '%_check'
  `;
  const constraintNames = new Set(constraints.map((row) => row.conname));
  const requiredConstraints = [
    "BillingPlan_unit_amount_non_negative_check",
    "BillingPlan_public_requires_amount_check",
    "PlanEntitlement_limit_non_negative_check",
    "BillingInvoice_total_matches_components_check",
    "TenantSubscription_period_order_check",
  ];
  const missingConstraints = requiredConstraints.filter((name) => !constraintNames.has(name));
  record(
    "money integrity constraints installed",
    missingConstraints.length === 0,
    missingConstraints.join(", ") || "all 5",
  );

  const restrictedForeignKeys = await prisma.$queryRaw<{ conname: string; confdeltype: string }[]>`
    SELECT conname, confdeltype::text AS confdeltype FROM pg_constraint
    WHERE contype = 'f'
      AND conname IN (
        'BillingCustomer_tenantId_fkey',
        'TenantSubscription_tenantId_fkey',
        'BillingInvoice_tenantId_fkey'
      )
  `;
  const nonRestrict = restrictedForeignKeys.filter((row) => row.confdeltype !== "r");
  record(
    "deleting a tenant cannot erase its financial history",
    restrictedForeignKeys.length === 3 && nonRestrict.length === 0,
    nonRestrict.map((row) => row.conname).join(", ") ||
      `${restrictedForeignKeys.length}/3 RESTRICT`,
  );

  // --- Behavioural probes -------------------------------------------------

  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  const plan = await prisma.billingPlan.findFirst({
    where: { code: "starter", interval: "MONTH" },
    select: { id: true },
  });

  if (tenant && plan) {
    const duplicateCanonical = await rejectionOf(async (tx) => {
      for (const status of ["ACTIVE", "PAST_DUE"] as const) {
        await tx.tenantSubscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            provider: "MANUAL_INVOICE",
            status,
          },
        });
      }
    });
    record(
      "a second access-granting subscription is refused",
      duplicateCanonical?.includes("TenantSubscription_one_canonical_per_tenant_key") ?? false,
      duplicateCanonical ? "rejected by the partial unique index" : "ACCEPTED — invariant broken",
    );

    const badInvoice = await rejectionOf(async (tx) => {
      await tx.billingInvoice.create({
        data: {
          tenantId: tenant.id,
          provider: "MANUAL_INVOICE",
          providerInvoiceId: `smoke-${Date.now()}`,
          status: "OPEN",
          currency: "MNT",
          subtotalMinor: 39_000_000n,
          taxMinor: 3_900_000n,
          totalMinor: 1n,
        },
      });
    });
    record(
      "an invoice whose total does not add up is refused",
      badInvoice?.includes("BillingInvoice_total_matches_components_check") ?? false,
      badInvoice ? "rejected by the check constraint" : "ACCEPTED — invariant broken",
    );
  } else {
    record("behavioural probes", false, "no tenant or starter plan available to probe against");
  }

  const pricelessPublicPlan = await rejectionOf(async (tx) => {
    await tx.billingPlan.create({
      data: {
        code: `smoke-${Date.now()}`,
        version: 1,
        name: "smoke",
        description: "smoke",
        interval: "MONTH",
        currency: "MNT",
        unitAmountMinor: null,
        public: true,
      },
    });
  });
  record(
    "a public plan without a price is refused",
    pricelessPublicPlan?.includes("BillingPlan_public_requires_amount_check") ?? false,
    pricelessPublicPlan ? "rejected by the check constraint" : "ACCEPTED — invariant broken",
  );

  // --- Access policy over the real reader ---------------------------------

  if (tenant) {
    const policy = new TenantAccessPolicy(new PrismaTenantAccessSnapshotReader(prisma));
    const loaded = await policy.snapshot(tenant.id);
    record(
      "the access policy can read a real tenant snapshot",
      loaded !== null && loaded.tenantId === tenant.id,
      loaded === null
        ? "reader returned null"
        : `lifecycle=${loaded.lifecycleStatus} plan=${loaded.planCode ?? "none"} ` +
            `entitlements=${loaded.entitlements === null ? "none (grandfathered)" : "present"}`,
    );

    // The whole point of the grandfather backfill: tenants that predate billing
    // must still be able to work after the migration.
    const grandfatheredTenant = await prisma.tenant.findFirst({
      where: { accessReason: "GRANDFATHERED_PRE_BILLING" },
      select: { id: true },
    });
    if (grandfatheredTenant) {
      const write = await policy.getDecision(grandfatheredTenant.id, "WRITE");
      const aiJob = await policy.getDecision(grandfatheredTenant.id, "AI_JOB");
      record(
        "a grandfathered tenant can still write and run agents",
        write.allowed && aiJob.allowed,
        write.allowed && aiJob.allowed
          ? "WRITE and AI_JOB allowed"
          : `WRITE=${write.reason ?? "allowed"} AI_JOB=${aiJob.reason ?? "allowed"}`,
      );
    } else {
      record("a grandfathered tenant can still write and run agents", true, "none present");
    }

    const unknown = await policy.getDecision("tenant-does-not-exist", "READ");
    record(
      "an unknown tenant is denied by default",
      !unknown.allowed && unknown.reason === "TENANT_NOT_FOUND",
      unknown.allowed ? "ALLOWED — default-deny broken" : "denied",
    );
  }

  // --- Seeded catalog -----------------------------------------------------

  const seededPlans = await prisma.billingPlan.findMany({
    where: { version: BUILDWATCH_PLAN_CATALOG_VERSION },
    include: { entitlements: true },
  });
  const expectedRows = BUILDWATCH_PLAN_CATALOG.flatMap((entry) =>
    entry.prices.map((price) => ({
      code: entry.code,
      interval: price.interval,
      unitAmountMinor: price.unitAmountMinor,
      public: entry.public,
    })),
  );
  const catalogMismatches = expectedRows.filter((expected) => {
    const row = seededPlans.find(
      (candidate) => candidate.code === expected.code && candidate.interval === expected.interval,
    );
    return (
      !row ||
      row.unitAmountMinor !== expected.unitAmountMinor ||
      row.public !== expected.public ||
      row.entitlements.length !== BILLING_FEATURE_KEYS.length
    );
  });
  record(
    "seeded plan catalog matches the contract module",
    catalogMismatches.length === 0,
    catalogMismatches.map((row) => `${row.code}/${row.interval}`).join(", ") ||
      `${expectedRows.length} plan rows, ${BILLING_FEATURE_KEYS.length} entitlements each`,
  );

  // --- Price allowlist and checkout over the real catalog -----------------

  const billingConfig = resolveBillingConfig({
    NODE_ENV: "test",
    BILLING_ENVIRONMENT: "sandbox",
    BILLING_PROVIDER: "MANUAL_INVOICE",
    BILLING_RETURN_URL_ALLOWLIST: "https://app.buildwatch.test",
  } as NodeJS.ProcessEnv);
  const priceResolver = new PrismaBillingPriceResolver(prisma);

  let resolvedStarter: Awaited<ReturnType<typeof priceResolver.resolvePublicPrice>> | null = null;
  let resolveError: string | null = null;
  try {
    resolvedStarter = await priceResolver.resolvePublicPrice({
      planCode: "starter",
      interval: "MONTH",
      provider: "MANUAL_INVOICE",
      environment: "sandbox",
    });
  } catch (error) {
    resolveError = error instanceof Error ? error.message : String(error);
  }
  record(
    "a published plan resolves to a server-side price",
    resolvedStarter?.unitAmountMinor === 39_000_000n,
    resolvedStarter
      ? `${resolvedStarter.planCode}/${resolvedStarter.interval} → ${resolvedStarter.externalPriceId}`
      : (resolveError ?? "not resolved"),
  );

  let enterpriseAllowed = true;
  try {
    await priceResolver.resolvePublicPrice({
      planCode: "enterprise",
      interval: "CUSTOM",
      provider: "MANUAL_INVOICE",
      environment: "sandbox",
    });
  } catch {
    enterpriseAllowed = false;
  }
  record(
    "a negotiated plan cannot be bought through self-serve checkout",
    !enterpriseAllowed,
    enterpriseAllowed ? "RESOLVED — private plan is purchasable" : "refused",
  );

  const idempotency = new Map<string, CheckoutIdempotencyRecord>();
  const checkoutService = new BillingCheckoutService({
    config: billingConfig,
    providers: createBillingProviders({
      config: billingConfig,
      manualInstructionsBaseUrl: "https://app.buildwatch.test/company-signup",
    }),
    priceResolver,
    idempotency: {
      find: async (id) => idempotency.get(id) ?? null,
      save: async (record) => {
        idempotency.set(record.signupIntentId, record);
      },
    },
  });
  const checkoutRequest = {
    signupIntentId: "smoke-intent",
    planCode: "starter",
    interval: "MONTH" as const,
    customerEmail: "smoke@buildwatch.test",
    customerName: "Smoke",
    companyName: "Smoke LLC",
    successUrl: "https://app.buildwatch.test/checkout/success",
    correlationId: "smoke",
  };
  try {
    const first = await checkoutService.createCheckout(checkoutRequest);
    const second = await checkoutService.createCheckout(checkoutRequest);
    record(
      "the domestic invoice channel completes a checkout without any third party",
      first.checkoutId === second.checkoutId && first.url.startsWith("https://"),
      `${first.checkoutId} → ${first.url}`,
    );
  } catch (error) {
    record(
      "the domestic invoice channel completes a checkout without any third party",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  const passed = checks.every((check) => check.passed);
  const report = {
    suite: "billing-domain-postgres",
    migration: MIGRATION_NAME,
    planCatalogVersion: BUILDWATCH_PLAN_CATALOG_VERSION,
    generatedAt: new Date().toISOString(),
    passed,
    checks,
  };
  const output = resolve(process.cwd(), "data/evaluations/billing-domain-postgres.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const check of checks) {
    process.stdout.write(`${check.passed ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}\n`);
  }
  process.stdout.write(
    `\nBilling domain PostgreSQL smoke: ${passed ? "PASS" : "FAIL"} ` +
      `(${checks.filter((check) => check.passed).length}/${checks.length})\nReport: ${output}\n`,
  );
  if (!passed) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Billing domain PostgreSQL smoke failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
