import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  addVatMinor,
  billingAuditEventSchema,
  billingEntitlementSnapshotSchema,
  BILLING_AUDIT_ACTIONS,
  BILLING_FEATURE_KEYS,
  BUILDWATCH_PLAN_CATALOG,
  BUILDWATCH_PLAN_CATALOG_VERSION,
  buildEntitlementSnapshot,
  buildEntitlementSnapshotFromPlanRows,
  CANONICAL_SUBSCRIPTION_STATUSES,
  expectedAnnualMinor,
  findPlanCatalogEntry,
  isCanonicalSubscriptionStatus,
  majorToMinor,
  PUBLIC_PLAN_CODES,
} from "../../src/backend/billing-contracts.js";

const MIGRATION_PATH = "prisma/migrations/20260812071010_add_billing_domain/migration.sql";

describe("Phase 1 billing domain schema", () => {
  it("declares every billing model and enum", async () => {
    const schema = await readFile(resolve("prisma/schema.prisma"), "utf8");
    const models = [
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
    models.forEach((model) => expect(schema).toContain(`model ${model} {`));

    const enums = [
      "TenantLifecycleStatus",
      "BillingProviderKind",
      "SubscriptionStatus",
      "BillingInterval",
      "BillingEventProcessingStatus",
      "InvoiceStatus",
      "CompanySignupIntentStatus",
    ];
    enums.forEach((name) => expect(schema).toContain(`enum ${name} {`));

    expect(schema).toMatch(
      /lifecycleStatus\s+TenantLifecycleStatus\s+@default\(PENDING_PAYMENT\)/u,
    );
  });

  it("keeps financial rows undeletable by a tenant delete", async () => {
    const schema = await readFile(resolve("prisma/schema.prisma"), "utf8");
    const financialModels = ["BillingCustomer", "TenantSubscription", "BillingInvoice"];
    for (const model of financialModels) {
      const body = schema.slice(schema.indexOf(`model ${model} {`));
      const declaration = body.slice(0, body.indexOf("\n}"));
      expect(declaration).toContain("references: [id], onDelete: Restrict");
    }
  });

  it("ships an additive migration that grandfathers existing tenants", async () => {
    const migration = await readFile(resolve(MIGRATION_PATH), "utf8");

    expect(migration).not.toMatch(/DROP TABLE|DROP TYPE|DROP INDEX|DROP COLUMN/);
    expect(migration).not.toMatch(/ALTER INDEX/);

    // The column lands as ACTIVE so nothing that already exists is locked out,
    // and only afterwards does the default flip to PENDING_PAYMENT.
    const addColumn = migration.indexOf('ADD COLUMN     "lifecycleStatus"');
    const setDefault = migration.indexOf("SET DEFAULT 'PENDING_PAYMENT'");
    expect(addColumn).toBeGreaterThan(-1);
    expect(setDefault).toBeGreaterThan(addColumn);
    expect(migration).toContain("DEFAULT 'ACTIVE'");
    expect(migration).toContain("GRANDFATHERED_PRE_BILLING");
  });

  it("enforces one canonical subscription per tenant in the database", async () => {
    const migration = await readFile(resolve(MIGRATION_PATH), "utf8");
    expect(migration).toContain("TenantSubscription_one_canonical_per_tenant_key");

    const indexStart = migration.indexOf("TenantSubscription_one_canonical_per_tenant_key");
    const indexBody = migration.slice(indexStart, indexStart + 400);
    for (const status of CANONICAL_SUBSCRIPTION_STATUSES) {
      expect(indexBody).toContain(`'${status}'`);
    }
    // Terminal history must stay insertable.
    expect(indexBody).not.toContain("'CANCELED'");
    expect(indexBody).not.toContain("'EXPIRED'");
  });

  it("guards money integrity with check constraints", async () => {
    const migration = await readFile(resolve(MIGRATION_PATH), "utf8");
    const constraints = [
      "BillingPlan_unit_amount_non_negative_check",
      "BillingPlan_public_requires_amount_check",
      "PlanEntitlement_limit_non_negative_check",
      "BillingInvoice_total_matches_components_check",
      "TenantSubscription_period_order_check",
    ];
    constraints.forEach((constraint) => expect(migration).toContain(constraint));
  });
});

describe("Phase 1 plan catalog", () => {
  it("publishes exactly the prices the roadmap promises", () => {
    const starter = findPlanCatalogEntry("starter");
    const business = findPlanCatalogEntry("business");
    expect(starter).toBeDefined();
    expect(business).toBeDefined();

    const priceFor = (code: string, interval: string) =>
      findPlanCatalogEntry(code)?.prices.find((price) => price.interval === interval)
        ?.unitAmountMinor;

    expect(priceFor("starter", "MONTH")).toBe(majorToMinor(390_000));
    expect(priceFor("starter", "YEAR")).toBe(majorToMinor(3_900_000));
    expect(priceFor("business", "MONTH")).toBe(majorToMinor(1_290_000));
    expect(priceFor("business", "YEAR")).toBe(majorToMinor(12_900_000));
  });

  it("keeps the annual price at ten months so '2 months free' stays true", () => {
    for (const plan of BUILDWATCH_PLAN_CATALOG.filter((entry) => entry.public)) {
      const monthly = plan.prices.find((price) => price.interval === "MONTH")?.unitAmountMinor;
      const yearly = plan.prices.find((price) => price.interval === "YEAR")?.unitAmountMinor;
      expect(monthly).not.toBeNull();
      expect(yearly).toBe(expectedAnnualMinor(monthly!));
    }
  });

  it("only lists a plan publicly when it carries a price", () => {
    for (const plan of BUILDWATCH_PLAN_CATALOG) {
      for (const price of plan.prices) {
        if (plan.public) {
          expect(price.unitAmountMinor).not.toBeNull();
        }
      }
    }
    expect(PUBLIC_PLAN_CODES).toEqual(["starter", "business"]);
    expect(findPlanCatalogEntry("enterprise")?.public).toBe(false);
  });

  it("gives every plan a value for every entitlement key", () => {
    for (const plan of BUILDWATCH_PLAN_CATALOG) {
      expect(Object.keys(plan.entitlements).sort()).toEqual([...BILLING_FEATURE_KEYS].sort());
    }
  });

  it("keeps the monthly and yearly rows of one plan on identical entitlements", () => {
    // The two interval rows duplicate their entitlements in the database, so the
    // catalog is the only place that can keep them from drifting apart.
    for (const plan of BUILDWATCH_PLAN_CATALOG) {
      const snapshots = plan.prices.map((price) =>
        JSON.stringify(buildEntitlementSnapshot(plan, price.interval), (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ).replace(/"interval":"[A-Z]+"/, ""),
      );
      expect(new Set(snapshots).size).toBe(1);
    }
  });

  it("ties the paid tiers together in the direction the pricing page claims", () => {
    const starterProjects = findPlanCatalogEntry("starter")!.entitlements.PROJECT_ACTIVE_MAX;
    const businessProjects = findPlanCatalogEntry("business")!.entitlements.PROJECT_ACTIVE_MAX;
    expect(businessProjects.limitValue!).toBeGreaterThan(starterProjects.limitValue!);

    expect(findPlanCatalogEntry("starter")!.entitlements.AI_OVERAGE_ALLOWED.enabled).toBe(false);
    expect(findPlanCatalogEntry("business")!.entitlements.AI_OVERAGE_ALLOWED.enabled).toBe(true);
    expect(findPlanCatalogEntry("starter")!.entitlements.API_ACCESS.enabled).toBe(false);
    expect(findPlanCatalogEntry("business")!.entitlements.API_ACCESS.enabled).toBe(true);
  });

  it("leaves Enterprise limits to the contract snapshot", () => {
    const enterprise = findPlanCatalogEntry("enterprise")!;
    expect(enterprise.entitlements.PROJECT_ACTIVE_MAX.limitValue).toBeNull();
    expect(enterprise.entitlements.PROJECT_ACTIVE_MAX.enabled).toBe(true);
    expect(enterprise.prices).toEqual([{ interval: "CUSTOM", unitAmountMinor: null }]);
  });
});

describe("Phase 1 billing contracts", () => {
  it("treats only pre-terminal states as canonical", () => {
    expect(isCanonicalSubscriptionStatus("ACTIVE")).toBe(true);
    expect(isCanonicalSubscriptionStatus("PAST_DUE")).toBe(true);
    expect(isCanonicalSubscriptionStatus("CANCELED")).toBe(false);
    expect(isCanonicalSubscriptionStatus("EXPIRED")).toBe(false);
  });

  it("rejects an entitlement snapshot that is missing or invents a key", () => {
    const plan = findPlanCatalogEntry("starter")!;
    const valid = buildEntitlementSnapshot(plan, "MONTH");
    expect(billingEntitlementSnapshotSchema.parse(valid)).toEqual(valid);

    const missing = { ...valid, values: { ...valid.values } } as Record<string, unknown>;
    delete (missing.values as Record<string, unknown>).API_ACCESS;
    expect(billingEntitlementSnapshotSchema.safeParse(missing).success).toBe(false);

    const invented = {
      ...valid,
      values: {
        ...valid.values,
        TOTALLY_NEW_FEATURE: { enabled: true, limitValue: null, unit: null },
      },
    };
    expect(billingEntitlementSnapshotSchema.safeParse(invented).success).toBe(false);
  });

  it("pins the plan version into every snapshot", () => {
    const snapshot = buildEntitlementSnapshot(findPlanCatalogEntry("business")!, "YEAR");
    expect(snapshot.planCode).toBe("business");
    expect(snapshot.planVersion).toBe(BUILDWATCH_PLAN_CATALOG_VERSION);
    expect(snapshot.interval).toBe("YEAR");
    expect(snapshot.schemaVersion).toBe(1);
  });

  it("builds purchased snapshots from DB rows and fails closed when a row is missing", () => {
    const catalog = findPlanCatalogEntry("starter")!;
    const rows = BILLING_FEATURE_KEYS.map((featureKey) => ({
      featureKey,
      ...catalog.entitlements[featureKey],
    }));
    const snapshot = buildEntitlementSnapshotFromPlanRows(
      { code: catalog.code, version: catalog.version, interval: "MONTH" },
      rows,
    );
    expect(snapshot).toEqual(buildEntitlementSnapshot(catalog, "MONTH"));

    expect(() =>
      buildEntitlementSnapshotFromPlanRows(
        { code: catalog.code, version: catalog.version, interval: "MONTH" },
        rows.filter((row) => row.featureKey !== "API_ACCESS"),
      ),
    ).toThrow();
  });

  it("keeps payment secrets out of the audit metadata contract", () => {
    const base = {
      action: "SUBSCRIPTION_ACTIVATED" as const,
      tenantId: "tenant-demo",
      entityType: "TenantSubscription" as const,
      entityId: "sub-1",
      reason: null,
      correlationId: "corr-1",
      occurredAt: new Date().toISOString(),
    };
    expect(
      billingAuditEventSchema.safeParse({
        ...base,
        metadata: { provider: "LEMON_SQUEEZY", toStatus: "ACTIVE" },
      }).success,
    ).toBe(true);

    for (const forbidden of ["cardNumber", "signature", "webhookSecret", "rawPayload"]) {
      expect(
        billingAuditEventSchema.safeParse({ ...base, metadata: { [forbidden]: "x" } }).success,
      ).toBe(false);
    }
  });

  it("covers every audit action the roadmap lists", () => {
    expect(BILLING_AUDIT_ACTIONS).toHaveLength(11);
    expect(BILLING_AUDIT_ACTIONS).toContain("BILLING_WEBHOOK_PROCESSED");
    expect(BILLING_AUDIT_ACTIONS).toContain("MANUAL_INVOICE_CONFIRMED");
  });

  it("computes Mongolian VAT on top of the quoted price", () => {
    expect(addVatMinor(majorToMinor(390_000))).toBe(majorToMinor(429_000));
    expect(addVatMinor(0n)).toBe(0n);
  });

  it("refuses fractional plan amounts", () => {
    expect(() => majorToMinor(390_000.5)).toThrow(RangeError);
    expect(() => majorToMinor(-1)).toThrow(RangeError);
  });
});
