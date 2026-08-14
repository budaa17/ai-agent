import {
  BillingProviderError,
  type BillingProvider,
  type CheckoutResult,
  type CreateCheckoutInput,
  type CustomerPortalInput,
  type PortalResult,
  type ProviderSubscription,
  type RawWebhookInput,
  type VerifiedBillingEvent,
} from "./billing-provider.js";

/**
 * Domestic bank transfer channel (landing-page-roadmap.md §8.1, §22).
 *
 * Mongolian companies settle software by contract and bank transfer against a
 * VAT invoice, and the card provider is not guaranteed to work for every buyer,
 * so this channel is the required fallback rather than a nice-to-have.
 *
 * Nothing here is automated. There is no third party to sign a webhook and no
 * remote state to read: a Platform Operator confirms payment through an audited
 * action. Every method that would imply an external authority therefore refuses
 * explicitly instead of returning something harmless-looking.
 */

export interface ManualInvoiceProviderOptions {
  /** Page that explains the bank details for a pending signup intent. */
  readonly instructionsBaseUrl: string;
  readonly now?: () => Date;
  /** How long the quoted invoice stays valid before the intent expires. */
  readonly offerValidityMs?: number;
}

const DEFAULT_OFFER_VALIDITY_MS = 14 * 24 * 60 * 60 * 1_000;

export class ManualInvoiceBillingProvider implements BillingProvider {
  readonly kind = "MANUAL_INVOICE" as const;
  readonly #instructionsBaseUrl: string;
  readonly #now: () => Date;
  readonly #offerValidityMs: number;

  constructor(options: ManualInvoiceProviderOptions) {
    this.#instructionsBaseUrl = options.instructionsBaseUrl.replace(/\/+$/, "");
    this.#now = options.now ?? (() => new Date());
    this.#offerValidityMs = options.offerValidityMs ?? DEFAULT_OFFER_VALIDITY_MS;
  }

  /**
   * Produces a BuildWatch-hosted instructions page rather than a payment page.
   * The identifier is derived from the signup intent, so pressing the button
   * twice yields the same checkout instead of a second invoice.
   */
  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
    if (input.price.provider !== this.kind) {
      throw new BillingProviderError(
        "PRICE_NOT_ALLOWED",
        "Resolved price belongs to another provider",
        this.kind,
      );
    }
    if (input.price.unitAmountMinor === null) {
      throw new BillingProviderError(
        "PRICE_NOT_ALLOWED",
        "A manual invoice needs a quoted amount",
        this.kind,
      );
    }
    return {
      provider: this.kind,
      checkoutId: `manual_${input.signupIntentId}`,
      url: `${this.#instructionsBaseUrl}/${encodeURIComponent(input.signupIntentId)}`,
      expiresAt: new Date(this.#now().getTime() + this.#offerValidityMs),
    };
  }

  /**
   * Refuses rather than returning an empty event.
   *
   * This is the security-relevant method of the whole adapter: an unsigned POST
   * to `/webhooks/billing/MANUAL_INVOICE` must never be able to activate a
   * tenant. Payment for this channel is only ever confirmed by an audited
   * operator action (§22, §24.1).
   */
  async verifyWebhook(_input: RawWebhookInput): Promise<VerifiedBillingEvent> {
    throw new BillingProviderError(
      "UNSUPPORTED_OPERATION",
      "The manual invoice channel has no webhook; payment is confirmed by an audited operator action",
      this.kind,
    );
  }

  async createCustomerPortal(_input: CustomerPortalInput): Promise<PortalResult> {
    throw new BillingProviderError(
      "UNSUPPORTED_OPERATION",
      "Manual invoice customers manage billing through their Company Admin page",
      this.kind,
    );
  }

  async getSubscription(_externalId: string): Promise<ProviderSubscription> {
    throw new BillingProviderError(
      "UNSUPPORTED_OPERATION",
      "A manual invoice subscription has no remote state to read",
      this.kind,
    );
  }

  async cancelAtPeriodEnd(_externalId: string): Promise<void> {
    throw new BillingProviderError(
      "UNSUPPORTED_OPERATION",
      "A contract subscription is ended through the platform billing console",
      this.kind,
    );
  }
}
