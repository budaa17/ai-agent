import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { StripeConfig } from "./billing-config.js";
import {
  BillingProviderError,
  type BillingProvider,
  type CheckoutResult,
  type CreateCheckoutInput,
  type CustomerPortalInput,
  type PortalResult,
  type ProviderInvoice,
  type ProviderSubscription,
  type RawWebhookInput,
  type VerifiedBillingEvent,
} from "./billing-provider.js";

const STRIPE_SIGNATURE_HEADER = "stripe-signature";
const RECOGNIZED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
]);

function id(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

function timestamp(value: number | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value * 1_000);
}

function subscriptionStatus(value: Stripe.Subscription.Status) {
  switch (value) {
    case "trialing":
      return "TRIALING" as const;
    case "active":
      return "ACTIVE" as const;
    case "past_due":
      return "PAST_DUE" as const;
    case "paused":
      return "PAUSED" as const;
    case "canceled":
      return "CANCELED" as const;
    case "incomplete_expired":
    case "unpaid":
      return "EXPIRED" as const;
    case "incomplete":
      return "PENDING" as const;
    default:
      return "PENDING" as const;
  }
}

function invoiceStatus(value: Stripe.Invoice.Status | null) {
  switch (value) {
    case "draft":
      return "DRAFT" as const;
    case "open":
      return "OPEN" as const;
    case "paid":
      return "PAID" as const;
    case "void":
      return "VOID" as const;
    case "uncollectible":
      return "UNCOLLECTIBLE" as const;
    default:
      return "OPEN" as const;
  }
}

export function normalizeStripeInvoice(value: Stripe.Invoice): ProviderInvoice {
  const subscriptionId = value.parent?.subscription_details?.subscription ?? null;
  const tax = (value.total_taxes ?? []).reduce((sum, entry) => sum + entry.amount, 0);
  return {
    providerInvoiceId: value.id,
    providerSubscriptionId: id(subscriptionId),
    status: invoiceStatus(value.status),
    currency: value.currency.toUpperCase(),
    subtotalMinor: BigInt(value.subtotal),
    taxMinor: BigInt(tax),
    totalMinor: BigInt(value.total),
    paidAt: timestamp(value.status_transitions.paid_at),
    dueAt: timestamp(value.due_date),
    hostedInvoiceUrl: value.hosted_invoice_url ?? null,
    invoiceNumber: value.number,
  };
}

export interface StripeBillingProviderOptions {
  readonly config: StripeConfig;
  readonly client?: Stripe;
  readonly now?: () => Date;
  readonly expectedLivemode?: boolean;
}

/** Stripe-hosted checkout, portal and signed event normalization. */
export class StripeBillingProvider implements BillingProvider {
  readonly kind = "STRIPE" as const;
  readonly #config: StripeConfig;
  readonly #stripe: Stripe;
  readonly #now: () => Date;
  readonly #expectedLivemode: boolean;

