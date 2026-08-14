import "dotenv/config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { hashPhase9Password, normalizePhase9Email, platformRoleSchema } from "../backend/index.js";

function transactionStartTimedOut(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Unable to start a transaction in the given time");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main() {
  const email = argument("--email") ?? process.env.PLATFORM_BOOTSTRAP_EMAIL;
  const displayName = (argument("--name") ?? "BuildWatch Platform Admin").trim();
  const password = process.env.PLATFORM_BOOTSTRAP_PASSWORD;
  const role = platformRoleSchema.parse(argument("--role") ?? "PLATFORM_SUPER_ADMIN");
  if (email === undefined || password === undefined) {
    throw new Error("PLATFORM_BOOTSTRAP_EMAIL and PLATFORM_BOOTSTRAP_PASSWORD are required");
  }
  z.string().trim().email().max(320).parse(email);
  if (displayName.length < 2 || displayName.length > 200) {
    throw new Error("--name must contain 2-200 characters");
  }
  if (password.length < 12 || password.length > 200) {
    throw new Error("PLATFORM_BOOTSTRAP_PASSWORD must contain 12-200 characters");
  }

  // The production MFA gate refuses sign-in until a second factor is enrolled.
  // Outside production the flag can be pre-set so the seeded admin is usable.
  const markMfaEnrolled = process.argv.includes("--mfa-enrolled");
  const emailNormalized = normalizePhase9Email(email);
  const passwordHash = await hashPhase9Password(password);
  const principalId = randomUUID();
  const correlationId = randomUUID();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.$transaction(
        async (transaction) => {
          const principal = await transaction.platformPrincipal.upsert({
            where: { emailNormalized },
            update: {
              email,
              displayName,
              role,
              status: "ACTIVE",
              tokenVersion: { increment: 1 },
              ...(markMfaEnrolled ? { mfaEnrolledAt: new Date() } : {}),
            },
            create: {
              id: principalId,
              email,
              emailNormalized,
              displayName,
              role,
              status: "ACTIVE",
              tokenVersion: 1,
              mfaEnrolledAt: markMfaEnrolled ? new Date() : null,
            },
          });
          await transaction.platformCredential.upsert({
            where: { principalId: principal.id },
            update: {
              passwordHash,
              passwordChangedAt: new Date(),
              failedLoginCount: 0,
              lockedUntil: null,
            },
            create: { principalId: principal.id, passwordHash },
          });
          await transaction.platformRefreshSession.updateMany({
            where: { principalId: principal.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await transaction.platformAuditLog.create({
            data: {
              id: randomUUID(),
              actorPrincipalId: principal.id,
              actorRole: principal.role,
              tenantId: null,
              action: "BOOTSTRAP_PLATFORM_PRINCIPAL",
              entityType: "PLATFORM_PRINCIPAL",
              entityId: principal.id,
              result: "SUCCESS",
              reason: "Explicit platform bootstrap command",
              correlationId,
              sourceVersion: "buildwatch-platform-bootstrap-v1",
              metadata: { role: principal.role },
            },
          });
        },
        { maxWait: 30_000, timeout: 60_000 },
      );
      break;
    } catch (error) {
      if (attempt === 3 || !transactionStartTimedOut(error)) throw error;
      process.stderr.write(`Platform bootstrap transaction busy; retrying (${attempt}/3)\n`);
      await delay(attempt * 1_000);
    }
  }

  process.stdout.write(
    `Platform principal ready: email=${emailNormalized} role=${role} correlationId=${correlationId}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Platform bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
