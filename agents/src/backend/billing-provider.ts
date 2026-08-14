import type {
  BillingInterval,
  BillingProviderKind,
  InvoiceStatus,
  SubscriptionStatus,
} from "./billing-contracts.js";

/**
 * Provider-neutral payment boundary (landing-page-roadmap.md §17).
 *
 * Every payment provider is reduced to this one interface so that swapping
 * Lemon Squeezy for Paddle, or falling back to a domestic bank transfer, never
 * reaches tenant authorization, the project API or the console.
 *
 * Two rules hold for every implementation:
 *   1. Card numbers, CVCs and raw payment methods never travel through
 *      BuildWatch. Checkout is always hosted by the provider (§24.4).
 *   2. Nothing a browser sends decides what is charged. The amount and the
 *      provider price always come from the server-side allowlist (§24.2).
 */

export type BillingProviderErrorCode =
  | "NOT_CONFIGURED"
  | "SIGNATURE_INVALID"
  | "PAYLOAD_INVALID"
  | "PRICE_NOT_ALLOWED"
  | "PROVIDER_UNAVAILABLE"
  | "UNSUPPORTED_OPERATION";

/**
 * Carries a stable code and an already-sanitised message. Provider response
 * bodies, signatures and API keys are never folded into it, because this message
 * reaches logs and support tooling.
 */
export class BillingProviderError extends Error {
  constructor(
    readonly code: BillingProviderErrorCode,
    message: string,
    readonly provider?: BillingProviderKind,
  ) {
    super(message);
    this.name = "BillingProviderError";
  }
}

/** A price the server has already checked against its own allowlist. */
export interface BillingProviderPriceRef {
  readonly planId: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly interval: BillingInterval;
  readonly currency: string;
  readonly unitAmountMinor: bigint | null;
  readonly provider: BillingProviderKind;
  readonly environment: string;
  readonly externalProductId: string;
  readonly externalPriceId: string;
}

export interface CreateCheckoutInput {
  /** Opaque reference carried through the provider and back on the webhook. */
  readonly signupIntentId: string;
  readonly price: BillingProviderPriceRef;
  readonly customerEmail: string;
  readonly customerName: string;
  readonly companyName: string;
  /** Already validated against the return-URL allowlist by the caller. */
  readonly successUrl: string;
  readonly correlationId: string;
}

export interface CheckoutResult {
  readonly provider: BillingProviderKind;
  readonly checkoutId: string;
  readonly url: string;
  readonly expiresAt: Date | null;
}

export interface CustomerPortalInput {
  readonly providerSubscriptionId: string;
  readonly providerCustomerId: string | null;
  readonly correlationId: string;
}

export interface PortalResult {
  readonly url: string;
  readonly expiresAt: Date | null;
}

export interface RawWebhookInput {
  /**
   * The exact bytes the provider signed. Re-serialising parsed JSON changes key
   * order and whitespace and silently breaks every signature check, so the raw
   * buffer is required rather than a parsed object.
   */
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly receivedAt: Date;
}

export interface ProviderSubscription {
  readonly providerSubscriptionId: string;
  readonly providerCustomerId: string | null;
  /** BuildWatch's canonical status, already mapped from the provider's own. */
  readonly status: SubscriptionStatus;
  /** The provider's raw status, kept for diagnostics only — never for policy. */
  readonly providerStatus: string;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly canceledAt: Date | null;
  readonly providerUpdatedAt: Date | null;
  readonly externalPriceId: string | null;
  readonly externalProductId: string | null;
}

export interface ProviderInvoice {
  readonly providerInvoiceId: string;
  readonly providerSubscriptionId: string | null;
  readonly status: InvoiceStatus;
  readonly currency: string;
  readonly subtotalMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
  readonly paidAt: Date | null;
  readonly dueAt: Date | null;
  readonly hostedInvoiceUrl: string | null;
  readonly invoiceNumber: string | null;
}

export interface VerifiedBillingEvent {
  readonly provider: BillingProviderKind;
  /**
   * Stable identity used by the webhook inbox to reject replays. When a provider
   * does not mint one, the adapter derives it deterministically from the payload
   * so that a genuine duplicate still collapses to a single row.
   */
  readonly providerEventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly payloadHash: string;
  /** Present when the event belongs to a checkout BuildWatch initiated. */
  readonly signupIntentId: string | null;
  /**
   * Present only after the provider adapter has authoritatively retrieved and
   * validated the hosted checkout that emitted this event.
   */
  readonly providerCheckoutId: string | null;
  readonly subscription: ProviderSubscription | null;
  readonly invoice: ProviderInvoice | null;
  /**
   * False for an event type this adapter does not model. The inbox stores it as
   * IGNORED; it must never grant or extend access (§20.3).
   */
  readonly recognized: boolean;
}

export interface BillingProvider {
  readonly kind: BillingProviderKind;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult>;
  createCustomerPortal(input: CustomerPortalInput): Promise<PortalResult>;
  verifyWebhook(input: RawWebhookInput): Promise<VerifiedBillingEvent>;
  getSubscription(externalId: string): Promise<ProviderSubscription>;
  cancelAtPeriodEnd(externalId: string): Promise<void>;
}

/**
 * Masks anything that looks like a provider credential or signature before it
 * can reach a log line, an error report or an audit record (§24.1, §24.4).
 */
export function redactBillingSecrets(value: string): string {
  return value
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, "[redacted]")
    .replace(/\b[a-f0-9]{64}\b/gi, "[redacted]")
    .replace(
      /\b(Bearer|Authorization|X-Signature|api[_-]?key|secret|token)\b\s*[:=]?\s*\S+/gi,
      "$1 [redacted]",
    );
}
