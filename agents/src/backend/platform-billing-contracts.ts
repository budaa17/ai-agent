import { z } from "zod";

/**
 * Request shapes for the two platform billing actions that change what a tenant
 * may do (landing-page-roadmap.md §22).
 *
 * Both demand an explicit reason. An operator action on someone else's money or
 * access that carries no explanation is not auditable, only recorded.
 */

const minorAmount = z
  .string()
  .trim()
  .regex(/^\d{1,18}$/, "Amount must be a whole number of minor units");

export const platformManualPaymentConfirmationSchema = z
  .object({
    /** Bank reference or invoice number the finance team can reconcile against. */
    paymentReference: z.string().trim().min(3).max(100),
    periodEnd: z.string().datetime({ offset: true }),
    amountMinor: minorAmount,
    taxMinor: minorAmount.default("0"),
    currency: z.string().trim().length(3).toUpperCase(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const platformAccessOverrideSchema = z
  .object({
    expiresAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type PlatformManualPaymentConfirmation = z.infer<
  typeof platformManualPaymentConfirmationSchema
>;
export type PlatformAccessOverride = z.infer<typeof platformAccessOverrideSchema>;
