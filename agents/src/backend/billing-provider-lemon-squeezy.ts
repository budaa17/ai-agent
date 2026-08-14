import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { InvoiceStatus, SubscriptionStatus } from "./billing-contracts.js";
import type { LemonSqueezyConfig } from "./billing-config.js";
import {
  BillingProviderError,
  redactBillingSecrets,
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

/**
 * Lemon Squeezy adapter (landing-page-roadmap.md §8.1, §17, §24.1).
 *
 * Terminology bridge: a BuildWatch `externalPriceId` is a Lemon Squeezy
 * *variant* id and `externalProductId` is its *product* id.
 *
 * Provider payloads are parsed leniently — unknown fields are ignored rather
 * than rejected — because a provider adding a field must never take payment
 * processing down. BuildWatch's own contracts stay strict; only the foreign
 * shape is tolerant.
 */

const SIGNATURE_HEADER = "x-signature";
const EVENT_NAME_HEADER = "x-event-name";
const HEX_SHA256 = /^[a-f0-9]{64}$/i;

const isoDate = z
  .string()
  .transform((value) => new Date(value))
  .refine((value) => !Number.isNaN(value.getTime()), { message: "Invalid date" });

const nullableIsoDate = z.union([isoDate, z.null()]).catch(null);

const subscriptionAttributes = z.looseObject({
  status: z.string(),
  customer_id: z.union([z.number(), z.string()]).nullish(),
  product_id: z.union([z.number(), z.string()]).nullish(),
  variant_id: z.union([z.number(), z.string()]).nullish(),
  cancelled: z.boolean().nullish(),
  renews_at: z.string().nullish(),
  ends_at: z.string().nullish(),
  trial_ends_at: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});

const invoiceAttributes = z.looseObject({
  status: z.string().nullish(),
  currency: z.string().nullish(),
  subtotal: z.number().nullish(),
  tax: z.number().nullish(),
  total: z.number().nullish(),
  subscription_id: z.union([z.number(), z.string()]).nullish(),
  urls: z.looseObject({ invoice_url: z.string().nullish() }).nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  refunded_at: z.string().nullish(),
});

const webhookEnvelope = z.looseObject({
  meta: z.looseObject({
    event_name: z.string().nullish(),
    webhook_id: z.union([z.string(), z.number()]).nullish(),
    custom_data: z.looseObject({ signup_intent_id: z.string().nullish() }).nullish(),
  }),
  data: z.looseObject({
    id: z.union([z.string(), z.number()]),
    type: z.string(),
    attributes: z.unknown(),
  }),
});

/**
 * Lemon Squeezy status vocabulary mapped onto BuildWatch's canonical states.
 *
 * `cancelled` is handled separately rather than here: the provider marks a
 * subscription cancelled the moment the buyer clicks, while access is paid for
 * until `ends_at`. Mapping it straight to CANCELED would cut off a tenant that
 * has already paid for the rest of the period (§9, §28).
 */
const STATUS_MAP: Readonly<Record<string, SubscriptionStatus>> = {
  on_trial: "TRIALING",
  active: "ACTIVE",
  paused: "PAUSED",
  past_due: "PAST_DUE",
  // Dunning is exhausted, but suspension timing is BuildWatch's own grace policy,
  // not the provider's.
  unpaid: "PAST_DUE",
  expired: "EXPIRED",
};

const INVOICE_STATUS_MAP: Readonly<Record<string, InvoiceStatus>> = {
  pending: "OPEN",
  paid: "PAID",
  void: "VOID",
  refunded: "REFUNDED",
};

function identifier(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function optionalDate(value: unknown): Date | null {
  return nullableIsoDate.parse(value ?? null);
}

export interface LemonSqueezyAdapterOptions {
  readonly config: LemonSqueezyConfig;
  readonly requestTimeoutMs: number;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
}

export class LemonSqueezyBillingProvider implements BillingProvider {
  readonly kind = "LEMON_SQUEEZY" as const;
  readonly #config: LemonSqueezyConfig;
  readonly #timeoutMs: number;
  readonly #now: () => Date;
  readonly #fetch: typeof fetch;

  constructor(options: LemonSqueezyAdapterOptions) {
    this.#config = options.config;
    this.#timeoutMs = options.requestTimeoutMs;
    this.#now = options.now ?? (() => new Date());
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  // -------------------------------------------------------------------------
  // Webhook verification
  // -------------------------------------------------------------------------

  async verifyWebhook(input: RawWebhookInput): Promise<VerifiedBillingEvent> {
    this.#assertSignature(input);

    const payloadHash = createHash("sha256").update(input.rawBody).digest("hex");
    let envelope: z.infer<typeof webhookEnvelope>;
    try {
      envelope = webhookEnvelope.parse(JSON.parse(input.rawBody.toString("utf8")));
    } catch {
      throw new BillingProviderError(
        "PAYLOAD_INVALID",
        "Webhook payload is not a recognised Lemon Squeezy envelope",
        this.kind,
      );
    }

    const eventType =
      envelope.meta.event_name ?? input.headers[EVENT_NAME_HEADER]?.trim() ?? "unknown";
    const signupIntentId = envelope.meta.custom_data?.signup_intent_id ?? null;

    // Branch on the JSON:API resource type, not on the event name. A
    // `subscription_payment_success` event carries a *subscription-invoice*
    // resource whose `status` is "paid"; reading it as a subscription would
    // reject every successful payment as an unknown subscription status.
    const subscription =
      envelope.data.type === "subscriptions" ? this.#readSubscription(envelope) : null;
    const invoice = this.#isInvoiceEvent(envelope.data.type, eventType)
      ? this.#readInvoice(envelope)
      : null;

    return {
      provider: this.kind,
      providerEventId: this.#deriveEventId(envelope, eventType, payloadHash),
      eventType,
      occurredAt:
        optionalDate((envelope.data.attributes as { updated_at?: unknown })?.updated_at) ??
        input.receivedAt,
      payloadHash,
      signupIntentId: typeof signupIntentId === "string" ? signupIntentId : null,
      providerCheckoutId: null,
      subscription,
      invoice,
      recognized: subscription !== null || invoice !== null,
    };
  }

  /**
   * Lemon Squeezy signs the raw request body with HMAC-SHA256 and sends the hex
   * digest in `X-Signature`. Any deviation is a generic failure: telling a caller
   * *why* verification failed hands them an oracle (§24.1).
   */
  #assertSignature(input: RawWebhookInput): void {
    const provided = input.headers[SIGNATURE_HEADER]?.trim();
    if (provided === undefined || !HEX_SHA256.test(provided)) {
      throw new BillingProviderError("SIGNATURE_INVALID", "Webhook signature rejected", this.kind);
    }
    const expected = createHmac("sha256", this.#config.webhookSecret)
      .update(input.rawBody)
      .digest();
    const suppliedBuffer = Buffer.from(provided, "hex");
    // timingSafeEqual throws on a length mismatch, and the regex above already
    // fixes the length, but the guard keeps the failure path uniform.
    if (suppliedBuffer.length !== expected.length || !timingSafeEqual(suppliedBuffer, expected)) {
      throw new BillingProviderError("SIGNATURE_INVALID", "Webhook signature rejected", this.kind);
    }
  }

  /**
   * Lemon Squeezy does not guarantee an event identifier on every payload, so
   * the fallback is a deterministic digest of the parts that identify the state
   * transition. A true duplicate delivery therefore collapses onto one inbox row,
   * while a genuine later change carries a different `updated_at` and is kept.
   */
  #deriveEventId(
    envelope: z.infer<typeof webhookEnvelope>,
    eventType: string,
    payloadHash: string,
  ): string {
    const supplied = identifier(envelope.meta.webhook_id);
    if (supplied !== null) return `ls_${supplied}`;
    const updatedAt = (envelope.data.attributes as { updated_at?: unknown })?.updated_at;
    const parts = [
      eventType,
      envelope.data.type,
      String(envelope.data.id),
      typeof updatedAt === "string" ? updatedAt : payloadHash,
    ];
    return `ls_derived_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40)}`;
  }

  #readSubscription(envelope: z.infer<typeof webhookEnvelope>): ProviderSubscription | null {
    const parsed = subscriptionAttributes.safeParse(envelope.data.attributes);
    if (!parsed.success) return null;
    const attributes = parsed.data;

    const endsAt = optionalDate(attributes.ends_at);
    const renewsAt = optionalDate(attributes.renews_at);
    const status = this.#mapSubscriptionStatus(attributes.status, endsAt);

    return {
      providerSubscriptionId: String(envelope.data.id),
      providerCustomerId: identifier(attributes.customer_id),
      status,
      providerStatus: attributes.status,
      // The provider reports when the subscription next renews, not when the
      // current period opened, so the start stays unknown rather than guessed.
      currentPeriodStart: null,
      currentPeriodEnd: endsAt ?? renewsAt,
      cancelAtPeriodEnd:
        status !== "CANCELED" && status !== "EXPIRED" && this.#isCancelling(attributes),
      canceledAt: this.#isCancelling(attributes) ? optionalDate(attributes.updated_at) : null,
      providerUpdatedAt: optionalDate(attributes.updated_at),
      externalPriceId: identifier(attributes.variant_id),
      externalProductId: identifier(attributes.product_id),
    };
  }

  #isCancelling(attributes: z.infer<typeof subscriptionAttributes>): boolean {
    return attributes.cancelled === true || attributes.status === "cancelled";
  }

  /**
   * A cancelled subscription keeps the access it has already paid for. Only once
   * the paid period has actually elapsed does it become terminal.
   */
  #mapSubscriptionStatus(providerStatus: string, endsAt: Date | null): SubscriptionStatus {
    if (providerStatus === "cancelled") {
      return endsAt !== null && endsAt.getTime() > this.#now().getTime() ? "ACTIVE" : "CANCELED";
    }
    const mapped = STATUS_MAP[providerStatus];
    if (mapped === undefined) {
      // Default-deny: an unrecognised provider status must never be read as
      // "keep serving this tenant".
      throw new BillingProviderError(
        "PAYLOAD_INVALID",
        `Unrecognised subscription status "${providerStatus}"`,
        this.kind,
      );
    }
    return mapped;
  }

  #isInvoiceEvent(resourceType: string, eventType: string): boolean {
    return (
      resourceType === "subscription-invoices" ||
      resourceType === "orders" ||
      eventType.startsWith("subscription_payment_") ||
      eventType === "order_created"
    );
  }

  #readInvoice(envelope: z.infer<typeof webhookEnvelope>): ProviderInvoice | null {
    const parsed = invoiceAttributes.safeParse(envelope.data.attributes);
    if (!parsed.success) return null;
    const attributes = parsed.data;

    const subtotal = BigInt(Math.trunc(attributes.subtotal ?? 0));
    const tax = BigInt(Math.trunc(attributes.tax ?? 0));
    const reportedTotal =
      attributes.total === null || attributes.total === undefined
        ? null
        : BigInt(Math.trunc(attributes.total));
    // The database enforces total = subtotal + tax. Recomputing here rather than
    // trusting a possibly rounded provider total keeps the write from failing
    // that constraint at the end of the webhook pipeline.
    const total = subtotal + tax;
    if (reportedTotal !== null && reportedTotal !== total) {
      throw new BillingProviderError(
        "PAYLOAD_INVALID",
        "Invoice components do not add up to the reported total",
        this.kind,
      );
    }

    const status = INVOICE_STATUS_MAP[attributes.status ?? ""] ?? "OPEN";
    return {
      providerInvoiceId: String(envelope.data.id),
      providerSubscriptionId: identifier(attributes.subscription_id),
      status: attributes.refunded_at ? "REFUNDED" : status,
      currency: (attributes.currency ?? "USD").toUpperCase(),
      subtotalMinor: subtotal,
      taxMinor: tax,
      totalMinor: total,
      paidAt: status === "PAID" ? optionalDate(attributes.created_at) : null,
      dueAt: null,
      hostedInvoiceUrl: attributes.urls?.invoice_url ?? null,
      invoiceNumber: null,
    };
  }

  // -------------------------------------------------------------------------
  // Outbound API
  // -------------------------------------------------------------------------

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    if (input.price.provider !== this.kind) {
      throw new BillingProviderError(
        "PRICE_NOT_ALLOWED",
        "Resolved price belongs to another provider",
        this.kind,
      );
    }

    const body = {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: input.customerEmail,
            name: input.customerName,
            // Opaque correlation only. No tenant is created before payment, so
            // there is nothing sensitive to hand the provider here (§20.2).
            custom: { signup_intent_id: input.signupIntentId },
          },
          product_options: {
            redirect_url: input.successUrl,
            enabled_variants: [Number(input.price.externalPriceId)],
          },
          checkout_options: { embed: false },
        },
        relationships: {
          store: { data: { type: "stores", id: String(this.#config.storeId) } },
          variant: { data: { type: "variants", id: String(input.price.externalPriceId) } },
        },
      },
    };

    const payload = await this.#request<{
      data?: { id?: unknown; attributes?: { url?: unknown; expires_at?: unknown } };
    }>("POST", "/v1/checkouts", body, input.correlationId);

    const url = payload.data?.attributes?.url;
    const checkoutId = identifier(payload.data?.id);
    if (typeof url !== "string" || checkoutId === null) {
      throw new BillingProviderError(
        "PROVIDER_UNAVAILABLE",
        "Checkout response did not contain a hosted URL",
        this.kind,
      );
    }
    return {
      provider: this.kind,
      checkoutId,
      url,
      expiresAt: optionalDate(payload.data?.attributes?.expires_at),
    };
  }

  async createCustomerPortal(input: CustomerPortalInput): Promise<PortalResult> {
    const payload = await this.#request<{
      data?: { attributes?: { urls?: { customer_portal?: unknown } } };
    }>(
      "GET",
      `/v1/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}`,
      undefined,
      input.correlationId,
    );

    const url = payload.data?.attributes?.urls?.customer_portal;
    if (typeof url !== "string") {
      throw new BillingProviderError(
        "PROVIDER_UNAVAILABLE",
        "Provider did not return a customer portal URL",
        this.kind,
      );
    }
    return { url, expiresAt: null };
  }

  async getSubscription(externalId: string): Promise<ProviderSubscription> {
    const payload = await this.#request<{ data?: unknown }>(
      "GET",
      `/v1/subscriptions/${encodeURIComponent(externalId)}`,
      undefined,
      `get-subscription-${externalId}`,
    );
    const envelope = webhookEnvelope.safeParse({ meta: {}, data: payload.data });
    const subscription = envelope.success ? this.#readSubscription(envelope.data) : null;
    if (subscription === null) {
      throw new BillingProviderError(
        "PAYLOAD_INVALID",
        "Subscription response could not be interpreted",
        this.kind,
      );
    }
    return subscription;
  }

  async cancelAtPeriodEnd(externalId: string): Promise<void> {
    await this.#request(
      "DELETE",
      `/v1/subscriptions/${encodeURIComponent(externalId)}`,
      undefined,
      `cancel-subscription-${externalId}`,
    );
  }

  /**
   * One attempt, never a retry.
   *
   * Lemon Squeezy has no idempotency key on checkout creation, so a retry after
   * a timeout can mint a second checkout for the same buyer. Failing loudly and
   * letting the caller's own idempotency record decide is safer than quietly
   * duplicating a payment surface.
   */
  async #request<T>(
    method: string,
    path: string,
    body: unknown,
    correlationId: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#config.apiBaseUrl}${path}`, {
        method,
        headers: {
          accept: "application/vnd.api+json",
          "content-type": "application/vnd.api+json",
          authorization: `Bearer ${this.#config.apiKey}`,
          "x-correlation-id": correlationId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new BillingProviderError(
        "PROVIDER_UNAVAILABLE",
        redactBillingSecrets(
          `Billing provider request failed: ${error instanceof Error ? error.name : "unknown"}`,
        ),
        this.kind,
      );
    }

    if (!response.ok) {
      throw new BillingProviderError(
        response.status >= 500 || response.status === 429
          ? "PROVIDER_UNAVAILABLE"
          : "PAYLOAD_INVALID",
        redactBillingSecrets(
          `Billing provider returned ${response.status}${await this.#errorTitle(response)}`,
        ),
        this.kind,
      );
    }

    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new BillingProviderError(
        "PROVIDER_UNAVAILABLE",
        "Billing provider returned an unreadable response",
        this.kind,
      );
    }
  }

  /** Extracts only the short JSON:API error title, never the whole body. */
  async #errorTitle(response: Response): Promise<string> {
    try {
      const parsed = (await response.json()) as { errors?: { title?: unknown }[] };
      const title = parsed.errors?.[0]?.title;
      return typeof title === "string" ? `: ${title.slice(0, 120)}` : "";
    } catch {
      return "";
    }
  }
}
