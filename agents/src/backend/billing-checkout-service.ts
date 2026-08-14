import type { PrismaClient } from "@prisma/client";
import type { BillingInterval, BillingProviderKind } from "./billing-contracts.js";
import { assertAllowedReturnUrl, type BillingConfig } from "./billing-config.js";
import type { BillingPriceResolver } from "./billing-price-resolver.js";
import {
  BillingProviderError,
  type BillingProvider,
  type CheckoutResult,
} from "./billing-provider.js";
import { LemonSqueezyBillingProvider } from "./billing-provider-lemon-squeezy.js";
import { ManualInvoiceBillingProvider } from "./billing-provider-manual.js";
import { StripeBillingProvider } from "./billing-provider-stripe.js";

/**
 * Provider-neutral checkout entry point (landing-page-roadmap.md §17, §20.2).
 *
 * The caller supplies who is buying and which plan they picked. It never
 * supplies an amount, a currency or a provider price: those are resolved here,
 * from BuildWatch's own allowlist, so the only thing a tampered request can
 * change is which published plan it names.
 */

export interface CheckoutIdempotencyRecord {
  readonly signupIntentId: string;
  readonly provider: BillingProviderKind;
  readonly checkoutId: string;
  readonly url: string;
  readonly expiresAt: Date | null;
}

/**
 * Persistence for "this signup intent already has a checkout". Phase 5 backs it
 * with `CompanySignupIntent.providerCheckoutId`; the port keeps the rule
 * testable and keeps the provider from being called twice for one buyer.
 */
export interface CheckoutIdempotencyStore {
  find(signupIntentId: string): Promise<CheckoutIdempotencyRecord | null>;
  save(record: CheckoutIdempotencyRecord): Promise<void>;
}

export interface CreateCheckoutRequest {
  readonly signupIntentId: string;
  readonly planCode: string;
  readonly interval: BillingInterval;
  readonly customerEmail: string;
  readonly customerName: string;
  readonly companyName: string;
  readonly successUrl: string;
  readonly correlationId: string;
  /** Optional channel override; defaults to the configured provider. */
  readonly provider?: BillingProviderKind;
}

export interface BillingCheckoutServiceOptions {
  readonly config: BillingConfig;
  readonly providers: ReadonlyMap<BillingProviderKind, BillingProvider>;
  readonly priceResolver: BillingPriceResolver;
  readonly idempotency: CheckoutIdempotencyStore;
  readonly now?: () => Date;
}

export class BillingCheckoutService {
  readonly #config: BillingConfig;
  readonly #providers: ReadonlyMap<BillingProviderKind, BillingProvider>;
  readonly #priceResolver: BillingPriceResolver;
  readonly #idempotency: CheckoutIdempotencyStore;
  readonly #now: () => Date;

  constructor(options: BillingCheckoutServiceOptions) {
    this.#config = options.config;
    this.#providers = options.providers;
    this.#priceResolver = options.priceResolver;
    this.#idempotency = options.idempotency;
    this.#now = options.now ?? (() => new Date());
  }

  provider(kind: BillingProviderKind): BillingProvider {
    const provider = this.#providers.get(kind);
    if (provider === undefined) {
      throw new BillingProviderError(
        "NOT_CONFIGURED",
        "The requested billing channel is not enabled",
        kind,
      );
    }
    return provider;
  }

  async createCheckout(request: CreateCheckoutRequest): Promise<CheckoutResult> {
    const kind = request.provider ?? this.#config.provider;
    const provider = this.provider(kind);

    // Pressing "pay" twice must reuse the open checkout rather than mint a second
    // payment surface for the same company.
    const existing = await this.#idempotency.find(request.signupIntentId);
    if (existing !== null && existing.provider === kind && !this.#hasExpired(existing.expiresAt)) {
      return {
        provider: existing.provider,
        checkoutId: existing.checkoutId,
        url: existing.url,
        expiresAt: existing.expiresAt,
      };
    }

    const successUrl = assertAllowedReturnUrl(request.successUrl, this.#config.returnUrlAllowlist);
    const price = await this.#priceResolver.resolvePublicPrice({
      planCode: request.planCode,
      interval: request.interval,
      provider: kind,
      environment: this.#config.environment,
    });

