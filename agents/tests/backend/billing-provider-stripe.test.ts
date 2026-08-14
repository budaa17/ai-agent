import Stripe from "stripe";
import {
  BillingProviderError,
  StripeBillingProvider,
  resolveBillingConfig,
} from "../../src/backend/index.js";

const stripeSecretKey = `sk_test_${"a".repeat(32)}`;
const webhookSecret = `whsec_${"b".repeat(32)}`;

function provider() {
  return new StripeBillingProvider({
    config: {
      secretKey: stripeSecretKey,
      webhookSecret,
      portalConfigurationId: null,
      automaticTaxEnabled: false,
    },
  });
}

function signedEvent(event: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: rawBody.toString("utf8"),
    secret: webhookSecret,
    timestamp: Math.floor(Date.now() / 1_000),
  });
  return { rawBody, signature };
}

describe("Stripe billing provider", () => {
  it("creates hosted subscription checkout from only the server-resolved price", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      expires_at: 1_786_424_800,
    });
    const stripe = {
      checkout: { sessions: { create } },
    } as unknown as Stripe;
    const adapter = new StripeBillingProvider({
      config: {
        secretKey: stripeSecretKey,
        webhookSecret,
        portalConfigurationId: null,
        automaticTaxEnabled: false,
      },
      client: stripe,
    });

    const result = await adapter.createCheckout({
      signupIntentId: "signup-1",
      price: {
        planId: "plan-1",
        planCode: "starter",
        planVersion: 1,
        interval: "MONTH",
        currency: "MNT",
        unitAmountMinor: 39_000_000n,
        provider: "STRIPE",
        environment: "sandbox",
        externalProductId: "prod_1",
        externalPriceId: "price_1",
      },
      customerEmail: "buyer@example.com",
      customerName: "Buyer",
      companyName: "Example LLC",
      successUrl: "http://127.0.0.1:4173/checkout/success",
      correlationId: "corr-1",
    });

    expect(result).toMatchObject({ provider: "STRIPE", checkoutId: "cs_test_1" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        line_items: [{ price: "price_1", quantity: 1 }],
        customer_email: "buyer@example.com",
        client_reference_id: "signup-1",
        success_url:
          "http://127.0.0.1:4173/checkout/success?signup=signup-1&checkout=%7BCHECKOUT_SESSION_ID%7D",
      }),
      { idempotencyKey: "buildwatch-checkout-signup-1" },
    );
  });

  it("verifies raw Stripe bytes and normalizes a paid subscription safely", async () => {
    const { rawBody, signature } = signedEvent({
      id: "evt_paid_1",
      object: "event",
      api_version: "2026-07-29.dahlia",
      created: 1_786_421_200,
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          object: "subscription",
          status: "active",
          customer: "cus_1",
          cancel_at_period_end: false,
          canceled_at: null,
          metadata: { signup_intent_id: "signup-1" },
          items: {
            object: "list",
            data: [
              {
                current_period_start: 1_786_421_200,
                current_period_end: 1_789_013_200,
                price: { id: "price_1", product: "prod_1" },
              },
            ],
          },
        },
      },
    });
    const event = await provider().verifyWebhook({
      rawBody,
      headers: { "stripe-signature": signature },
      receivedAt: new Date("2026-08-11T04:00:00Z"),
    });
    expect(event).toMatchObject({
      provider: "STRIPE",
      providerEventId: "evt_paid_1",
      eventType: "customer.subscription.updated",
      signupIntentId: "signup-1",
      recognized: true,
      subscription: {
        providerSubscriptionId: "sub_1",
        providerCustomerId: "cus_1",
        status: "ACTIVE",
        externalPriceId: "price_1",
        externalProductId: "prod_1",
      },
    });
  });

  it("retrieves and binds the exact paid Checkout Session before exposing a subscription", async () => {
    const checkoutSession = {
      id: "cs_test_paid",
      object: "checkout.session",
      livemode: false,
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      metadata: { signup_intent_id: "signup-1", plan_id: "plan-1" },
      client_reference_id: "signup-1",
      customer: "cus_1",
      subscription: "sub_1",
      invoice: "in_1",
    };
    const retrieveSession = vi.fn().mockResolvedValue(checkoutSession);
    const retrieveSubscription = vi.fn().mockResolvedValue({
      id: "sub_1",
      object: "subscription",
      status: "active",
      customer: "cus_1",
      cancel_at_period_end: false,
      canceled_at: null,
      items: {
        data: [
          {
            current_period_start: 1_786_421_200,
            current_period_end: 1_789_013_200,
            price: { id: "price_1", product: "prod_1" },
          },
        ],
      },
    });
    const retrieveInvoice = vi.fn().mockResolvedValue({
      id: "in_1",
      object: "invoice",
      status: "paid",
      currency: "mnt",
      subtotal: 39_000_000,
      total: 39_000_000,
      total_taxes: [],
      parent: { subscription_details: { subscription: "sub_1" } },
      status_transitions: { paid_at: 1_786_421_201 },
      due_date: null,
      hosted_invoice_url: "https://invoice.stripe.test/in_1",
      number: "INV-1",
    });
    const stripe = {
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          id: "evt_checkout_1",
          type: "checkout.session.completed",
          created: 1_786_421_200,
          livemode: false,
          data: { object: checkoutSession },
        }),
      },
      checkout: { sessions: { retrieve: retrieveSession } },
      subscriptions: { retrieve: retrieveSubscription },
      invoices: { retrieve: retrieveInvoice },
    } as unknown as Stripe;
    const adapter = new StripeBillingProvider({
      config: {
        secretKey: stripeSecretKey,
        webhookSecret,
        portalConfigurationId: null,
        automaticTaxEnabled: false,
      },
      client: stripe,
    });

    const event = await adapter.verifyWebhook({
      rawBody: Buffer.from("signed"),
      headers: { "stripe-signature": "verified-by-mock" },
      receivedAt: new Date("2026-08-11T04:00:00Z"),
    });

    expect(retrieveSession).toHaveBeenCalledWith("cs_test_paid");
    expect(retrieveSubscription).toHaveBeenCalledWith("sub_1");
    expect(retrieveInvoice).toHaveBeenCalledWith("in_1");
    expect(event).toMatchObject({
      signupIntentId: "signup-1",
      providerCheckoutId: "cs_test_paid",
      subscription: {
        providerSubscriptionId: "sub_1",
        providerCustomerId: "cus_1",
        status: "ACTIVE",
        externalPriceId: "price_1",
        externalProductId: "prod_1",
      },
      invoice: {
        providerInvoiceId: "in_1",
        providerSubscriptionId: "sub_1",
        status: "PAID",
        currency: "MNT",
        subtotalMinor: 39_000_000n,
        totalMinor: 39_000_000n,
      },
    });
  });

  it("refuses a completed Checkout Session that is not paid", async () => {
    const session = {
      id: "cs_test_unpaid",
      object: "checkout.session",
      livemode: false,
      mode: "subscription",
      status: "complete",
      payment_status: "unpaid",
      metadata: { signup_intent_id: "signup-1" },
      client_reference_id: "signup-1",
      customer: "cus_1",
      subscription: "sub_1",
    };
    const stripe = {
      webhooks: {
        constructEvent: vi.fn().mockReturnValue({
          id: "evt_checkout_unpaid",
          type: "checkout.session.completed",
          created: 1_786_421_200,
          livemode: false,
          data: { object: session },
        }),
      },
      checkout: { sessions: { retrieve: vi.fn().mockResolvedValue(session) } },
    } as unknown as Stripe;
    const adapter = new StripeBillingProvider({
      config: {
        secretKey: stripeSecretKey,
        webhookSecret,
        portalConfigurationId: null,
        automaticTaxEnabled: false,
      },
      client: stripe,
    });

    await expect(
      adapter.verifyWebhook({
        rawBody: Buffer.from("signed"),
        headers: { "stripe-signature": "verified-by-mock" },
        receivedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_INVALID" });
  });

  it("rejects missing and forged Stripe signatures without parsing payload", async () => {
    const rawBody = Buffer.from('{"id":"evt_fake"}');
    await expect(
      provider().verifyWebhook({ rawBody, headers: {}, receivedAt: new Date() }),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    await expect(
      provider().verifyWebhook({
        rawBody,
        headers: { "stripe-signature": "t=1,v1=forged" },
        receivedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(BillingProviderError);
  });

  it("rejects a signed live event at the sandbox boundary", async () => {
    const { rawBody, signature } = signedEvent({
      id: "evt_wrong_mode",
      object: "event",
      api_version: "2026-07-29.dahlia",
      created: Math.floor(Date.now() / 1_000),
      livemode: true,
      pending_webhooks: 1,
      request: null,
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", object: "subscription" } },
    });
    await expect(
      provider().verifyWebhook({
        rawBody,
        headers: { "stripe-signature": signature },
        receivedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_INVALID" });
  });
});

describe("Stripe billing configuration", () => {
  const base = {
    BILLING_PROVIDER: "STRIPE",
    BILLING_RETURN_URL_ALLOWLIST: "https://app.buildwatch.test",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  };

  it("selects Stripe in sandbox with test credentials", () => {
    const config = resolveBillingConfig({
      NODE_ENV: "development",
      ...base,
      STRIPE_SECRET_KEY: stripeSecretKey,
    } as NodeJS.ProcessEnv);
    expect(config.provider).toBe("STRIPE");
    expect(config.environment).toBe("sandbox");
    expect(config.deploymentStage).toBe("development");
    expect(config.manualInvoiceEnabled).toBe(false);
  });

  it("runs a hardened production Node runtime against Stripe sandbox only in explicit staging", () => {
    const config = resolveBillingConfig({
      NODE_ENV: "production",
      BUILDWATCH_DEPLOYMENT_STAGE: "staging",
      BILLING_ENVIRONMENT: "sandbox",
      ...base,
      STRIPE_SECRET_KEY: stripeSecretKey,
    } as NodeJS.ProcessEnv);
    expect(config.nodeEnv).toBe("production");
    expect(config.deploymentStage).toBe("staging");
    expect(config.environment).toBe("sandbox");

    expect(() =>
      resolveBillingConfig({
        NODE_ENV: "production",
        BUILDWATCH_DEPLOYMENT_STAGE: "staging",
        BILLING_ENVIRONMENT: "live",
        ...base,
        STRIPE_SECRET_KEY: `sk_live_${"a".repeat(32)}`,
      } as NodeJS.ProcessEnv),
    ).toThrow(/Staging must run against the sandbox/);
  });

  it("allows sandbox checkout configuration before a webhook endpoint exists", () => {
    const config = resolveBillingConfig({
      NODE_ENV: "development",
      BILLING_PROVIDER: "STRIPE",
      BILLING_RETURN_URL_ALLOWLIST: "http://127.0.0.1:4173",
      STRIPE_SECRET_KEY: stripeSecretKey,
    } as NodeJS.ProcessEnv);
    expect(config.stripe).toMatchObject({ secretKey: stripeSecretKey, webhookSecret: null });
  });

  it("treats the documented whsec placeholder as not configured", () => {
    const config = resolveBillingConfig({
      NODE_ENV: "development",
      BILLING_PROVIDER: "STRIPE",
      BILLING_RETURN_URL_ALLOWLIST: "http://127.0.0.1:4173",
      STRIPE_SECRET_KEY: stripeSecretKey,
      STRIPE_WEBHOOK_SECRET: "whsec_...",
    } as NodeJS.ProcessEnv);
    expect(config.stripe?.webhookSecret).toBeNull();
  });

  it("refuses a live key in sandbox and a test key in production", () => {
    expect(() =>
      resolveBillingConfig({
        NODE_ENV: "development",
        ...base,
        STRIPE_SECRET_KEY: `sk_live_${"a".repeat(32)}`,
      } as NodeJS.ProcessEnv),
    ).toThrow(/Sandbox billing cannot use a Stripe live key/);
    expect(() =>
      resolveBillingConfig({
        NODE_ENV: "production",
        BILLING_ENVIRONMENT: "live",
        ...base,
        STRIPE_SECRET_KEY: stripeSecretKey,
      } as NodeJS.ProcessEnv),
    ).toThrow(/Stripe live key/);
  });
});
