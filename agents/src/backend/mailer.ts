import { createHash } from "node:crypto";
import { createTransport, type Transporter } from "nodemailer";
import { z } from "zod";

/**
 * Transactional email (landing-page-roadmap.md §26).
 *
 * Until now BuildWatch had no way to reach a person who is not already signed
 * in, which made the paid signup flow impossible to finish: the new Company
 * Admin's password-setup link had nowhere to go.
 *
 * Two rules shape this module:
 *   - **Delivery never decides state.** Sending is attempted after the
 *     transaction that changed the subscription has committed, and a failure is
 *     logged rather than thrown. An email outage must not undo a paid signup.
 *   - **Tokens are single-use and short-lived.** They appear in exactly one
 *     message and are never logged in production.
 */

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text only: these are short operational notices, not marketing. */
  readonly body: string;
  /** Signup verification must report a transport failure to the caller. */
  readonly required?: boolean;
}

export interface Mailer {
  readonly kind: string;
  send(message: MailMessage): Promise<void>;
}

/** RFC-style mailbox accepted by Nodemailer: address or Display Name <address>. */
const mailboxSchema = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .refine((value) => !/[\r\n]/u.test(value), "Mailbox must not contain line breaks")
  .refine((value) => {
    const bracketed = /^(?:[^<>]+)\s*<([^<>]+)>$/u.exec(value);
    const address = (bracketed?.[1] ?? value).trim();
    return z.string().email().safeParse(address).success;
  }, "Invalid email mailbox");

function mailboxAddress(value: string): string {
  return (/^(?:[^<>]+)\s*<([^<>]+)>$/u.exec(value)?.[1] ?? value).trim();
}

export const smtpConfigSchema = z
  .object({
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65_535),
    secure: z.boolean(),
    user: z.string().trim().min(1).max(320).nullable(),
    password: z.string().min(1).max(1_024).nullable(),
    from: mailboxSchema,
    replyTo: mailboxSchema.nullable(),
  })
  .strict();

export type SmtpConfig = z.infer<typeof smtpConfigSchema>;

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * Reads SMTP settings from the environment. Returns `null` when none are
 * configured, which is a normal state on a developer machine.
 */
export function resolveSmtpConfig(environment: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = nonBlank(environment.SMTP_HOST);
  const configuredFrom = nonBlank(environment.SMTP_FROM);
  if (host === undefined || configuredFrom === undefined) return null;

  const port = Number(environment.SMTP_PORT ?? "587");
  const user = nonBlank(environment.SMTP_USER) ?? null;
  // A consumer Gmail SMTP account cannot authentically send as an unrelated,
  // unverified domain. Gmail may accept the SMTP transaction but DMARC/filtering
  // can silently keep it out of the recipient inbox. Canonicalize this one
  // well-known transport to the authenticated mailbox; Reply-To remains free.
  const from =
    host.toLowerCase() === "smtp.gmail.com" &&
    user !== null &&
    mailboxAddress(configuredFrom).toLowerCase() !== user.toLowerCase()
      ? `BuildWatch <${user}>`
      : configuredFrom;
  return smtpConfigSchema.parse({
    host,
    port,
    // Implicit TLS is port 465; 587 upgrades with STARTTLS, which nodemailer
    // does automatically when `secure` is false.
    secure: (nonBlank(environment.SMTP_SECURE) ?? String(port === 465)) === "true",
    user,
    password: nonBlank(environment.SMTP_PASSWORD) ?? null,
    from,
    replyTo: nonBlank(environment.SMTP_REPLY_TO) ?? null,
  });
}

export class SmtpMailer implements Mailer {
  readonly kind = "smtp";
  readonly #transport: Transporter;
  readonly #config: SmtpConfig;
  readonly #logger?: { info?(event: string, fields?: Record<string, unknown>): void };

  constructor(
    config: SmtpConfig,
    transport?: Transporter,
    logger?: { info?(event: string, fields?: Record<string, unknown>): void },
  ) {
    this.#config = config;
    this.#logger = logger;
    this.#transport =
      transport ??
      createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth:
          config.user === null || config.password === null
            ? undefined
            : { user: config.user, pass: config.password },
      });
  }

  async send(message: MailMessage): Promise<void> {
    const result = await this.#transport.sendMail({
      from: this.#config.from,
      ...(this.#config.replyTo === null ? {} : { replyTo: this.#config.replyTo }),
      to: message.to,
      subject: message.subject,
      text: message.body,
    });
    // Provider acceptance is not inbox delivery, but recording the safe SMTP
    // receipt separates an application failure from downstream filtering. Do
    // not log the address, subject, body, code, credentials or provider URL.
    this.#logger?.info?.("mail_smtp_accepted", {
      recipientTag: createHash("sha256")
        .update(message.to.trim().toLowerCase())
        .digest("hex")
        .slice(0, 12),
      acceptedCount: Array.isArray(result.accepted) ? result.accepted.length : 0,
      rejectedCount: Array.isArray(result.rejected) ? result.rejected.length : 0,
      messageId: result.messageId,
    });
  }
}