  constructor(options: StripeBillingProviderOptions) {
    this.#config = options.config;
    this.#stripe =
      options.client ?? new Stripe(options.config.secretKey, { apiVersion: "2026-07-29.dahlia" });
    this.#now = options.now ?? (() => new Date());
    this.#expectedLivemode =
      options.expectedLivemode ?? options.config.secretKey.startsWith("sk_live_");
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    if (input.price.provider !== this.kind) {
      throw new BillingProviderError(
        "PRICE_NOT_ALLOWED",
        "Resolved price belongs to another provider",
        this.kind,
      );
    }
    const successUrl = new URL(input.successUrl);
    successUrl.searchParams.set("signup", input.signupIntentId);
    successUrl.searchParams.set("checkout", "{CHECKOUT_SESSION_ID}");
    const cancelUrl = new URL(input.successUrl);
    cancelUrl.pathname = "/company-signup";
    cancelUrl.search = "";
    cancelUrl.searchParams.set("signup", input.signupIntentId);

    try {
      const session = await this.#stripe.checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: input.price.externalPriceId, quantity: 1 }],
          customer_email: input.customerEmail,
          client_reference_id: input.signupIntentId,
          success_url: successUrl.toString(),
          cancel_url: cancelUrl.toString(),
          billing_address_collection: "required",
          ...(this.#config.automaticTaxEnabled ? { automatic_tax: { enabled: true } } : {}),
          metadata: {
            signup_intent_id: input.signupIntentId,
            plan_id: input.price.planId,
            plan_code: input.price.planCode,
            plan_version: String(input.price.planVersion),
          },
          subscription_data: {
            metadata: {
              signup_intent_id: input.signupIntentId,
              plan_id: input.price.planId,
              plan_code: input.price.planCode,
              plan_version: String(input.price.planVersion),
            },
          },
        },
        { idempotencyKey: `buildwatch-checkout-${input.signupIntentId}` },
      );
      if (session.url === null) {
        throw new BillingProviderError(
          "PROVIDER_UNAVAILABLE",
          "Stripe did not return a hosted checkout URL",
          this.kind,
        );
      }
      return {
        provider: this.kind,
        checkoutId: session.id,
        url: session.url,
        expiresAt: timestamp(session.expires_at),
      };
    } catch (error) {
      if (error instanceof BillingProviderError) throw error;
      throw new BillingProviderError(
        "PROVIDER_UNAVAILABLE",
        "Stripe checkout request failed",
        this.kind,
      );
    }
  }

  async createCustomerPortal(input: CustomerPortalInput): Promise<PortalResult> {
    if (input.providerCustomerId === null || !input.providerCustomerId.startsWith("cus_")) {
      throw new BillingProviderError(
        "PAYLOAD_INVALID",
        "Stripe customer is unavailable",
        this.kind,
      );
    }
    try {
      const session = await this.#stripe.billingPortal.sessions.create({
        customer: input.providerCustomerId,
        ...(this.#config.portalConfigurationId === null
          ? {}
          : { configuration: this.#config.portalConfigurationId }),
      });
      return { url: session.url, expiresAt: null };
    } catch {
      throw new BillingProviderError(
        "PROVIDER_UNAVAILABLE",
        "Stripe portal request failed",
        this.kind,
      );
    }
  }

  async verifyWebhook(input: RawWebhookInput): Promise<VerifiedBillingEvent> {
    if (this.#config.webhookSecret === null) {
      throw new BillingProviderError(
        "NOT_CONFIGURED",
        "Stripe webhook verification is not configured",
        this.kind,
      );
    }
    const signature = input.headers[STRIPE_SIGNATURE_HEADER];
    if (signature === undefined) {
      throw new BillingProviderError("SIGNATURE_INVALID", "Webhook signature rejected", this.kind);
    }
    let event: Stripe.Event;
    try {
      event = this.#stripe.webhooks.constructEvent(
        input.rawBody,
        signature,
        this.#config.webhookSecret,
      );
    } catch {
      throw new BillingProviderError("SIGNATURE_INVALID", "Webhook signature rejected", this.kind);
    }
    if (event.livemode !== this.#expectedLivemode) {
      throw new BillingProviderError(
        "PAYLOAD_INVALID",
        "Webhook environment does not match billing environment",
        this.kind,
      );
    }
    const object = event.data.object;
    const occurredAt = timestamp(event.created) ?? input.receivedAt;
    const checkout =
      object.object === "checkout.session" && event.type === "checkout.session.completed"
        ? await this.#verifiedCheckout(object, occurredAt)
        : null;
    const subscription =
      object.object === "subscription"
        ? this.#subscription(object, occurredAt)
        : (checkout?.subscription ?? null);
    const invoice =
      object.object === "invoice" ? normalizeStripeInvoice(object) : (checkout?.invoice ?? null);
    const signupIntentId =
      checkout !== null
        ? checkout.signupIntentId
        : object.object === "checkout.session"
          ? (object.metadata?.signup_intent_id ?? object.client_reference_id)
          : object.object === "subscription"
            ? (object.metadata?.signup_intent_id ?? null)
            : null;
    return {
      provider: this.kind,
      providerEventId: event.id,
      eventType: event.type,
      occurredAt,
      payloadHash: createHash("sha256").update(input.rawBody).digest("hex"),
      signupIntentId,
      providerCheckoutId: checkout?.providerCheckoutId ?? null,
      subscription,
      invoice,
      recognized: RECOGNIZED_EVENTS.has(event.type),
    };
  }

  async getSubscription(externalId: string): Promise<ProviderSubscription> {
    try {
      return this.#subscription(await this.#stripe.subscriptions.retrieve(externalId));
    } catch {
      throw new BillingProviderError(
        "PROVIDER_UNAVAILABLE",
        "Stripe subscription request failed",
        this.kind,
      );
    }
  }

  async cancelAtPeriodEnd(externalId: string): Promise<void> {
    try {
      await this.#stripe.subscriptions.update(
        externalId,
        { cancel_at_period_end: true },
        { idempotencyKey: `buildwatch-cancel-${externalId}` },
      );
    } catch {
      throw new BillingProviderError(
        "PROVIDER_UNAVAILABLE",
        "Stripe cancellation request failed",
        this.kind,
      );
    }
  }

  async #verifiedCheckout(
    signedSession: Stripe.Checkout.Session,
    observedAt: Date,
  ): Promise<{
    providerCheckoutId: string;
    signupIntentId: string;
    subscription: ProviderSubscription;
    invoice: ProviderInvoice | null;
  }> {
    let session: Stripe.Checkout.Session;
    try {
      session = await this.#stripe.checkout.sessions.retrieve(signedSession.id);
    } catch {
      throw new BillingProviderError(
        "PROVIDER_UNAVAILABLE",
        "Stripe checkout session could not be retrieved",
        this.kind,
      );
    }

    if (
      session.livemode !== this.#expectedLivemode ||
      session.mode !== "subscription" ||
      session.status !== "complete" ||
      session.payment_status !== "paid"
    ) {
      throw new BillingProviderError(
        "PAYLOAD_INVALID",
        "Stripe checkout is not an authoritative paid subscription",
        this.kind,
      );
    }

    const signupIntentId = session.metadata?.signup_intent_id ?? session.client_reference_id;
    const providerSubscriptionId = id(session.subscription);
    const providerCustomerId = id(session.customer);
    if (signupIntentId === null || providerSubscriptionId === null || providerCustomerId === null) {
      throw new BillingProviderError(
        "PAYLOAD_INVALID",
        "Stripe checkout binding is incomplete",
        this.kind,
      );
    }

    let subscription: ProviderSubscription;
    try {
      subscription = this.#subscription(
        await this.#stripe.subscriptions.retrieve(providerSubscriptionId),
        observedAt,
      );
    } catch (error) {
      if (error instanceof BillingProviderError) throw error;
      throw new BillingProviderError(
        "PROVIDER_UNAVAILABLE",
        "Stripe subscription could not be retrieved",
        this.kind,
      );
    }
    if (subscription.providerCustomerId !== providerCustomerId) {
      throw new BillingProviderError(
        "PAYLOAD_INVALID",
        "Stripe checkout customer does not match its subscription",
        this.kind,
      );
    }

    // Stripe may deliver invoice.paid before checkout.session.completed. Fetch
    // the Checkout Session's authoritative invoice here so provisioning does
    // not depend on webhook delivery order. Invoice retrieval is auxiliary and
    // must not deny a valid paid subscription during a transient Stripe outage;
    // a later invoice event can still converge the money trail.
    const providerInvoiceId = id(session.invoice);
    let invoice: ProviderInvoice | null = null;
    if (providerInvoiceId !== null) {
      try {
        invoice = normalizeStripeInvoice(await this.#stripe.invoices.retrieve(providerInvoiceId));
      } catch {
        invoice = null;
      }
    }

    return { providerCheckoutId: session.id, signupIntentId, subscription, invoice };
  }

  #subscription(value: Stripe.Subscription, observedAt = this.#now()): ProviderSubscription {
    const item = value.items.data[0] ?? null;
    const price = item?.price ?? null;
    return {
      providerSubscriptionId: value.id,
      providerCustomerId: id(value.customer),
      status: subscriptionStatus(value.status),
      providerStatus: value.status,
      currentPeriodStart: timestamp(item?.current_period_start),
      currentPeriodEnd: timestamp(item?.current_period_end),
      cancelAtPeriodEnd: value.cancel_at_period_end,
      canceledAt: timestamp(value.canceled_at),
      // Stripe Subscription objects do not expose a stable object-level
      // `updated_at`. For webhook ordering, the signed Event.created timestamp
      // is the authoritative observation time. Direct reconciliation uses now.
      providerUpdatedAt: observedAt,
      externalPriceId: price?.id ?? null,
      externalProductId: price === null ? null : id(price.product),
    };
  }
}
