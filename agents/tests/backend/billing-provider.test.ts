import { createHmac } from "node:crypto";
import {
  assertAllowedReturnUrl,
  billingConfigSchema,
  BillingCheckoutService,
  BillingProviderError,
  createBillingProviders,
  LemonSqueezyBillingProvider,
  ManualInvoiceBillingProvider,
  redactBillingSecrets,
  resolveBillingConfig,
  resolveBillingPublicAppBaseUrl,
  type BillingConfig,
  type BillingPriceResolver,
  type BillingProviderPriceRef,
  type CheckoutIdempotencyRecord,
  type CheckoutIdempotencyStore,
} from "../../src/backend/index.js";

const NOW = new Date("2026-08-12T09:00:00.000Z");
const WEBHOOK_SECRET = "lemon-squeezy-test-webhook-secret-0123456789";
const API_KEY = "lemon-squeezy-test-api-key-0123456789abcdef";

function lemonSqueezy(overrides: { now?: () => Date; fetchImpl?: typeof fetch } = {}) {
  return new LemonSqueezyBillingProvider({
    config: {
      apiKey: API_KEY,
      storeId: "42",
      webhookSecret: WEBHOOK_SECRET,
      apiBaseUrl: "https://api.lemonsqueezy.test",
    },
    requestTimeoutMs: 5_000,
    now: overrides.now ?? (() => NOW),
    fetchImpl: overrides.fetchImpl,
  });
}

function signed(body: unknown, secret = WEBHOOK_SECRET) {
  const rawBody = Buffer.from(JSON.stringify(body), "utf8");
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  return {
    rawBody,
    headers: { "x-signature": signature, "x-event-name": "subscription_updated" },
    receivedAt: NOW,
  };
}

function subscriptionPayload(
  attributes: Record<string, unknown>,
  meta: Record<string, unknown> = {},
) {
  return {
    meta: {
      event_name: "subscription_updated",
      custom_data: { signup_intent_id: "intent-1" },
      ...meta,
    },
    data: {
      id: "sub-100",
      type: "subscriptions",
      attributes: {
        status: "active",
        customer_id: 7,
        product_id: 11,
        variant_id: 22,
        renews_at: "2026-09-12T09:00:00.000Z",
        updated_at: "2026-08-12T08:59:00.000Z",
        ...attributes,
      },
    },
  };
}

