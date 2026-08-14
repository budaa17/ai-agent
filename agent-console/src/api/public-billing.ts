import { z } from "zod";

/**
 * Public pricing and signup API (landing-page-roadmap.md §13, §23.1).
 *
 * Deliberately separate from the authenticated client: marketing routes must not
 * pull in the token store, refresh logic or protected prefetching (§11.2).
 *
 * Prices and limits are never hard-coded on the client. Everything the pricing
 * page shows comes from `/public/v1/plans`, so an entitlement change cannot
 * leave the page promising a number the backend does not enforce.
 */

/**
 * The console reaches the API through the `/api` prefix — the dev server proxies
 * it and the production deployment rewrites it. A public route is no different,
 * so it must carry the prefix too or it resolves to the SPA's own index.html.
 */
const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

export const publicPlanEntitlementSchema = z.object({
  featureKey: z.string(),
  enabled: z.boolean(),
  limitValue: z.string().nullable(),
  unit: z.string().nullable(),
});

export const publicPlanSchema = z.object({
  code: z.string(),
  version: z.number(),
  name: z.string(),
  description: z.string(),
  currency: z.string(),
  prices: z.array(
    z.object({
      interval: z.enum(["MONTH", "YEAR", "CUSTOM"]),
      unitAmountMinor: z.string(),
    }),
  ),
  entitlements: z.array(publicPlanEntitlementSchema),
});

export const publicPlanCatalogSchema = z.object({
  currency: z.string(),
  vatRateBasisPoints: z.number(),
  vatIncluded: z.literal(false),
  plans: z.array(publicPlanSchema),
});

export type PublicPlan = z.infer<typeof publicPlanSchema>;
export type PublicPlanCatalog = z.infer<typeof publicPlanCatalogSchema>;

export const companySignupResultSchema = z.object({
  signupIntentId: z.string(),
  status: z.enum(["PENDING", "CONFIRMING", "ACTIVE", "FAILED", "EXPIRED"]),
  verificationCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const signupStatusSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMING", "ACTIVE", "FAILED", "EXPIRED"]),
});

export const checkoutResultSchema = z.object({ url: z.string(), checkoutId: z.string() });

export const verificationSentSchema = z.object({
  status: z.literal("PENDING"),
  retryAfterSeconds: z.number().int().positive(),
  verificationCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const companyAccountSetupResultSchema = z.object({
  tenantSlug: z.string().min(2),
  email: z.string().email(),
});

export type CompanySignupResult = z.infer<typeof companySignupResultSchema>;
export type SignupStatus = z.infer<typeof signupStatusSchema>;

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init?.method ?? "GET",
    cache: "no-store",
    ...(init?.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body),
        }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      "Хүсэлт амжилтгүй боллоо";
    throw new PublicApiError(response.status, message);
  }
  return schema.parse(payload);
}

export function fetchPublicPlans(): Promise<PublicPlanCatalog> {
  return request("/public/v1/plans", publicPlanCatalogSchema);
}

export function createCompanySignup(input: {
  companyName: string;
  desiredSlug: string;
  adminEmail: string;
  adminDisplayName: string;
  planCode: string;
  interval: "MONTH" | "YEAR";
}): Promise<CompanySignupResult> {
  return request("/public/v1/company-signups", companySignupResultSchema, {
    method: "POST",
    body: input,
  });
}

export function verifyCompanySignup(
  signupIntentId: string,
  code: string,
): Promise<{ status: SignupStatus["status"] }> {
  return request(
    `/public/v1/company-signups/${encodeURIComponent(signupIntentId)}/verify-email`,
    signupStatusSchema,
    { method: "POST", body: { code } },
  );
}

export function resendCompanySignupCode(signupIntentId: string) {
  return request(
    `/public/v1/company-signups/${encodeURIComponent(signupIntentId)}/resend-verification-code`,
    verificationSentSchema,
    { method: "POST" },
  );
}

export function startCompanyCheckout(
  signupIntentId: string,
): Promise<z.infer<typeof checkoutResultSchema>> {
  return request(
    `/public/v1/company-signups/${encodeURIComponent(signupIntentId)}/checkout`,
    checkoutResultSchema,
    { method: "POST" },
  );
}

export function fetchSignupStatus(signupIntentId: string): Promise<SignupStatus> {
  return request(
    `/public/v1/company-signups/${encodeURIComponent(signupIntentId)}/status`,
    signupStatusSchema,
  );
}

export function completeCompanyAccountSetup(input: {
  tenantId: string;
  setupToken: string;
  password: string;
}) {
  return request("/public/v1/company-signups/account-setup", companyAccountSetupResultSchema, {
    method: "POST",
    body: input,
  });
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** Minor units are ISO 4217; MNT carries two decimals. */
export function formatMinorAmount(minor: string, currency: string): string {
  const major = BigInt(minor) / 100n;
  const formatted = new Intl.NumberFormat("mn-MN").format(major);
  return currency === "MNT" ? `${formatted}₮` : `${formatted} ${currency}`;
}

export function priceFor(plan: PublicPlan, interval: "MONTH" | "YEAR"): string | null {
  return plan.prices.find((price) => price.interval === interval)?.unitAmountMinor ?? null;
}

/**
 * The annual price is ten months of the monthly one, so the saving shown to the
 * visitor is derived rather than typed in.
 */
export function annualSaving(plan: PublicPlan): string | null {
  const monthly = priceFor(plan, "MONTH");
  const yearly = priceFor(plan, "YEAR");
  if (monthly === null || yearly === null) return null;
  const saved = BigInt(monthly) * 12n - BigInt(yearly);
  return saved > 0n ? saved.toString() : null;
}

export function entitlement(plan: PublicPlan, featureKey: string) {
  return plan.entitlements.find((value) => value.featureKey === featureKey) ?? null;
}

/** Renders a plan limit the way the pricing table promises it. */
export function describeLimit(plan: PublicPlan, featureKey: string): string {
  const value = entitlement(plan, featureKey);
  if (value === null || !value.enabled) return "—";
  if (value.limitValue === null) return "Гэрээгээр";
  const amount = BigInt(value.limitValue);
  if (value.unit === "byte") {
    return `${amount / 1_073_741_824n} GB`;
  }
  return new Intl.NumberFormat("mn-MN").format(amount);
}