    const result = await provider.createCheckout({
      signupIntentId: request.signupIntentId,
      price,
      customerEmail: request.customerEmail,
      customerName: request.customerName,
      companyName: request.companyName,
      successUrl,
      correlationId: request.correlationId,
    });

    await this.#idempotency.save({
      signupIntentId: request.signupIntentId,
      provider: result.provider,
      checkoutId: result.checkoutId,
      url: result.url,
      expiresAt: result.expiresAt,
    });
    return result;
  }

  #hasExpired(expiresAt: Date | null): boolean {
    return expiresAt !== null && expiresAt.getTime() <= this.#now().getTime();
  }
}

/**
 * Backs checkout idempotency with the signup intent row, so the guarantee
 * survives a restart and holds across every API instance.
 */
export class PrismaCheckoutIdempotencyStore implements CheckoutIdempotencyStore {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async find(signupIntentId: string): Promise<CheckoutIdempotencyRecord | null> {
    const row = await this.#client.companySignupIntent.findUnique({
      where: { id: signupIntentId },
      select: {
        provider: true,
        providerCheckoutId: true,
        providerCheckoutUrl: true,
        providerCheckoutExpiresAt: true,
      },
    });

    if (row === null || row.providerCheckoutId === null || row.providerCheckoutUrl === null) {
      return null;
    }
    return {
      signupIntentId,
      provider: row.provider,
      checkoutId: row.providerCheckoutId,
      url: row.providerCheckoutUrl,
      expiresAt: row.providerCheckoutExpiresAt,
    };
  }

  async save(record: CheckoutIdempotencyRecord): Promise<void> {
    await this.#client.companySignupIntent.update({
      where: { id: record.signupIntentId },
      data: {
        // A development intent may predate a provider cutover. Once a hosted
        // checkout is successfully minted, its provider becomes authoritative
        // for cache reuse and later webhook intent binding.
        provider: record.provider,
        providerCheckoutId: record.checkoutId,
        providerCheckoutUrl: record.url,
        providerCheckoutExpiresAt: record.expiresAt,
      },
    });
  }
}

export interface BillingProviderRegistryOptions {
  readonly config: BillingConfig;
  /** Base URL of the BuildWatch page that explains bank transfer details. */
  readonly manualInstructionsBaseUrl: string;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Builds exactly the channels the configuration enables. A channel that is not
 * configured is absent rather than present-and-broken, so a missing credential
 * surfaces as `NOT_CONFIGURED` at the call site instead of a runtime crash deep
 * inside a payment flow.
 */
export function createBillingProviders(
  options: BillingProviderRegistryOptions,
): ReadonlyMap<BillingProviderKind, BillingProvider> {
  const providers = new Map<BillingProviderKind, BillingProvider>();
  const { config } = options;

  if (config.stripe !== null) {
    providers.set(
      "STRIPE",
      new StripeBillingProvider({
        config: config.stripe,
        now: options.now,
        expectedLivemode: config.environment === "live",
      }),
    );
  }

  if (config.lemonSqueezy !== null) {
    providers.set(
      "LEMON_SQUEEZY",
      new LemonSqueezyBillingProvider({
        config: config.lemonSqueezy,
        requestTimeoutMs: config.requestTimeoutMs,
        now: options.now,
        fetchImpl: options.fetchImpl,
      }),
    );
  }
  if (config.manualInvoiceEnabled) {
    providers.set(
      "MANUAL_INVOICE",
      new ManualInvoiceBillingProvider({
        instructionsBaseUrl: options.manualInstructionsBaseUrl,
        now: options.now,
      }),
    );
  }
  return providers;
}
