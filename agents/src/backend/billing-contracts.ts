import { z } from "zod";
import { phase9IdentifierSchema, phase9IsoDateTimeSchema } from "./contracts.js";

/**
 * Canonical billing contracts for the subscription domain
 * (landing-page-roadmap.md §5, §6, §18, §24.5).
 *
 * This module is the single source of truth shared by the plan seed, the public
 * pricing API and the entitlement enforcement path. Prices live here and in the
 * database, never in a React component: the landing page reads them through
 * `GET /public/v1/plans` so a plan change can never leave the marketing copy
 * claiming a limit the backend does not enforce.
 */

// ---------------------------------------------------------------------------
// Enum mirrors of the Prisma billing enums
// ---------------------------------------------------------------------------

export const tenantLifecycleStatusSchema = z.enum([
  "PENDING_PAYMENT",
  "ACTIVE",
  "PAYMENT_GRACE",
  "SUSPENDED",
  "ARCHIVED",
]);

export const billingProviderKindSchema = z.enum([
  "STRIPE",
  "LEMON_SQUEEZY",
  "PADDLE",
  "MANUAL_INVOICE",
]);

export const subscriptionStatusSchema = z.enum([
  "PENDING",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAUSED",
  "CANCELED",
  "EXPIRED",
]);

export const billingIntervalSchema = z.enum(["MONTH", "YEAR", "CUSTOM"]);

export const billingEventProcessingStatusSchema = z.enum([
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "IGNORED",
  "FAILED",
]);

export const invoiceStatusSchema = z.enum([
  "DRAFT",
  "OPEN",
  "PAID",
  "VOID",
  "UNCOLLECTIBLE",
  "REFUNDED",
]);

export const companySignupIntentStatusSchema = z.enum([
  "PENDING_VERIFICATION",
  "VERIFIED",
  "CHECKOUT_STARTED",
  "COMPLETED",
  "EXPIRED",
  "ABANDONED",
]);

export type TenantLifecycleStatus = z.infer<typeof tenantLifecycleStatusSchema>;
export type BillingProviderKind = z.infer<typeof billingProviderKindSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
export type BillingInterval = z.infer<typeof billingIntervalSchema>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type CompanySignupIntentStatus = z.infer<typeof companySignupIntentStatusSchema>;

/**
 * Subscription states that can grant workspace access. A tenant may hold at most
 * one subscription in these states at a time; the invariant is enforced by the
 * `TenantSubscription_one_canonical_per_tenant_key` partial unique index.
 */
export const CANONICAL_SUBSCRIPTION_STATUSES = [
  "PENDING",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAUSED",
] as const satisfies readonly SubscriptionStatus[];