describe("Lemon Squeezy webhook signature", () => {
  it("accepts a payload signed with the configured secret", async () => {
    const event = await lemonSqueezy().verifyWebhook(signed(subscriptionPayload({})));
    expect(event.provider).toBe("LEMON_SQUEEZY");
    expect(event.recognized).toBe(true);
    expect(event.signupIntentId).toBe("intent-1");
    expect(event.subscription?.status).toBe("ACTIVE");
  });

  it("refuses a body that changed after signing", async () => {
    const input = signed(subscriptionPayload({}));
    const tampered = {
      ...input,
      rawBody: Buffer.from(input.rawBody.toString("utf8").replace("sub-100", "sub-999"), "utf8"),
    };
    await expect(lemonSqueezy().verifyWebhook(tampered)).rejects.toMatchObject({
      code: "SIGNATURE_INVALID",
    });
  });

  it("refuses a signature made with a different secret", async () => {
    const input = signed(subscriptionPayload({}), "an-entirely-different-secret-value-123456");
    await expect(lemonSqueezy().verifyWebhook(input)).rejects.toMatchObject({
      code: "SIGNATURE_INVALID",
    });
  });

  it("refuses missing, short and non-hex signatures alike", async () => {
    const base = signed(subscriptionPayload({}));
    const variants = [
      {},
      { "x-signature": "" },
      { "x-signature": "not-hex-at-all" },
      { "x-signature": base.headers["x-signature"].slice(0, 40) },
      { "x-signature": `${base.headers["x-signature"]}ff` },
    ];
    for (const headers of variants) {
      await expect(
        lemonSqueezy().verifyWebhook({ ...base, headers: headers as Record<string, string> }),
      ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    }
  });

  it("never puts the secret or the expected digest in the failure message", async () => {
    const input = {
      ...signed(subscriptionPayload({})),
      headers: { "x-signature": "00".repeat(32) },
    };
    await expect(lemonSqueezy().verifyWebhook(input)).rejects.toSatisfy((error: Error) => {
      expect(error.message).not.toContain(WEBHOOK_SECRET);
      expect(error.message).toBe("Webhook signature rejected");
      return true;
    });
  });
});

describe("Lemon Squeezy status mapping", () => {
  it("maps the provider vocabulary onto canonical states", async () => {
    const cases: ReadonlyArray<[string, string]> = [
      ["on_trial", "TRIALING"],
      ["active", "ACTIVE"],
      ["paused", "PAUSED"],
      ["past_due", "PAST_DUE"],
      ["unpaid", "PAST_DUE"],
      ["expired", "EXPIRED"],
    ];
    for (const [providerStatus, canonical] of cases) {
      const event = await lemonSqueezy().verifyWebhook(
        signed(subscriptionPayload({ status: providerStatus })),
      );
      expect(event.subscription?.status).toBe(canonical);
      expect(event.subscription?.providerStatus).toBe(providerStatus);
    }
  });

  it("keeps a cancelled subscription active until the paid period actually ends", async () => {
    // Lemon Squeezy flips the status the moment the buyer cancels, but the period
    // is already paid for. Reading that as CANCELED would cut the tenant off early.
    const event = await lemonSqueezy().verifyWebhook(
      signed(
        subscriptionPayload({
          status: "cancelled",
          cancelled: true,
          ends_at: "2026-09-12T09:00:00.000Z",
        }),
      ),
    );
    expect(event.subscription?.status).toBe("ACTIVE");
    expect(event.subscription?.cancelAtPeriodEnd).toBe(true);
    expect(event.subscription?.currentPeriodEnd?.toISOString()).toBe("2026-09-12T09:00:00.000Z");
  });

  it("becomes terminal once the cancelled period has elapsed", async () => {
    const event = await lemonSqueezy().verifyWebhook(
      signed(
        subscriptionPayload({
          status: "cancelled",
          cancelled: true,
          ends_at: "2026-08-01T09:00:00.000Z",
        }),
      ),
    );
    expect(event.subscription?.status).toBe("CANCELED");
    expect(event.subscription?.cancelAtPeriodEnd).toBe(false);
  });

  it("refuses an unknown status instead of assuming the tenant may keep working", async () => {
    await expect(
      lemonSqueezy().verifyWebhook(
        signed(subscriptionPayload({ status: "quantum_superposition" })),
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_INVALID" });
  });

  it("ignores an event type it does not model without granting anything", async () => {
    const payload = {
      meta: { event_name: "license_key_created" },
      data: { id: "lk-1", type: "license-keys", attributes: { status: "active" } },
    };
    const event = await lemonSqueezy().verifyWebhook(signed(payload));
    expect(event.recognized).toBe(false);
    expect(event.subscription).toBeNull();
    expect(event.invoice).toBeNull();
  });
});

describe("Lemon Squeezy event identity", () => {
  it("prefers the provider event id when one is supplied", async () => {
    const event = await lemonSqueezy().verifyWebhook(
      signed(subscriptionPayload({}, { webhook_id: "wh-77" })),
    );
    expect(event.providerEventId).toBe("ls_wh-77");
  });

  it("derives a stable id so a duplicate delivery collapses to one row", async () => {
    const payload = subscriptionPayload({});
    const first = await lemonSqueezy().verifyWebhook(signed(payload));
    const second = await lemonSqueezy().verifyWebhook(signed(payload));
    expect(first.providerEventId).toBe(second.providerEventId);

    const later = await lemonSqueezy().verifyWebhook(
      signed(subscriptionPayload({ updated_at: "2026-08-12T09:30:00.000Z" })),
    );
    expect(later.providerEventId).not.toBe(first.providerEventId);
  });
});

describe("Lemon Squeezy invoice projection", () => {
  function invoicePayload(attributes: Record<string, unknown>) {
    return {
      meta: { event_name: "subscription_payment_success" },
      data: {
        id: "inv-5",
        type: "subscription-invoices",
        attributes: {
          status: "paid",
          currency: "usd",
          subtotal: 11_100,
          tax: 0,
          total: 11_100,
          subscription_id: 100,
          created_at: "2026-08-12T08:00:00.000Z",
          ...attributes,
        },
      },
    };
  }

  it("recomputes the total from its components", async () => {
    const event = await lemonSqueezy().verifyWebhook(
      signed(invoicePayload({ tax: 1_110, total: 12_210 })),
    );
    expect(event.invoice?.subtotalMinor).toBe(11_100n);
    expect(event.invoice?.taxMinor).toBe(1_110n);
    expect(event.invoice?.totalMinor).toBe(12_210n);
    expect(event.invoice?.currency).toBe("USD");
    expect(event.invoice?.status).toBe("PAID");
  });

  it("refuses an invoice whose parts do not add up to the stated total", async () => {
    await expect(
      lemonSqueezy().verifyWebhook(signed(invoicePayload({ tax: 1_110, total: 99_999 }))),
    ).rejects.toMatchObject({ code: "PAYLOAD_INVALID" });
  });

  it("reads a payment event as an invoice and not as a subscription", async () => {
    // Regression: `subscription_payment_success` shares the `subscription_`
    // prefix but carries a subscription-invoice whose status is "paid". Routing
    // it by event name rejected every successful payment as an unknown
    // subscription status, which would have broken the entire payment pipeline.
    const event = await lemonSqueezy().verifyWebhook(signed(invoicePayload({})));
    expect(event.subscription).toBeNull();
    expect(event.invoice).not.toBeNull();
    expect(event.recognized).toBe(true);
  });

  it("marks a refunded payment as refunded", async () => {
    const event = await lemonSqueezy().verifyWebhook(
      signed(invoicePayload({ refunded_at: "2026-08-12T10:00:00.000Z" })),
    );
    expect(event.invoice?.status).toBe("REFUNDED");
  });
});

describe("manual invoice channel", () => {
  const manual = new ManualInvoiceBillingProvider({
    instructionsBaseUrl: "https://app.buildwatch.test/company-signup",
    now: () => NOW,
  });

  const price: BillingProviderPriceRef = {
    planId: "plan-1",
    planCode: "starter",
    planVersion: 1,
    interval: "MONTH",
    currency: "MNT",
    unitAmountMinor: 39_000_000n,
    provider: "MANUAL_INVOICE",
    environment: "sandbox",
    externalProductId: "contract",
    externalPriceId: "starter-month",
  };

  it("cannot be used to activate a tenant through a forged webhook", async () => {
    await expect(
      manual.verifyWebhook({ rawBody: Buffer.from("{}"), headers: {}, receivedAt: NOW }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
  });

  it("refuses every operation that would imply an external authority", async () => {
    await expect(
      manual.createCustomerPortal({
        providerSubscriptionId: "s1",
        providerCustomerId: null,
        correlationId: "c1",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    await expect(manual.getSubscription("s1")).rejects.toMatchObject({
      code: "UNSUPPORTED_OPERATION",
    });
    await expect(manual.cancelAtPeriodEnd("s1")).rejects.toMatchObject({
      code: "UNSUPPORTED_OPERATION",
    });
  });

  it("issues one stable instructions link per signup intent", async () => {
    const first = await manual.createCheckout({
      signupIntentId: "intent-9",
      price,
      customerEmail: "admin@company.mn",
      customerName: "Админ",
      companyName: "Компани",
      successUrl: "https://app.buildwatch.test/checkout/success",
      correlationId: "c1",
    });
    const second = await manual.createCheckout({
      signupIntentId: "intent-9",
      price,
      customerEmail: "admin@company.mn",
      customerName: "Админ",
      companyName: "Компани",
      successUrl: "https://app.buildwatch.test/checkout/success",
      correlationId: "c2",
    });
    expect(first.checkoutId).toBe("manual_intent-9");
    expect(second.checkoutId).toBe(first.checkoutId);
    expect(first.url).toBe("https://app.buildwatch.test/company-signup/intent-9");
  });
});

describe("checkout service", () => {
  const starterPrice: BillingProviderPriceRef = {
    planId: "plan-starter-month",
    planCode: "starter",
    planVersion: 1,
    interval: "MONTH",
    currency: "MNT",
    unitAmountMinor: 39_000_000n,
    provider: "LEMON_SQUEEZY",
    environment: "sandbox",
    externalProductId: "111",
    externalPriceId: "222",
  };

  class StubResolver implements BillingPriceResolver {
    calls: unknown[] = [];
    async resolvePublicPrice(input: {
      planCode: string;
      interval: string;
    }): Promise<BillingProviderPriceRef> {
      this.calls.push(input);
      if (input.planCode !== "starter") {
        throw new BillingProviderError(
          "PRICE_NOT_ALLOWED",
          "No purchasable price is configured for the requested plan",
        );
      }
      return starterPrice;
    }
    async resolveByExternalPriceId(): Promise<BillingProviderPriceRef | null> {
      return starterPrice;
    }
  }

  class MemoryIdempotency implements CheckoutIdempotencyStore {
    readonly records = new Map<string, CheckoutIdempotencyRecord>();
    async find(signupIntentId: string) {
      return this.records.get(signupIntentId) ?? null;
    }
    async save(record: CheckoutIdempotencyRecord) {
      this.records.set(record.signupIntentId, record);
    }
  }

  function config(overrides: Partial<BillingConfig> = {}): BillingConfig {
    return billingConfigSchema.parse({
      nodeEnv: "test",
      provider: "LEMON_SQUEEZY",
      environment: "sandbox",
      lemonSqueezy: {
        apiKey: API_KEY,
        storeId: "42",
        webhookSecret: WEBHOOK_SECRET,
        apiBaseUrl: "https://api.lemonsqueezy.test",
      },
      manualInvoiceEnabled: true,
      returnUrlAllowlist: ["https://app.buildwatch.test"],
      requestTimeoutMs: 5_000,
      ...overrides,
    });
  }

  function serviceWith(fetchCalls: unknown[] = []) {
    const fetchImpl = (async (url: unknown, init: unknown) => {
      fetchCalls.push({ url, init });
      return new Response(
        JSON.stringify({
          data: { id: "chk-1", attributes: { url: "https://pay.lemonsqueezy.test/chk-1" } },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const settings = config();
    const providers = createBillingProviders({
      config: settings,
      manualInstructionsBaseUrl: "https://app.buildwatch.test/company-signup",
      now: () => NOW,
      fetchImpl,
    });
    const idempotency = new MemoryIdempotency();
    const resolver = new StubResolver();
    const service = new BillingCheckoutService({
      config: settings,
      providers,
      priceResolver: resolver,
      idempotency,
      now: () => NOW,
    });
    return { service, idempotency, resolver, fetchCalls };
  }

  const request = {
    signupIntentId: "intent-1",
    planCode: "starter",
    interval: "MONTH" as const,
    customerEmail: "admin@company.mn",
    customerName: "Админ",
    companyName: "Компани",
    successUrl: "https://app.buildwatch.test/checkout/success",
    correlationId: "corr-1",
  };

  it("sends the server-resolved variant, never a client-supplied price", async () => {
    const calls: unknown[] = [];
    const { service } = serviceWith(calls);
    const result = await service.createCheckout(request);

    expect(result.url).toBe("https://pay.lemonsqueezy.test/chk-1");
    const body = JSON.parse((calls[0] as { init: { body: string } }).init.body);
    expect(body.data.relationships.variant.data.id).toBe("222");
    expect(body.data.attributes.checkout_data.custom.signup_intent_id).toBe("intent-1");
    // Nothing resembling an amount is ever sent by BuildWatch.
    expect(JSON.stringify(body)).not.toContain("39000000");
  });

  it("returns the open checkout instead of minting a second one", async () => {
    const calls: unknown[] = [];
    const { service } = serviceWith(calls);
    const first = await service.createCheckout(request);
    const second = await service.createCheckout(request);
    expect(second.checkoutId).toBe(first.checkoutId);
    expect(calls).toHaveLength(1);
  });

  it("creates a fresh checkout once the previous one expired", async () => {
    const calls: unknown[] = [];
    const { service, idempotency } = serviceWith(calls);
    await idempotency.save({
      signupIntentId: "intent-1",
      provider: "LEMON_SQUEEZY",
      checkoutId: "chk-old",
      url: "https://pay.lemonsqueezy.test/chk-old",
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const result = await service.createCheckout(request);
    expect(result.checkoutId).toBe("chk-1");
    expect(calls).toHaveLength(1);
  });

  it("refuses a plan that is not publicly purchasable", async () => {
    const { service } = serviceWith();
    await expect(
      service.createCheckout({ ...request, planCode: "enterprise" }),
    ).rejects.toMatchObject({ code: "PRICE_NOT_ALLOWED" });
  });

  it("refuses a return URL outside the allowlist before calling the provider", async () => {
    const calls: unknown[] = [];
    const { service } = serviceWith(calls);
    await expect(
      service.createCheckout({ ...request, successUrl: "https://evil.test/checkout/success" }),
    ).rejects.toMatchObject({ code: "PAYLOAD_INVALID" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a channel that is not configured", async () => {
    const { service } = serviceWith();
    await expect(service.createCheckout({ ...request, provider: "PADDLE" })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
  });
});

describe("return URL allowlist", () => {
  const allowlist = ["https://app.buildwatch.test/checkout"];

  it("accepts an exact origin and path prefix", () => {
    expect(assertAllowedReturnUrl("https://app.buildwatch.test/checkout/success", allowlist)).toBe(
      "https://app.buildwatch.test/checkout/success",
    );
  });

  it("refuses every open-redirect shape", () => {
    const attempts = [
      "https://evil.test/checkout",
      "https://app.buildwatch.test.evil.test/checkout",
      "http://app.buildwatch.test/checkout",
      "https://user:pass@app.buildwatch.test/checkout",
      "https://app.buildwatch.test/checkout/../admin",
      "javascript:alert(1)",
      "//app.buildwatch.test/checkout",
      "https://app.buildwatch.test/checkout-other",
    ];
    for (const attempt of attempts) {
      expect(() => assertAllowedReturnUrl(attempt, allowlist)).toThrow(BillingProviderError);
    }
  });
});

describe("billing configuration", () => {
  const base = {
    BILLING_PROVIDER: "LEMON_SQUEEZY",
    LEMON_SQUEEZY_API_KEY: API_KEY,
    LEMON_SQUEEZY_STORE_ID: "42",
    LEMON_SQUEEZY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    BILLING_RETURN_URL_ALLOWLIST: "https://app.buildwatch.test",
  };

  it("defaults to a sandbox outside production", () => {
    const resolved = resolveBillingConfig({
      NODE_ENV: "development",
      ...base,
    } as NodeJS.ProcessEnv);
    expect(resolved.environment).toBe("sandbox");
    expect(resolved.manualInvoiceEnabled).toBe(false);
  });

  it("keeps browser redirects on the frontend origin, not the API listener", () => {
    const resolved = resolveBillingConfig({
      NODE_ENV: "development",
      BILLING_PROVIDER: "MANUAL_INVOICE",
    } as NodeJS.ProcessEnv);
    expect(resolveBillingPublicAppBaseUrl(resolved, {} as NodeJS.ProcessEnv)).toBe(
      "http://127.0.0.1:4173",
    );
  });

  it("accepts an explicit public app URL only when the return allowlist permits it", () => {
    const resolved = resolveBillingConfig({
      NODE_ENV: "development",
      BILLING_PROVIDER: "MANUAL_INVOICE",
      BILLING_RETURN_URL_ALLOWLIST: "https://app.buildwatch.test",
    } as NodeJS.ProcessEnv);
    expect(
      resolveBillingPublicAppBaseUrl(resolved, {
        BUILDWATCH_PUBLIC_BASE_URL: "https://app.buildwatch.test",
      } as NodeJS.ProcessEnv),
    ).toBe("https://app.buildwatch.test");
    expect(() =>
      resolveBillingPublicAppBaseUrl(resolved, {
        BUILDWATCH_PUBLIC_BASE_URL: "https://evil.example",
      } as NodeJS.ProcessEnv),
    ).toThrow(/allowlist/);
  });

  it("refuses to run production traffic against a sandbox", () => {
    expect(() =>
      resolveBillingConfig({
        NODE_ENV: "production",
        BILLING_ENVIRONMENT: "sandbox",
        ...base,
      } as NodeJS.ProcessEnv),
    ).toThrow(/live billing environment/);
  });

  it("refuses plaintext return URLs in production", () => {
    expect(() =>
      resolveBillingConfig({
        NODE_ENV: "production",
        BILLING_ENVIRONMENT: "live",
        ...base,
        BILLING_RETURN_URL_ALLOWLIST: "http://app.buildwatch.test",
      } as NodeJS.ProcessEnv),
    ).toThrow(/HTTPS/);
  });

  it("refuses a provider that has no adapter yet", () => {
    expect(() =>
      resolveBillingConfig({
        NODE_ENV: "development",
        ...base,
        BILLING_PROVIDER: "PADDLE",
      } as NodeJS.ProcessEnv),
    ).toThrow(/Paddle is not implemented/);
  });

  it("refuses Lemon Squeezy without its credentials", () => {
    expect(() =>
      resolveBillingConfig({
        NODE_ENV: "development",
        BILLING_PROVIDER: "LEMON_SQUEEZY",
        BILLING_RETURN_URL_ALLOWLIST: "https://app.buildwatch.test",
      } as NodeJS.ProcessEnv),
    ).toThrow(/required/);
  });

  it("falls back to the invoice channel on a machine with no billing secrets", () => {
    // A developer without provider credentials must still be able to boot the
    // API; only production insists on the card provider.
    const resolved = resolveBillingConfig({
      NODE_ENV: "development",
      BILLING_RETURN_URL_ALLOWLIST: "https://app.buildwatch.test",
    } as NodeJS.ProcessEnv);
    expect(resolved.provider).toBe("MANUAL_INVOICE");
    expect(resolved.lemonSqueezy).toBeNull();
  });

  it("still demands the card provider in production", () => {
    expect(() =>
      resolveBillingConfig({
        NODE_ENV: "production",
        BILLING_ENVIRONMENT: "live",
        BILLING_RETURN_URL_ALLOWLIST: "https://app.buildwatch.test",
      } as NodeJS.ProcessEnv),
    ).toThrow(/required/);
  });
});

describe("secret redaction", () => {
  it("masks credentials and digests before they can reach a log", () => {
    const line = `authorization: Bearer ${API_KEY} signature=${"a".repeat(64)}`;
    const redacted = redactBillingSecrets(line);
    expect(redacted).not.toContain(API_KEY);
    expect(redacted).not.toContain("a".repeat(64));
    expect(redacted).toContain("[redacted]");
  });
});
