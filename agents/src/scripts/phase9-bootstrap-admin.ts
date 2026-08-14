import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma.js";
import { hashPhase9Password, normalizePhase9Email } from "../backend/index.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const tenantSlug = (argument("--tenant") ?? "tenant-demo").trim();
  const createTenant = flag("--create-tenant");
  const tenantName = argument("--tenant-name")?.trim();
  const email = argument("--email") ?? process.env.PHASE9_BOOTSTRAP_EMAIL;
  const displayName = (argument("--name") ?? "BuildWatch Company Admin").trim();
  const password = process.env.PHASE9_BOOTSTRAP_PASSWORD;
  if (email === undefined || password === undefined) {
    throw new Error("PHASE9_BOOTSTRAP_EMAIL and PHASE9_BOOTSTRAP_PASSWORD are required");
  }
  if (
    tenantSlug.length < 2 ||
    tenantSlug.length > 100 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(tenantSlug)
  ) {
    throw new Error(
      "--tenant must be a lowercase slug containing 2-100 letters, numbers, or hyphens",
    );
  }
  if (
    createTenant &&
    (tenantName === undefined || tenantName.length < 2 || tenantName.length > 200)
  ) {
    throw new Error("--create-tenant requires --tenant-name with 2-200 characters");
  }
  if (displayName.length < 2 || displayName.length > 200) {
    throw new Error("--name must contain 2-200 characters");
  }
  if (password.length < 12 || password.length > 200) {
    throw new Error("PHASE9_BOOTSTRAP_PASSWORD must contain 12-200 characters");
  }
  const emailNormalized = normalizePhase9Email(email);
  const passwordHash = await hashPhase9Password(password);
  const existingTenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (existingTenant === null && !createTenant) {
    throw new Error(
      `Tenant ${tenantSlug} was not found; add --create-tenant --tenant-name <name> for explicit first provisioning`,
    );
  }
  const userId = randomUUID();
  await prisma.$transaction(async (transaction) => {
    const tenant = createTenant
      ? await transaction.tenant.upsert({
          where: { slug: tenantSlug },
          update: {},
          create: {
            id: randomUUID(),
            slug: tenantSlug,
            name: tenantName!,
          },
        })
      : existingTenant!;
    const user = await transaction.user.upsert({
      where: {
        tenantId_emailNormalized: {
          tenantId: tenant.id,
          emailNormalized,
        },
      },
      update: {
        displayName,
        tenantRole: "COMPANY_ADMIN",
        status: "ACTIVE",
        tokenVersion: { increment: 1 },
        emailVerifiedAt: new Date(),
      },
      create: {
        id: userId,
        tenantId: tenant.id,
        email,
        emailNormalized,
        displayName,
        tenantRole: "COMPANY_ADMIN",
        status: "ACTIVE",
        tokenVersion: 1,
        emailVerifiedAt: new Date(),
      },
    });
    await transaction.userCredential.upsert({
      where: { userId: user.id },
      update: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
      create: { userId: user.id, passwordHash },
    });
    await transaction.refreshSession.updateMany({
      where: { tenantId: tenant.id, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await transaction.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        actorUserId: user.id,
        actorRole: "COMPANY_ADMIN",
        action: "BOOTSTRAP_COMPANY_ADMIN",
        entityType: "USER",
        entityId: user.id,
        reason: "Explicit Phase 9 bootstrap command",
        correlationId: randomUUID(),
        sourceVersion: "buildwatch-v22-phase9-bootstrap-v1",
        metadata: {
          tenantSlug,
          tenantCreated: existingTenant === null,
        },
      },
    });
  });
  process.stdout.write(
    `Phase 9 company admin ready: tenant=${tenantSlug} email=${emailNormalized} tenantCreated=${existingTenant === null}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Phase 9 bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