export function isCanonicalSubscriptionStatus(status: SubscriptionStatus): boolean {
  return (CANONICAL_SUBSCRIPTION_STATUSES as readonly SubscriptionStatus[]).includes(status);
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Amounts are persisted in ISO 4217 minor units of the row's own currency.
 * MNT carries two decimals, so 390,000₮ is stored as 39_000_000.
 */
export const MINOR_UNITS_PER_MAJOR = 100n;

/** Mongolian VAT is quoted separately from the plan price (roadmap §8.2). */
export const MONGOLIAN_VAT_RATE_BASIS_POINTS = 1_000;

export function majorToMinor(major: number): bigint {
  if (!Number.isInteger(major) || major < 0) {
    throw new RangeError(`Plan amounts must be whole non-negative units, received ${major}`);
  }
  return BigInt(major) * MINOR_UNITS_PER_MAJOR;
}

export function minorToMajor(minor: bigint): number {
  return Number(minor / MINOR_UNITS_PER_MAJOR);
}

/** Adds Mongolian VAT to a VAT-exclusive amount, rounding half up. */
export function addVatMinor(netMinor: bigint): bigint {
  const basisPoints = BigInt(MONGOLIAN_VAT_RATE_BASIS_POINTS);
  return netMinor + (netMinor * basisPoints + 5_000n) / 10_000n;
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

export const billingFeatureKeySchema = z.enum([
  "PROJECT_ACTIVE_MAX",
  "USER_ACTIVE_MAX",
  "STORAGE_BYTES_MAX",
  "AI_MONTHLY_RUNS_INCLUDED",
  "AI_MONTHLY_MICRO_USD_MAX",
  "AI_OVERAGE_ALLOWED",
  "AGENT_DAILY_REPORT",
  "AGENT_PROGRESS_VERIFICATION",
  "AGENT_BOQ_ANALYSIS",
  "ADVANCED_REPORTS",
  "AUDIT_RETENTION_DAYS",
  "API_ACCESS",
  "PRIORITY_SUPPORT",
]);

export type BillingFeatureKey = z.infer<typeof billingFeatureKeySchema>;

export const BILLING_FEATURE_KEYS = billingFeatureKeySchema.options;

/**
 * Limits are bigints in memory but JSON has no bigint, so the persisted snapshot
 * carries them as decimal strings. Accepting both shapes here keeps a single
 * schema in front of the catalog and the database column.
 */
const entitlementLimitSchema = z
  .union([z.bigint(), z.number().int(), z.string().trim().regex(/^\d+$/)])
  .transform((value) => BigInt(value))
  .refine((value) => value >= 0n, { message: "Entitlement limits cannot be negative" });

export const billingEntitlementValueSchema = z
  .object({
    enabled: z.boolean(),
    limitValue: entitlementLimitSchema.nullable().default(null),
    unit: z.string().trim().min(1).max(40).nullable().default(null),
  })
  .strict();

export type BillingEntitlementValue = z.infer<typeof billingEntitlementValueSchema>;

const entitlementValuesShape = Object.fromEntries(
  BILLING_FEATURE_KEYS.map((key) => [key, billingEntitlementValueSchema]),
) as Record<BillingFeatureKey, typeof billingEntitlementValueSchema>;

/** Every feature key must be present: an absent key is never read as "allowed". */
export const billingEntitlementValuesSchema = z.object(entitlementValuesShape).strict();

export type BillingEntitlementValues = z.infer<typeof billingEntitlementValuesSchema>;

/**
 * Persisted shape of `TenantEntitlementSnapshot.entitlements`. Strict and
 * versioned: raw provider payloads never reach this column (roadmap §18.6).
 */
export const billingEntitlementSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    planCode: phase9IdentifierSchema,
    planVersion: z.number().int().positive(),
    interval: billingIntervalSchema,
    values: billingEntitlementValuesSchema,
  })
  .strict();

export type BillingEntitlementSnapshot = z.infer<typeof billingEntitlementSnapshotSchema>;

