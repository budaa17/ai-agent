import {
  platformAccessOverrideSchema,
  platformManualPaymentConfirmationSchema,
  platformPermissionsForRole,
  PlatformBillingService,
} from "../../src/backend/index.js";

/**
 * Guards the two platform actions that move money and access
 * (landing-page-roadmap.md §22, Phase 8).
 */

const NOW = new Date("2026-08-12T10:00:00.000Z");

type Recorded = { table: string; data: Record<string, unknown> };

/**
 * Minimal Prisma stand-in. The service is a coordinator, so the interesting
 * behaviour is which writes it makes and which it refuses to make.
 */
function stubClient(overrides: Record<string, unknown> = {}) {
  const writes: Recorded[] = [];
  const record = (table: string) => ({
    create: async ({ data }: { data: Record<string, unknown> }) => {
      writes.push({ table, data });
      return data;
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      writes.push({ table, data });
      return data;
    },
    upsert: async ({ update }: { update: Record<string, unknown> }) => {
      writes.push({ table, data: update });
      return update;
    },
    findUnique: async () => null,
    findMany: async () => [],
    count: async () => 0,
    deleteMany: async () => ({ count: 0 }),
  });

  const client = {
    tenant: record("tenant"),
    tenantSubscription: record("tenantSubscription"),
    tenantEntitlementSnapshot: record("tenantEntitlementSnapshot"),
    billingInvoice: record("billingInvoice"),
    billingWebhookEvent: record("billingWebhookEvent"),
    platformAuditLog: record("platformAuditLog"),
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work(client),
    ...overrides,
  };
  return { client, writes };
}

const ACTOR = { principalId: "platform-1" } as never;

describe("platform billing permissions", () => {
  it("lets an auditor read billing but never act on it", () => {
    const auditor = [...platformPermissionsForRole("PLATFORM_AUDITOR")];
    expect(auditor).toContain("PLATFORM_BILLING_READ");
    expect(auditor).not.toContain("PLATFORM_BILLING_MANAGE");
    expect(auditor).not.toContain("PLATFORM_PLAN_MANAGE");
  });

  it("lets an operator confirm a payment but not publish a plan", () => {
    // Confirming a bank transfer is day-to-day finance work; changing what every
    // future buyer is charged is not.
    const operator = [...platformPermissionsForRole("PLATFORM_OPERATOR")];
    expect(operator).toContain("PLATFORM_BILLING_MANAGE");
    expect(operator).not.toContain("PLATFORM_PLAN_MANAGE");
    expect([...platformPermissionsForRole("PLATFORM_SUPER_ADMIN")]).toContain(
      "PLATFORM_PLAN_MANAGE",
    );
  });
});

