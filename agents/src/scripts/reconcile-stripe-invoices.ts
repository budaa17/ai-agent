import "dotenv/config";
import Stripe from "stripe";
import { resolveBillingConfig } from "../backend/billing-config.js";
import { normalizeStripeInvoice } from "../backend/billing-provider-stripe.js";
import { prisma } from "../prisma.js";

async function main(): Promise<void> {
  const config = resolveBillingConfig(process.env);
  if (config.provider !== "STRIPE" || config.stripe === null) {
    throw new Error("Stripe billing is not configured");
  }

  const stripe = new Stripe(config.stripe.secretKey, { apiVersion: "2026-07-29.dahlia" });
  const expectedLivemode = config.environment === "live";
  const subscriptions = await prisma.tenantSubscription.findMany({
    where: { provider: "STRIPE", providerSubscriptionId: { not: null } },
    select: { id: true, tenantId: true, providerSubscriptionId: true },
  });

  let reconciled = 0;
  for (const subscription of subscriptions) {
    const providerSubscriptionId = subscription.providerSubscriptionId;
    if (providerSubscriptionId === null) continue;

    const invoices = await stripe.invoices.list({
      subscription: providerSubscriptionId,
      limit: 100,
    });
    for (const stripeInvoice of invoices.data) {
      if (stripeInvoice.livemode !== expectedLivemode) {
        throw new Error("Stripe invoice environment mismatch");
      }
      const invoice = normalizeStripeInvoice(stripeInvoice);
      if (invoice.providerSubscriptionId !== providerSubscriptionId) {
        throw new Error("Stripe invoice subscription binding mismatch");
      }
      if (invoice.subtotalMinor + invoice.taxMinor !== invoice.totalMinor) {
        throw new Error("Stripe invoice total does not match the local money invariant");
      }

      await prisma.billingInvoice.upsert({
        where: {
          provider_providerInvoiceId: {
            provider: "STRIPE",
            providerInvoiceId: invoice.providerInvoiceId,
          },
        },
        create: {
          tenantId: subscription.tenantId,
          subscriptionId: subscription.id,
          provider: "STRIPE",
          providerInvoiceId: invoice.providerInvoiceId,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          currency: invoice.currency,
          subtotalMinor: invoice.subtotalMinor,
          taxMinor: invoice.taxMinor,
          totalMinor: invoice.totalMinor,
          paidAt: invoice.paidAt,
          dueAt: invoice.dueAt,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
        },
        update: {
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          currency: invoice.currency,
          subtotalMinor: invoice.subtotalMinor,
          taxMinor: invoice.taxMinor,
          totalMinor: invoice.totalMinor,
          paidAt: invoice.paidAt,
          dueAt: invoice.dueAt,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
        },
      });
      reconciled += 1;
    }
  }

  process.stdout.write(
    `Reconciled ${reconciled} Stripe invoice(s) across ${subscriptions.length} subscription(s).\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Stripe invoice reconciliation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
