import "dotenv/config";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "../prisma.js";
import { billingConfigSchema } from "../backend/billing-config.js";
import {
  BillingCheckoutService,
  PrismaCheckoutIdempotencyStore,
} from "../backend/billing-checkout-service.js";
import { parseEntitlementSnapshot } from "../backend/billing-contracts.js";
import { PrismaBillingPriceResolver } from "../backend/billing-price-resolver.js";
import { LemonSqueezyBillingProvider } from "../backend/billing-provider-lemon-squeezy.js";
import { CompanySignupService } from "../backend/billing-signup-service.js";
import { BillingWebhookService } from "../backend/billing-webhook-service.js";
import { TenantAccessPolicy } from "../backend/tenant-access-policy.js";
import { PrismaTenantAccessSnapshotReader } from "../backend/tenant-access-store.js";
import { createTenantLimitReservation } from "../backend/tenant-limit-reservation.js";

/**
 * End-to-end proof of Phases 4 and 5 against a real database
 * (landing-page-roadmap.md §28 "Payment integrity", "Provisioning", "Lifecycle").
 *
 * A signed provider event is constructed locally with a test secret, so the whole
 * path — signup intent, verified email, checkout, webhook, provisioning, replay,
 * out-of-order delivery, grace and suspension — is exercised without any
 * third-party account.
 *
 * Everything it creates is namespaced and removed again in the finally block.
 */

const SUFFIX = Date.now().toString(36);
const SLUG = `smoke-lifecycle-${SUFFIX}`;
const WEBHOOK_SECRET = "buildwatch-smoke-webhook-secret-0123456789";
const API_KEY = "buildwatch-smoke-api-key-0123456789abcdef";
const ENVIRONMENT = "sandbox";
const EXTERNAL_PRICE_ID = `smoke-variant-${SUFFIX}`;
const PROVIDER_SUBSCRIPTION_ID = `smoke-sub-${SUFFIX}`;

interface Check {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

const NOW = new Date("2026-08-12T10:00:00.000Z");

/** Surfaces why a reservation batch failed, so a red check explains itself. */
function describeFirstRejection(results: readonly PromiseSettledResult<unknown>[]): string {
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  return rejected === undefined ? "no rejection recorded" : String(rejected.reason).slice(0, 200);
}

function signedRequest(body: unknown) {
  const rawBody = Buffer.from(JSON.stringify(body), "utf8");
  return {
    rawBody,
    headers: {
      "x-signature": createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex"),
    },
  };
}

function subscriptionEvent(input: {
  eventName: string;
  status: string;
  updatedAt: string;
  signupIntentId?: string;
  externalPriceId?: string;
}) {
  return {
    meta: {
      event_name: input.eventName,
      webhook_id: `${input.eventName}-${input.updatedAt}`,
      custom_data:
        input.signupIntentId === undefined ? {} : { signup_intent_id: input.signupIntentId },
    },
    data: {
      id: PROVIDER_SUBSCRIPTION_ID,
      type: "subscriptions",
      attributes: {
        status: input.status,
        customer_id: `smoke-customer-${SUFFIX}`,
        product_id: "smoke-product",
        variant_id: input.externalPriceId ?? EXTERNAL_PRICE_ID,
        renews_at: "2026-09-12T10:00:00.000Z",
        updated_at: input.updatedAt,
      },
    },
  };
}

/**
 * Removes what this smoke created.
 *
 * Audit rows are append-only by database trigger — a deliberate property of the
 * system, not an obstacle to work around — so a tenant that has been through
 * provisioning can never be fully deleted. Such a tenant is retired instead: its
 * billing children are removed, its workspace address is released for the next
 * run and its lifecycle is archived.
 */
async function cleanup(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: "smoke-lifecycle-" } },
    select: { id: true },
  });
  const tenantIds = tenants.map((tenant) => tenant.id);
  if (tenantIds.length > 0) {
    // Financial rows use ON DELETE RESTRICT, so the teardown walks the graph in
    // dependency order rather than relying on cascades.
    await prisma.project.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenantEntitlementSnapshot.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.securityToken.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.billingInvoice.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenantSubscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.billingCustomer.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });

    for (const tenantId of tenantIds) {
      try {
        await prisma.tenant.delete({ where: { id: tenantId } });
      } catch {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            slug: `retired-${tenantId}`.slice(0, 60),
            lifecycleStatus: "ARCHIVED",
            accessReason: "SMOKE_RETIRED",
          },
        });
      }
    }
  }
  await prisma.companySignupIntent.deleteMany({
    where: { desiredSlug: { startsWith: "smoke-lifecycle-" } },
  });
  await prisma.billingWebhookEvent.deleteMany({
    where: { correlationId: { startsWith: "smoke-" } },
  });
  await prisma.billingProviderPrice.deleteMany({
    where: { externalPriceId: { startsWith: "smoke-variant-" } },
  });
}