describe("manual payment confirmation", () => {
  function serviceFor(subscription: Record<string, unknown> | null) {
    const { client, writes } = stubClient({
      tenantSubscription: {
        findUnique: async () =>
          subscription === null
            ? null
            : { ...subscription, plan: { code: "starter", interval: "MONTH" } },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          writes.push({ table: "tenantSubscription", data });
          return data;
        },
      },
    });
    return {
      writes,
      service: new PlatformBillingService({ client: client as never, now: () => NOW }),
    };
  }

  const manualSubscription = {
    id: "sub-1",
    tenantId: "tenant-1",
    provider: "MANUAL_INVOICE",
    status: "PENDING",
    tenant: { lifecycleStatus: "PENDING_PAYMENT" },
  };

  const validInput = {
    actor: ACTOR,
    subscriptionId: "sub-1",
    paymentReference: "TDB-2026-0012",
    periodEnd: new Date("2026-09-12T10:00:00.000Z"),
    amountMinor: 39_000_000n,
    taxMinor: 3_900_000n,
    currency: "MNT",
    reason: "Данснаас орсон гүйлгээ баталгаажлаа",
  };

  it("refuses to mark a card subscription paid by hand", async () => {
    // A card payment has signed provider evidence. Allowing an operator to
    // declare one paid would put a human back inside the payment trail.
    const { service } = serviceFor({ ...manualSubscription, provider: "LEMON_SQUEEZY" });
    await expect(service.confirmManualPayment(validInput)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 409,
    });
  });

  it("refuses a period that has already ended", async () => {
    const { service } = serviceFor(manualSubscription);
    await expect(
      service.confirmManualPayment({ ...validInput, periodEnd: new Date("2026-08-01T00:00:00Z") }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("refuses an unknown subscription", async () => {
    const { service } = serviceFor(null);
    await expect(service.confirmManualPayment(validInput)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("records the invoice, activates the tenant and audits who did it", async () => {
    const { service, writes } = serviceFor(manualSubscription);
    const result = await service.confirmManualPayment(validInput);
    expect(result.tenantId).toBe("tenant-1");

    const invoice = writes.find((write) => write.table === "billingInvoice")!.data;
    expect(invoice.status).toBe("PAID");
    // The database enforces total = subtotal + tax; the service must not rely on
    // the operator typing a consistent total.
    expect(invoice.totalMinor).toBe(42_900_000n);
    expect(invoice.invoiceNumber).toBe("TDB-2026-0012");

    const tenant = writes.find((write) => write.table === "tenant")!.data;
    expect(tenant.lifecycleStatus).toBe("ACTIVE");
    expect(tenant.accessReason).toBe("MANUAL_INVOICE_CONFIRMED");

    const audit = writes.find((write) => write.table === "platformAuditLog")!.data;
    expect(audit.action).toBe("MANUAL_INVOICE_CONFIRMED");
    expect(audit.actorPrincipalId).toBe("platform-1");
    expect(audit.reason).toBe(validInput.reason);
    expect(audit.metadata).toMatchObject({ fromLifecycle: "PENDING_PAYMENT" });
  });
});

describe("time-boxed access override", () => {
  function serviceFor(lifecycleStatus = "SUSPENDED") {
    const { client, writes } = stubClient({
      tenant: {
        findUnique: async () => ({ lifecycleStatus }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          writes.push({ table: "tenant", data });
          return data;
        },
        findMany: async () => [],
      },
    });
    return {
      writes,
      service: new PlatformBillingService({ client: client as never, now: () => NOW }),
    };
  }

  it("refuses an override that never expires in practice", async () => {
    const { service } = serviceFor();
    await expect(
      service.grantAccessOverride({
        actor: ACTOR,
        tenantId: "tenant-1",
        expiresAt: new Date("2027-08-12T10:00:00.000Z"),
        reason: "гэрээ хэлэлцэж байна",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("refuses an override that is already in the past", async () => {
    const { service } = serviceFor();
    await expect(
      service.grantAccessOverride({
        actor: ACTOR,
        tenantId: "tenant-1",
        expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        reason: "тест",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("writes the expiry into the access reason so it stays visibly temporary", async () => {
    const { service, writes } = serviceFor();
    const expiresAt = new Date("2026-08-26T10:00:00.000Z");
    await service.grantAccessOverride({
      actor: ACTOR,
      tenantId: "tenant-1",
      expiresAt,
      reason: "гэрээний төлбөр замдаа",
    });
    const tenant = writes.find((write) => write.table === "tenant")!.data;
    expect(tenant.lifecycleStatus).toBe("ACTIVE");
    expect(tenant.accessReason).toBe(`OVERRIDE_UNTIL_${expiresAt.toISOString()}`);

    const audit = writes.find((write) => write.table === "platformAuditLog")!.data;
    expect(audit.action).toBe("BILLING_ACCESS_OVERRIDE_CREATED");
  });

  it("suspends a tenant once its override window has passed", async () => {
    const { client, writes } = stubClient({
      tenant: {
        findMany: async () => [
          { id: "expired-1", accessReason: "OVERRIDE_UNTIL_2026-08-01T00:00:00.000Z" },
          { id: "still-valid", accessReason: "OVERRIDE_UNTIL_2026-12-01T00:00:00.000Z" },
        ],
        update: async ({ data }: { data: Record<string, unknown> }) => {
          writes.push({ table: "tenant", data });
          return data;
        },
        findUnique: async () => null,
      },
    });
    const service = new PlatformBillingService({ client: client as never, now: () => NOW });

    expect(await service.expireOverrides()).toBe(1);
    const suspended = writes.filter((write) => write.table === "tenant");
    expect(suspended).toHaveLength(1);
    expect(suspended[0]!.data.accessReason).toBe("OVERRIDE_EXPIRED");
  });
});

describe("platform billing request contracts", () => {
  it("demands a reason for every action on someone else's access", () => {
    expect(
      platformManualPaymentConfirmationSchema.safeParse({
        paymentReference: "TDB-1",
        periodEnd: "2026-09-12T10:00:00.000Z",
        amountMinor: "39000000",
        currency: "MNT",
      }).success,
    ).toBe(false);
    expect(
      platformAccessOverrideSchema.safeParse({ expiresAt: "2026-09-12T10:00:00.000Z" }).success,
    ).toBe(false);
  });

  it("refuses a non-integer or negative amount", () => {
    for (const amountMinor of ["39000000.5", "-1", "abc"]) {
      expect(
        platformManualPaymentConfirmationSchema.safeParse({
          paymentReference: "TDB-1",
          periodEnd: "2026-09-12T10:00:00.000Z",
          amountMinor,
          currency: "MNT",
          reason: "тест",
        }).success,
      ).toBe(false);
    }
  });
});

describe("platform billing read surface", () => {
  it("publishes no revenue figure before reconciliation is trustworthy", async () => {
    // §22 forbids a placeholder MRR: a number nobody has reconciled is worse than
    // no number. The overview is asserted directly rather than by reading source.
    const { client } = stubClient();
    const service = new PlatformBillingService({ client: client as never, now: () => NOW });
    const overview = await service.overview();
    const keys = Object.keys(overview).join(" ").toLowerCase();
    expect(keys).not.toMatch(/mrr|revenue|churn|arr/);
    expect(Object.keys(overview).sort()).toEqual(
      [
        "active",
        "activeSubscriptions",
        "activeTenants",
        "activeWithoutSubscription",
        "failedWebhooks",
        "graceEndingWithin7Days",
        "inGrace",
        "pendingPayment",
        "suspended",
        "unpaidInvoices",
      ].sort(),
    );
  });
});
