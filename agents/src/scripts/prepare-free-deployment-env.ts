import { randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const sourcePath = resolve(root, ".env");
const templatePath = resolve(root, ".env.staging.example");
const targetPath = resolve(root, ".env.production");

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function parseEnvironment(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u.exec(line);
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (key !== undefined && rawValue !== undefined) values.set(key, rawValue.trim());
  }
  return values;
}

function secret(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

function safeValue(name: string, value: string): string {
  if (/[\r\n]/u.test(value)) throw new Error(`${name} must be a single-line environment value`);
  return value;
}

function requireConfigured(values: Map<string, string>, names: readonly string[]): void {
  const missing = names.filter((name) => {
    const value = values.get(name)?.trim();
    return value === undefined || value.length === 0 || /(?:change_me|replace_me)/iu.test(value);
  });
  if (missing.length > 0) {
    throw new Error(
      `Configure these keys in agents/.env before preparing staging: ${missing.join(", ")}`,
    );
  }
}

async function main(): Promise<void> {
  const publicUrlRaw = argument("--public-url");
  if (publicUrlRaw === undefined) {
    throw new Error(
      "Usage: pnpm exec tsx src/scripts/prepare-free-deployment-env.ts " +
        "--public-url https://<random>.trycloudflare.com",
    );
  }
  const publicUrl = new URL(publicUrlRaw);
  if (
    publicUrl.protocol !== "https:" ||
    !publicUrl.hostname.endsWith(".trycloudflare.com") ||
    publicUrl.username !== "" ||
    publicUrl.password !== "" ||
    publicUrl.pathname !== "/" ||
    publicUrl.search !== "" ||
    publicUrl.hash !== ""
  ) {
    throw new Error("--public-url must be an HTTPS trycloudflare.com origin without a path");
  }

  const force = process.argv.includes("--force");
  if (!force) {
    try {
      await readFile(targetPath, "utf8");
      throw new Error(
        "agents/.env.production already exists; use --force only after backing it up",
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        // Expected on the first preparation.
      } else {
        throw error;
      }
    }
  }

  const [sourceContent, templateContent] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(templatePath, "utf8"),
  ]);
  const source = parseEnvironment(sourceContent);
  requireConfigured(source, [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_STARTER_MONTH_PRICE_ID",
    "STRIPE_STARTER_YEAR_PRICE_ID",
    "STRIPE_BUSINESS_MONTH_PRICE_ID",
    "STRIPE_BUSINESS_YEAR_PRICE_ID",
    "OPENAI_API_KEY",
    "AGENT_INPUT_COST_MICRO_USD_PER_MILLION_TOKENS",
    "AGENT_OUTPUT_COST_MICRO_USD_PER_MILLION_TOKENS",
  ]);
  if (!source.get("STRIPE_SECRET_KEY")?.startsWith("sk_test_")) {
    throw new Error("Free staging requires a Stripe sk_test_* key; live credentials are refused");
  }
  if (!source.get("STRIPE_WEBHOOK_SECRET")?.startsWith("whsec_")) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be a configured whsec_* test secret");
  }

  const postgresPassword = secret(36);
  const rabbitPassword = secret(36);
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const generated = new Map<string, string>([
    ["NODE_ENV", "production"],
    ["BUILDWATCH_DEPLOYMENT_STAGE", "staging"],
    ["PRODUCTION_DATABASE", "true"],
    ["APP_RELEASE", `demo-${today}-01`],
    ["BUILDWATCH_PUBLIC_BASE_URL", publicUrl.origin],
    ["BILLING_RETURN_URL_ALLOWLIST", publicUrl.origin],
    ["POSTGRES_PASSWORD", postgresPassword],
    [
      "BUILDWATCH_DATABASE_URL",
      `postgresql://buildwatch:${postgresPassword}@postgres:5432/buildwatch?schema=public`,
    ],
    ["RABBITMQ_PASSWORD", rabbitPassword],
    ["RABBITMQ_URL", `amqp://buildwatch:${rabbitPassword}@rabbitmq:5672`],
    ["PHASE9_JWT_SECRET", secret()],
    ["PHASE9_CURSOR_SECRET", secret()],
    ["PHASE9_ARTIFACT_SIGNING_SECRET", secret()],
    ["PHASE9_EMAIL_VERIFICATION_SECRET", secret()],
    ["PHASE11_METRICS_TOKEN", secret()],
    ["PHASE11_BACKUP_SIGNING_KEY", secret()],
    ["BILLING_PROVIDER", "STRIPE"],
    ["BILLING_ENVIRONMENT", "sandbox"],
    ["BILLING_MANUAL_INVOICE_ENABLED", "false"],
    ["SENTRY_ENVIRONMENT", "staging"],
  ]);

  const template = parseEnvironment(templateContent);
  const output = templateContent
    .split(/\r?\n/u)
    .map((line) => {
      const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*)=(.*)$/u.exec(line);
      if (match === null) return line;
      const [, leading = "", key = "", spacing = ""] = match;
      const value = generated.get(key) ?? source.get(key) ?? template.get(key) ?? "";
      return `${leading}${key}${spacing}=${safeValue(key, value)}`;
    })
    .join("\n");

  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${output.trimEnd()}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, targetPath);
  process.stdout.write(
    "Prepared agents/.env.production for Stripe sandbox staging. " +
      "Secret values were not printed.\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