/**
 * Fallback when no transport is configured.
 *
 * It records that a message *would* have been sent and, outside production,
 * prints the body so a developer can copy the token. In production it withholds
 * the body: a token in a log file is a credential in a log file.
 */
export class LoggingMailer implements Mailer {
  readonly kind = "logging";

  constructor(
    private readonly logger: { warn(event: string, fields?: Record<string, unknown>): void },
    private readonly production: boolean,
  ) {}

  async send(message: MailMessage): Promise<void> {
    this.logger.warn("mail_not_delivered_no_transport", {
      to: message.to,
      subject: message.subject,
      ...(this.production ? {} : { body: message.body }),
    });
  }
}

/**
 * Wraps a mailer so a delivery failure is logged and swallowed.
 *
 * Every caller here has already committed the state change the message
 * describes. Letting a transport error propagate would turn "the receipt did not
 * send" into "the payment failed".
 */
export function bestEffort(
  mailer: Mailer,
  logger: { warn(event: string, fields?: Record<string, unknown>): void },
): Mailer {
  return {
    kind: mailer.kind,
    async send(message) {
      try {
        await mailer.send(message);
      } catch (error) {
        logger.warn("mail_delivery_failed", {
          to: message.to,
          subject: message.subject,
          error: error instanceof Error ? error.message : String(error),
        });
        if (message.required === true) throw error;
      }
    },
  };
}

export function createMailer(options: {
  config: SmtpConfig | null;
  logger: {
    warn(event: string, fields?: Record<string, unknown>): void;
    info?(event: string, fields?: Record<string, unknown>): void;
  };
  production: boolean;
}): Mailer {
  const base =
    options.config === null
      ? new LoggingMailer(options.logger, options.production)
      : new SmtpMailer(options.config, undefined, options.logger);
  return bestEffort(base, options.logger);
}

// ---------------------------------------------------------------------------
// Message bodies (§26)
// ---------------------------------------------------------------------------

function line(...parts: string[]): string {
  return parts.join("\n");
}

export const billingMailTemplates = {
  verifySignup(input: { companyName: string; verificationCode: string; expiresInMinutes: number }) {
    return {
      subject: `${input.verificationCode} — BuildWatch имэйл баталгаажуулах код`,
      body: line(
        `${input.companyName} нэрээр BuildWatch-д бүртгүүлэх хүсэлт хүлээн авлаа.`,
        "",
        "Таны баталгаажуулах код:",
        input.verificationCode,
        "",
        `Код ${input.expiresInMinutes} минутын дараа хүчингүй болно. Нэг л удаа ажиллана.`,
        "Энэ кодыг бусдад бүү дамжуулаарай.",
        "",
        "Хэрэв та энэ хүсэлтийг гаргаагүй бол энэ захидлыг үл тоомсорлоно уу.",
      ),
    };
  },

  setPassword(input: { companyName: string; setupUrl: string; expiresInHours: number }) {
    return {
      subject: "BuildWatch — ажлын талбар бэлэн боллоо",
      body: line(
        `${input.companyName}-ийн BuildWatch ажлын талбар үүслээ.`,
        "",
        "Администраторын нууц үгээ доорх холбоосоор тохируулна уу:",
        input.setupUrl,
        "",
        `Холбоос ${input.expiresInHours} цагийн дараа хүчингүй болно. Нэг л удаа ажиллана.`,
      ),
    };
  },

  paymentFailed(input: { companyName: string; graceEndsAt: Date; billingUrl: string }) {
    return {
      subject: "BuildWatch — төлбөр амжилтгүй боллоо",
      body: line(
        `${input.companyName}-ийн захиалгын төлбөр амжилтгүй болсон байна.`,
        "",
        `Ажлын талбар ${input.graceEndsAt.toLocaleDateString("mn-MN")} хүртэл бүрэн ажиллана.`,
        "Тэр өдрөөс хойш шинэ өөрчлөлт болон AI ажиллагаа зогсоно. Өгөгдөл устахгүй.",
        "",
        "Төлбөрөө сэргээх:",
        input.billingUrl,
      ),
    };
  },

  suspended(input: { companyName: string; billingUrl: string }) {
    return {
      subject: "BuildWatch — захиалга түр хаагдлаа",
      body: line(
        `${input.companyName}-ийн захиалга төлбөр хийгдээгүйн улмаас түр хаагдлаа.`,
        "",
        "Шинэ өөрчлөлт болон AI ажиллагаа зогссон. Өгөгдөл хэвээр байгаа бөгөөд",
        "унших, экспортлох боломж нээлттэй хэвээр байна.",
        "",
        "Төлбөрөө сэргээснээр үйлчилгээ шууд үргэлжилнэ:",
        input.billingUrl,
      ),
    };
  },
};