async function main() {
  const checks: Check[] = [];
  const record = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });

  try {
    await cleanup();

    const plan = await prisma.billingPlan.findFirst({
      where: { code: "starter", interval: "MONTH", public: true },
      select: { id: true },
    });
    if (plan === null) {
      throw new Error("Run `pnpm run seed:billing:plans` before this smoke");
    }
    await prisma.billingProviderPrice.create({
      data: {
        planId: plan.id,
        provider: "LEMON_SQUEEZY",
        environment: ENVIRONMENT,
        externalProductId: "smoke-product",
        externalPriceId: EXTERNAL_PRICE_ID,
      },
    });

    const config = billingConfigSchema.parse({
      nodeEnv: "test",
      provider: "LEMON_SQUEEZY",
      environment: ENVIRONMENT,
      lemonSqueezy: {
        apiKey: API_KEY,
        storeId: "1",
        webhookSecret: WEBHOOK_SECRET,
        apiBaseUrl: "https://api.lemonsqueezy.test",
      },
      manualInvoiceEnabled: true,
      returnUrlAllowlist: ["https://app.buildwatch.test"],
      requestTimeoutMs: 5_000,
    });

    let providerCalls = 0;
    const fetchImpl = (async () => {
      providerCalls += 1;
      return new Response(
        JSON.stringify({
          data: {
            id: `smoke-checkout-${SUFFIX}`,
            attributes: { url: `https://pay.lemonsqueezy.test/${SUFFIX}` },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const providers = new Map([
      [
        "LEMON_SQUEEZY" as const,
        new LemonSqueezyBillingProvider({
          config: config.lemonSqueezy!,
          requestTimeoutMs: config.requestTimeoutMs,
          now: () => NOW,
          fetchImpl,
        }),
      ],
    ]);
    const priceResolver = new PrismaBillingPriceResolver(prisma);
    const accessPolicy = new TenantAccessPolicy(new PrismaTenantAccessSnapshotReader(prisma), {
      cacheTtlMs: 0,
      now: () => NOW,
    });
    const checkout = new BillingCheckoutService({
      config,
      providers,
      priceResolver,
      idempotency: new PrismaCheckoutIdempotencyStore(prisma),
      now: () => NOW,
    });
    const signups = new CompanySignupService({
      client: prisma,
      checkout,
      provider: "LEMON_SQUEEZY",
      successUrl: "https://app.buildwatch.test/checkout/success",
      publicBaseUrl: "https://app.buildwatch.test",
      verificationSecret: "billing-lifecycle-email-verification-secret-001",
      verificationResendCooldownMs: 0,
      nodeEnv: "test",
      now: () => NOW,
    });
    const limits = createTenantLimitReservation({ policy: accessPolicy, now: () => NOW });
    const webhooks = new BillingWebhookService({
      client: prisma,
      providers,
      priceResolver,
      environment: ENVIRONMENT,
      accessPolicy,
      provisioner: signups,
      now: () => NOW,
    });

    // --- Signup -----------------------------------------------------------

    const created = await signups.createIntent({
      companyName: "Smoke Construction LLC",
      desiredSlug: SLUG,
      adminEmail: `admin@${SLUG}.test`,
      adminDisplayName: "Смоук админ",
      planCode: "starter",
      interval: "MONTH",
    });
    record(
      "a visitor creates a signup intent, not a workspace",
      created.status === "PENDING" && (await prisma.tenant.count({ where: { slug: SLUG } })) === 0,
      `intent ${created.signupIntentId}`,
    );

    const resent = await signups.resendVerificationCode(created.signupIntentId);
    let oldCodeAccepted = false;
    try {
      await signups.verifyEmail(created.signupIntentId, created.verificationCode!);
      oldCodeAccepted = true;
    } catch {
      oldCodeAccepted = false;
    }
    record(
      "resending invalidates the previous email verification code",
      !oldCodeAccepted && /^\d{6}$/u.test(resent.verificationCode ?? ""),
      oldCodeAccepted ? "old code was accepted" : "old code refused; fresh code issued",
    );

    let replayedVerification = false;
    await signups.verifyEmail(created.signupIntentId, resent.verificationCode!);
    try {
      await signups.verifyEmail(created.signupIntentId, resent.verificationCode!);
      replayedVerification = true;
    } catch {
      replayedVerification = false;
    }
    record(
      "an email verification code works exactly once",
      !replayedVerification,
      replayedVerification ? "ACCEPTED TWICE" : "second attempt refused",
    );

    const firstCheckout = await signups.createCheckout(created.signupIntentId, "smoke-1");
    const secondCheckout = await signups.createCheckout(created.signupIntentId, "smoke-2");
    record(
      "pressing pay twice reuses the open checkout",
      firstCheckout.checkoutId === secondCheckout.checkoutId && providerCalls === 1,
      `${providerCalls} provider call(s)`,
    );

    // --- Provisioning ------------------------------------------------------

    const activation = signedRequest(
      subscriptionEvent({
        eventName: "subscription_created",
        status: "active",
        updatedAt: "2026-08-12T09:30:00.000Z",
        signupIntentId: created.signupIntentId,
      }),
    );
    const activated = await webhooks.receive(
      "LEMON_SQUEEZY",
      activation.rawBody,
      activation.headers,
      "smoke-activate",
    );
    const tenant = await prisma.tenant.findUnique({
      where: { slug: SLUG },
      select: {
        id: true,
        lifecycleStatus: true,
        accessReason: true,
        users: { select: { status: true, tenantRole: true, credential: true } },
        subscriptions: { select: { status: true, providerSubscriptionId: true } },
        entitlementSnapshot: { select: { entitlements: true } },
      },
    });
    record(
      "a signed payment provisions exactly one active tenant",
      activated.outcome === "PROCESSED" &&
        tenant?.lifecycleStatus === "ACTIVE" &&
        tenant.subscriptions.length === 1,
      `${activated.outcome} · ${tenant?.lifecycleStatus ?? "no tenant"}`,
    );
    record(
      "the first Company Admin cannot sign in until they set a password",
      tenant?.users.length === 1 &&
        tenant.users[0]!.status === "INVITED" &&
        tenant.users[0]!.tenantRole === "COMPANY_ADMIN" &&
        tenant.users[0]!.credential === null,
      tenant?.users[0] ? `${tenant.users[0].tenantRole}/${tenant.users[0].status}` : "no admin",
    );

    let snapshotOk = false;
    try {
      const parsed = parseEntitlementSnapshot(tenant?.entitlementSnapshot?.entitlements);
      snapshotOk = parsed.values.PROJECT_ACTIVE_MAX.limitValue === 1n;
    } catch {
      snapshotOk = false;
    }
    record(
      "the plan entitlements are snapshotted onto the tenant",
      snapshotOk,
      snapshotOk ? "starter limits stored and re-readable" : "snapshot missing or unreadable",
    );

    const replay = await webhooks.receive(
      "LEMON_SQUEEZY",
      activation.rawBody,
      activation.headers,
      "smoke-replay",
    );
    record(
      "replaying the same payment creates nothing further",
      replay.outcome === "DUPLICATE" &&
        (await prisma.tenant.count({ where: { slug: { startsWith: SLUG } } })) === 1,
      replay.outcome,
    );

    const tenantId = tenant!.id;

    // --- Lifecycle ---------------------------------------------------------

    const stale = signedRequest(
      subscriptionEvent({
        eventName: "subscription_updated",
        status: "expired",
        updatedAt: "2026-08-12T09:00:00.000Z",
      }),
    );
    const staleResult = await webhooks.receive(
      "LEMON_SQUEEZY",
      stale.rawBody,
      stale.headers,
      "smoke-stale",
    );
    const afterStale = await prisma.tenant.findUnique({
      where: { slug: SLUG },
      select: { lifecycleStatus: true },
    });
    record(
      "an out-of-order event cannot roll a tenant backwards",
      staleResult.outcome === "IGNORED" && afterStale?.lifecycleStatus === "ACTIVE",
      `${staleResult.outcome} · tenant still ${afterStale?.lifecycleStatus}`,
    );

    const pastDue = signedRequest(
      subscriptionEvent({
        eventName: "subscription_payment_failed",
        status: "past_due",
        updatedAt: "2026-08-12T10:30:00.000Z",
      }),
    );
    await webhooks.receive("LEMON_SQUEEZY", pastDue.rawBody, pastDue.headers, "smoke-past-due");
    const graced = await prisma.tenant.findUnique({
      where: { slug: SLUG },
      select: {
        lifecycleStatus: true,
        subscriptions: { select: { status: true, graceEndsAt: true } },
      },
    });
    const graceEndsAt = graced?.subscriptions[0]?.graceEndsAt ?? null;
    const graceDays =
      graceEndsAt === null ? 0 : Math.round((graceEndsAt.getTime() - NOW.getTime()) / 86_400_000);
    record(
      "a failed payment opens a bounded grace window",
      graced?.lifecycleStatus === "PAYMENT_GRACE" && graceDays === 7,
      `${graced?.lifecycleStatus} · grace ends in ${graceDays} day(s)`,
    );

    accessPolicy.invalidate(tenantId);
    const duringGrace = await accessPolicy.getDecision(tenantId, "WRITE");
    const afterGrace = await new TenantAccessPolicy(new PrismaTenantAccessSnapshotReader(prisma), {
      cacheTtlMs: 0,
      now: () => new Date(graceEndsAt!.getTime() + 1),
    }).getDecision(tenantId, "WRITE");
    record(
      "grace keeps the workspace usable, and its expiry closes it",
      duringGrace.allowed && !afterGrace.allowed,
      `during=${duringGrace.allowed ? "allowed" : "denied"} after=${afterGrace.reason ?? "allowed"}`,
    );

    // --- Concurrent limit reservation --------------------------------------

    // Starter allows one active project. Firing several creates at once is the
    // case a check-then-create cannot survive: each request sees zero projects
    // and each believes it may proceed.
    const attempts = await Promise.allSettled(
      [0, 1, 2, 3].map(async (index) =>
        prisma.$transaction(async (transaction) => {
          await limits.reserve(transaction, tenantId, "PROJECT_ACTIVE_MAX");
          await transaction.project.create({
            data: {
              tenantId,
              code: `SMOKE-${index}`,
              name: `Concurrent ${index}`,
              plannedStart: NOW,
              plannedEnd: new Date(NOW.getTime() + 86_400_000),
              budget: "1000.00",
            },
          });
        }),
      ),
    );
    const accepted = attempts.filter((attempt) => attempt.status === "fulfilled").length;
    const projectCount = await prisma.project.count({ where: { tenantId } });
    record(
      "four simultaneous creates cannot both take the last free project slot",
      accepted === 1 && projectCount === 1,
      `${accepted} accepted, ${projectCount} project(s) exist` +
        (accepted === 0 ? ` — ${describeFirstRejection(attempts)}` : ""),
    );
    await prisma.project.deleteMany({ where: { tenantId } });

    // --- Default deny ------------------------------------------------------

    const unknownPrice = signedRequest(
      subscriptionEvent({
        eventName: "subscription_updated",
        status: "active",
        updatedAt: "2026-08-12T11:00:00.000Z",
        externalPriceId: "a-variant-buildwatch-never-published",
      }),
    );
    const unknownResult = await webhooks.receive(
      "LEMON_SQUEEZY",
      unknownPrice.rawBody,
      unknownPrice.headers,
      "smoke-unknown-price",
    );
    const afterUnknown = await prisma.tenant.findUnique({
      where: { slug: SLUG },
      select: { lifecycleStatus: true },
    });
    record(
      "an event naming an unpublished price grants nothing",
      unknownResult.outcome === "FAILED" && afterUnknown?.lifecycleStatus === "PAYMENT_GRACE",
      `${unknownResult.outcome} · tenant still ${afterUnknown?.lifecycleStatus}`,
    );

    const forged = Buffer.from(
      JSON.stringify(
        subscriptionEvent({
          eventName: "subscription_updated",
          status: "active",
          updatedAt: "2026-08-12T12:00:00.000Z",
        }),
      ),
      "utf8",
    );
    let forgedRejected = false;
    try {
      await webhooks.receive(
        "LEMON_SQUEEZY",
        forged,
        { "x-signature": "f".repeat(64) },
        "smoke-forged",
      );
    } catch (error) {
      forgedRejected = (error as { code?: string }).code === "SIGNATURE_INVALID";
    }
    const inboxRows = await prisma.billingWebhookEvent.count({
      where: { correlationId: "smoke-forged" },
    });
    record(
      "an unsigned event never reaches the inbox",
      forgedRejected && inboxRows === 0,
      forgedRejected
        ? `rejected, ${inboxRows} inbox row(s)`
        : "ACCEPTED — signature check bypassed",
    );
  } finally {
    await cleanup();
  }

  const passed = checks.every((check) => check.passed);
  const report = {
    suite: "billing-lifecycle-postgres",
    generatedAt: new Date().toISOString(),
    passed,
    checks,
  };
  const output = resolve(process.cwd(), "data/evaluations/billing-lifecycle-postgres.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const check of checks) {
    process.stdout.write(`${check.passed ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}\n`);
  }
  process.stdout.write(
    `\nBilling lifecycle PostgreSQL smoke: ${passed ? "PASS" : "FAIL"} ` +
      `(${checks.filter((check) => check.passed).length}/${checks.length})\nReport: ${output}\n`,
  );
  if (!passed) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Billing lifecycle smoke failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