/** JSON-safe form of a snapshot, ready for the `entitlements` Json column. */
export function serializeEntitlementSnapshot(snapshot: BillingEntitlementSnapshot): unknown {
  return JSON.parse(
    JSON.stringify(snapshot, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}

/** Parses a persisted snapshot back, rejecting anything outside the allowlist. */
export function parseEntitlementSnapshot(value: unknown): BillingEntitlementSnapshot {
  return billingEntitlementSnapshotSchema.parse(value);
}

// ---------------------------------------------------------------------------
// Audit actions (roadmap §24.5)
// ---------------------------------------------------------------------------

export const billingAuditActionSchema = z.enum([
  "BILLING_CHECKOUT_CREATED",
  "BILLING_WEBHOOK_PROCESSED",
  "SUBSCRIPTION_ACTIVATED",
  "SUBSCRIPTION_PAST_DUE",
  "SUBSCRIPTION_SUSPENDED",
  "SUBSCRIPTION_RESTORED",
  "SUBSCRIPTION_CANCELED",
  "PLAN_CHANGED",
  "MANUAL_INVOICE_CONFIRMED",
  "BILLING_ACCESS_OVERRIDE_CREATED",
  "BILLING_ACCESS_OVERRIDE_EXPIRED",
]);

export type BillingAuditAction = z.infer<typeof billingAuditActionSchema>;

export const BILLING_AUDIT_ACTIONS = billingAuditActionSchema.options;

export const billingAuditEventSchema = z
  .object({
    action: billingAuditActionSchema,
    tenantId: phase9IdentifierSchema.nullable(),
    entityType: z.enum([
      "TenantSubscription",
      "BillingInvoice",
      "BillingPlan",
      "CompanySignupIntent",
      "BillingWebhookEvent",
      "Tenant",
    ]),
    entityId: phase9IdentifierSchema,
    reason: z.string().trim().min(1).max(500).nullable().default(null),
    correlationId: phase9IdentifierSchema,
    occurredAt: phase9IsoDateTimeSchema,
    /**
     * Safe references only. Card data, provider secrets, signatures and raw
     * provider payloads are forbidden here (roadmap §24.4).
     */
    metadata: z
      .object({
        provider: billingProviderKindSchema.optional(),
        planCode: z.string().trim().min(1).max(60).optional(),
        planVersion: z.number().int().positive().optional(),
        fromStatus: subscriptionStatusSchema.optional(),
        toStatus: subscriptionStatusSchema.optional(),
        fromLifecycle: tenantLifecycleStatusSchema.optional(),
        toLifecycle: tenantLifecycleStatusSchema.optional(),
        providerEventId: z.string().trim().min(1).max(200).optional(),
        invoiceStatus: invoiceStatusSchema.optional(),
        totalMinor: z
          .string()
          .regex(/^-?\d+$/)
          .optional(),
        currency: z.string().length(3).optional(),
      })
      .strict(),
  })
  .strict();

export type BillingAuditEvent = z.infer<typeof billingAuditEventSchema>;

// ---------------------------------------------------------------------------
// Plan catalog (roadmap §5)
// ---------------------------------------------------------------------------

/**
 * Bumped whenever any plan price or entitlement changes. Existing subscribers
 * keep the plan version they bought; migration between versions is a deliberate,
 * audited operation (roadmap §18.3).
 */
export const BUILDWATCH_PLAN_CATALOG_VERSION = 1;

const GIB = 1_073_741_824n;

interface PlanIntervalPrice {
  readonly interval: BillingInterval;
  /** VAT-exclusive amount in ISO 4217 minor units, or null for negotiated plans. */
  readonly unitAmountMinor: bigint | null;
}

export interface BillingPlanCatalogEntry {
  readonly code: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly currency: string;
  readonly public: boolean;
  readonly prices: readonly PlanIntervalPrice[];
  readonly entitlements: BillingEntitlementValues;
}

function limit(value: bigint, unit: string): BillingEntitlementValue {
  return { enabled: true, limitValue: value, unit };
}

function flag(enabled: boolean): BillingEntitlementValue {
  return { enabled, limitValue: null, unit: null };
}

/** Enterprise limits are set per contract in the tenant entitlement snapshot. */
function byContract(unit: string): BillingEntitlementValue {
  return { enabled: true, limitValue: null, unit };
}

export const BUILDWATCH_PLAN_CATALOG: readonly BillingPlanCatalogEntry[] = [
  {
    code: "starter",
    version: BUILDWATCH_PLAN_CATALOG_VERSION,
    name: "Starter",
    description: "Анхны төслөө системд оруулж буй компанид зориулсан багц.",
    currency: "MNT",
    public: true,
    prices: [
      { interval: "MONTH", unitAmountMinor: majorToMinor(390_000) },
      { interval: "YEAR", unitAmountMinor: majorToMinor(3_900_000) },
    ],
    entitlements: {
      PROJECT_ACTIVE_MAX: limit(1n, "project"),
      USER_ACTIVE_MAX: limit(15n, "user"),
      STORAGE_BYTES_MAX: limit(50n * GIB, "byte"),
      AI_MONTHLY_RUNS_INCLUDED: limit(150n, "agentRun"),
      AI_MONTHLY_MICRO_USD_MAX: limit(25_000_000n, "microUsd"),
      AI_OVERAGE_ALLOWED: flag(false),
      AGENT_DAILY_REPORT: flag(true),
      AGENT_PROGRESS_VERIFICATION: flag(true),
      AGENT_BOQ_ANALYSIS: flag(true),
      ADVANCED_REPORTS: flag(false),
      AUDIT_RETENTION_DAYS: limit(90n, "day"),
      API_ACCESS: flag(false),
      PRIORITY_SUPPORT: flag(false),
    },
  },
  {
    code: "business",
    version: BUILDWATCH_PLAN_CATALOG_VERSION,
    name: "Business",
    description: "Зэрэг олон төсөлтэй тогтвортой гүйцэтгэгчид зориулсан багц.",
    currency: "MNT",
    public: true,
    prices: [
      { interval: "MONTH", unitAmountMinor: majorToMinor(1_290_000) },
      { interval: "YEAR", unitAmountMinor: majorToMinor(12_900_000) },
    ],
    entitlements: {
      PROJECT_ACTIVE_MAX: limit(5n, "project"),
      USER_ACTIVE_MAX: limit(60n, "user"),
      STORAGE_BYTES_MAX: limit(500n * GIB, "byte"),
      AI_MONTHLY_RUNS_INCLUDED: limit(900n, "agentRun"),
      AI_MONTHLY_MICRO_USD_MAX: limit(130_000_000n, "microUsd"),
      AI_OVERAGE_ALLOWED: flag(true),
      AGENT_DAILY_REPORT: flag(true),
      AGENT_PROGRESS_VERIFICATION: flag(true),
      AGENT_BOQ_ANALYSIS: flag(true),
      ADVANCED_REPORTS: flag(true),
      AUDIT_RETENTION_DAYS: limit(365n, "day"),
      API_ACCESS: flag(true),
      PRIORITY_SUPPORT: flag(true),
    },
  },
  {
    code: "enterprise",
    version: BUILDWATCH_PLAN_CATALOG_VERSION,
    name: "Enterprise",
    description: "Групп компанид зориулсан гэрээт багц. Үнэ нийтэд харагдахгүй.",
    currency: "MNT",
    public: false,
    prices: [{ interval: "CUSTOM", unitAmountMinor: null }],
    entitlements: {
      PROJECT_ACTIVE_MAX: byContract("project"),
      USER_ACTIVE_MAX: byContract("user"),
      STORAGE_BYTES_MAX: byContract("byte"),
      AI_MONTHLY_RUNS_INCLUDED: byContract("agentRun"),
      AI_MONTHLY_MICRO_USD_MAX: byContract("microUsd"),
      AI_OVERAGE_ALLOWED: flag(true),
      AGENT_DAILY_REPORT: flag(true),
      AGENT_PROGRESS_VERIFICATION: flag(true),
      AGENT_BOQ_ANALYSIS: flag(true),
      ADVANCED_REPORTS: flag(true),
      AUDIT_RETENTION_DAYS: limit(1_095n, "day"),
      API_ACCESS: flag(true),
      PRIORITY_SUPPORT: flag(true),
    },
  },
];

export const PUBLIC_PLAN_CODES = BUILDWATCH_PLAN_CATALOG.filter((plan) => plan.public).map(
  (plan) => plan.code,
);

export function findPlanCatalogEntry(code: string): BillingPlanCatalogEntry | undefined {
  return BUILDWATCH_PLAN_CATALOG.find((plan) => plan.code === code);
}

/**
 * The annual price is deliberately ten months of the monthly price: the pricing
 * page promises "2 months free" and the two numbers must never drift apart
 * (roadmap §5, §13).
 */
export const ANNUAL_MONTHS_CHARGED = 10n;

export function expectedAnnualMinor(monthlyMinor: bigint): bigint {
  return monthlyMinor * ANNUAL_MONTHS_CHARGED;
}

export function buildEntitlementSnapshot(
  plan: BillingPlanCatalogEntry,
  interval: BillingInterval,
): BillingEntitlementSnapshot {
  return billingEntitlementSnapshotSchema.parse({
    schemaVersion: 1,
    planCode: plan.code,
    planVersion: plan.version,
    interval,
    values: plan.entitlements,
  });
}

/**
 * Builds the immutable tenant snapshot from the exact purchased BillingPlan
 * row.  Runtime access must not silently fall back to the in-code marketing
 * catalog: a missing, duplicate or unknown DB entitlement is corruption and
 * the strict snapshot schema deliberately fails the provisioning transaction.
 */
export function buildEntitlementSnapshotFromPlanRows(
  plan: {
    readonly code: string;
    readonly version: number;
    readonly interval: BillingInterval;
  },
  rows: readonly {
    readonly featureKey: string;
    readonly enabled: boolean;
    readonly limitValue: bigint | null;
    readonly unit: string | null;
  }[],
): BillingEntitlementSnapshot {
  const values = Object.create(null) as Record<string, BillingEntitlementValue>;
  for (const row of rows) {
    const featureKey = billingFeatureKeySchema.parse(row.featureKey);
    if (Object.hasOwn(values, featureKey)) {
      throw new Error(`Duplicate plan entitlement: ${featureKey}`);
    }
    values[featureKey] = {
      enabled: row.enabled,
      limitValue: row.limitValue,
      unit: row.unit,
    };
  }

  return billingEntitlementSnapshotSchema.parse({
    schemaVersion: 1,
    planCode: plan.code,
    planVersion: plan.version,
    interval: plan.interval,
    values,
  });
}
