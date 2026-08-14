import { z } from "zod";
import { authorizedFetch } from "./client";

/**
 * Company Admin billing client (landing-page-roadmap.md §21, §23.2).
 *
 * Uses the same authorized transport as the rest of the console, so token
 * refresh behaves identically. These routes are on the billing allowlist and
 * therefore keep answering while the workspace itself is gated.
 */

const subscriptionSchema = z.object({
  lifecycleStatus: z.enum(["PENDING_PAYMENT", "ACTIVE", "PAYMENT_GRACE", "SUSPENDED", "ARCHIVED"]),
  accessReason: z.string().nullable(),
  accessChangedAt: z.string().nullable(),
  billingEmail: z.string().nullable(),
  vatPayer: z.boolean(),
  subscription: z
    .object({
      status: z.string(),
      provider: z.string(),
      planCode: z.string(),
      planName: z.string(),
      planVersion: z.number(),
      interval: z.string(),
      currency: z.string(),
      unitAmountMinor: z.string().nullable(),
      currentPeriodStart: z.string().nullable(),
      currentPeriodEnd: z.string().nullable(),
      graceEndsAt: z.string().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      canceledAt: z.string().nullable(),
    })
    .nullable(),
});

const usageSchema = z.object({
  periodStart: z.string(),
  activeProjects: z.number(),
  activeUsers: z.number(),
  storageBytes: z.string(),
  aiRunsThisMonth: z.number(),
  aiMicroUsdThisMonth: z.string(),
});

const entitlementsSchema = z.object({
  source: z.string(),
  refreshedAt: z.string().nullable(),
  values: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean(),
        limitValue: z.string().nullable(),
        unit: z.string().nullable(),
      }),
    )
    .nullable(),
});

const invoicesSchema = z.object({
  invoices: z.array(
    z.object({
      id: z.string(),
      invoiceNumber: z.string().nullable(),
      status: z.string(),
      currency: z.string(),
      subtotalMinor: z.string(),
      taxMinor: z.string(),
      totalMinor: z.string(),
      paidAt: z.string().nullable(),
      dueAt: z.string().nullable(),
      hostedInvoiceUrl: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export type TenantSubscriptionView = z.infer<typeof subscriptionSchema>;
export type TenantUsageView = z.infer<typeof usageSchema>;
export type TenantEntitlementsView = z.infer<typeof entitlementsSchema>;
export type TenantInvoicesView = z.infer<typeof invoicesSchema>;

async function billingRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: { method: string; body?: unknown },
): Promise<T> {
  const response = await authorizedFetch(`/api${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      "Билл мэдээлэл ачаалж чадсангүй";
    throw new Error(message);
  }
  return schema.parse(payload);
}

export const tenantBillingApi = {
  subscription: () => billingRequest("/v1/billing/subscription", subscriptionSchema),
  usage: () => billingRequest("/v1/billing/usage", usageSchema),
  entitlements: () => billingRequest("/v1/billing/entitlements", entitlementsSchema),
  invoices: () => billingRequest("/v1/billing/invoices", invoicesSchema),
  portal: () =>
    billingRequest("/v1/billing/portal", z.object({ url: z.string() }), { method: "POST" }),
  cancel: (reason: string | null) =>
    billingRequest(
      "/v1/billing/cancel",
      z.object({ cancelAtPeriodEnd: z.literal(true), currentPeriodEnd: z.string().nullable() }),
      { method: "POST", body: { reason } },
    ),
};
