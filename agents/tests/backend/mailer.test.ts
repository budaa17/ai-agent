import {
  bestEffort,
  billingMailTemplates,
  createMailer,
  LoggingMailer,
  hashEmailVerificationCode,
  newEmailVerificationCode,
  resolveSmtpConfig,
  type MailMessage,
} from "../../src/backend/index.js";

/**
 * Transactional email guards (landing-page-roadmap.md §26).
 *
 * The property that matters most is negative: nothing here may be able to fail a
 * payment, and no token may reach a production log.
 */

function recorder() {
  const events: { event: string; fields?: Record<string, unknown> }[] = [];
  return {
    events,
    logger: {
      warn: (event: string, fields?: Record<string, unknown>) => {
        events.push(fields === undefined ? { event } : { event, fields });
      },
    },
  };
}

describe("mail transport resolution", () => {
  it("reports no transport when the environment is silent", () => {
    expect(resolveSmtpConfig({} as NodeJS.ProcessEnv)).toBeNull();
    // A host without a sender address is not a usable transport.
    expect(resolveSmtpConfig({ SMTP_HOST: "smtp.test" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("defaults to STARTTLS on 587 and implicit TLS on 465", () => {
    const starttls = resolveSmtpConfig({
      SMTP_HOST: "smtp.test",
      SMTP_FROM: "no-reply@buildwatch.mn",
    } as NodeJS.ProcessEnv);
    expect(starttls).toMatchObject({ port: 587, secure: false });

    const implicit = resolveSmtpConfig({
      SMTP_HOST: "smtp.test",
      SMTP_FROM: "no-reply@buildwatch.mn",
      SMTP_PORT: "465",
    } as NodeJS.ProcessEnv);
    expect(implicit).toMatchObject({ port: 465, secure: true });
  });

  it("allows an unauthenticated relay without inventing credentials", () => {
    const config = resolveSmtpConfig({
      SMTP_HOST: "mailhog",
      SMTP_PORT: "1025",
      SMTP_FROM: "no-reply@buildwatch.mn",
    } as NodeJS.ProcessEnv);
    expect(config).toMatchObject({ user: null, password: null });
  });

  it("accepts a safe display-name sender and rejects header injection", () => {
    expect(
      resolveSmtpConfig({
        SMTP_HOST: "smtp.test",
        SMTP_FROM: "BuildWatch <no-reply@buildwatch.mn>",
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ from: "BuildWatch <no-reply@buildwatch.mn>" });
    expect(() =>
      resolveSmtpConfig({
        SMTP_HOST: "smtp.test",
        SMTP_FROM: "BuildWatch <no-reply@buildwatch.mn>\r\nBcc: attacker@example.com",
      } as NodeJS.ProcessEnv),
    ).toThrow(/line breaks/iu);
  });

  it("uses the authenticated Gmail mailbox instead of spoofing an unrelated domain", () => {
    expect(
      resolveSmtpConfig({
        SMTP_HOST: "smtp.gmail.com",
        SMTP_USER: "buildwatch.sender@gmail.com",
        SMTP_PASSWORD: "app-password",
        SMTP_FROM: "BuildWatch <no-reply@buildwatch.mn>",
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ from: "BuildWatch <buildwatch.sender@gmail.com>" });
  });
});

describe("required transactional delivery", () => {
  it("reports a required verification delivery failure but keeps ordinary notices best-effort", async () => {
    const { logger } = recorder();
    const mailer = bestEffort(
      {
        kind: "failing",
        async send() {
          throw new Error("transport down");
        },
      },
      logger,
    );
    await expect(
      mailer.send({ to: "a@b.test", subject: "verify", body: "123456", required: true }),
    ).rejects.toThrow("transport down");
    await expect(
      mailer.send({ to: "a@b.test", subject: "notice", body: "safe notice" }),
    ).resolves.toBeUndefined();
  });
});

describe("delivery never decides state", () => {
  it("swallows a transport failure instead of failing the caller", async () => {
    const { logger, events } = recorder();
    const failing = {
      kind: "broken",
      send: async () => {
        throw new Error("smtp connection refused");
      },
    };
    await expect(
      bestEffort(failing, logger).send({ to: "a@b.test", subject: "s", body: "b" }),
    ).resolves.toBeUndefined();
    expect(events[0]!.event).toBe("mail_delivery_failed");
  });

  it("keeps the token out of the log in production", async () => {
    const { logger, events } = recorder();
    const mailer = new LoggingMailer(logger, true);
    await mailer.send({ to: "a@b.test", subject: "s", body: "https://app/register?setup=SECRET" });
    expect(JSON.stringify(events)).not.toContain("SECRET");
  });

  it("shows the token outside production so a developer can finish the flow", async () => {
    const { logger, events } = recorder();
    const mailer = new LoggingMailer(logger, false);
    await mailer.send({ to: "a@b.test", subject: "s", body: "https://app/register?setup=SECRET" });
    expect(JSON.stringify(events)).toContain("SECRET");
  });

  it("falls back to logging when nothing is configured", () => {
    const { logger } = recorder();
    expect(createMailer({ config: null, logger, production: false }).kind).toBe("logging");
  });
});

describe("message bodies", () => {
  const bodies: MailMessage[] = [
    {
      to: "x",
      ...billingMailTemplates.verifySignup({
        companyName: "Компани",
        verificationCode: "042731",
        expiresInMinutes: 10,
      }),
    },
    {
      to: "x",
      ...billingMailTemplates.setPassword({
        companyName: "Компани",
        setupUrl: "https://app/s",
        expiresInHours: 72,
      }),
    },
    {
      to: "x",
      ...billingMailTemplates.paymentFailed({
        companyName: "Компани",
        graceEndsAt: new Date("2026-08-19T00:00:00Z"),
        billingUrl: "https://app/admin/billing",
      }),
    },
    {
      to: "x",
      ...billingMailTemplates.suspended({
        companyName: "Компани",
        billingUrl: "https://app/admin/billing",
      }),
    },
  ];

  it("covers the four notices the roadmap requires", () => {
    expect(bodies).toHaveLength(4);
    for (const message of bodies) {
      expect(message.subject.length).toBeGreaterThan(5);
      expect(message.body.length).toBeGreaterThan(20);
    }
    expect(bodies[0]?.body).toContain("042731");
    expect(bodies.slice(1).every((message) => message.body.includes("https://app"))).toBe(true);
  });

  it("tells a suspended company its data is still there", () => {
    // Somebody reading this message is deciding whether to panic. The one thing
    // they need to know is that nothing was deleted.
    const suspended = bodies[3]!.body;
    expect(suspended).toContain("Өгөгдөл хэвээр");
    expect(suspended).toContain("экспортлох");
  });

  it("names the exact date the grace window closes", () => {
    expect(bodies[2]!.body).toMatch(/2026/);
  });
});

describe("company signup verification code", () => {
  it("generates exactly six numeric digits", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(newEmailVerificationCode()).toMatch(/^\d{6}$/u);
    }
  });

  it("binds the stored HMAC to the code, intent and independent secret", () => {
    const secret = "email-verification-secret-at-least-32-bytes";
    const first = hashEmailVerificationCode(secret, "signup-a", "042731");
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toBe(hashEmailVerificationCode(secret, "signup-b", "042731"));
    expect(first).not.toBe(hashEmailVerificationCode(secret, "signup-a", "042732"));
    expect(first).not.toBe(
      hashEmailVerificationCode("another-independent-secret-over-32-bytes", "signup-a", "042731"),
    );
  });
});
