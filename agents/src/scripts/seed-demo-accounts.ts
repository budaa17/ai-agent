import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma.js";
import { hashPhase9Password, normalizePhase9Email, permissionsForRole } from "../backend/index.js";
import type { Phase9Role } from "../backend/index.js";

/**
 * Creates one demo account per RBAC role so the console can be shown from every
 * point of view. Development and demonstration only: the passwords are derived
 * from the role name and are meant to be readable, not secret.
 */

const HELP_TEXT = `
Usage:
  pnpm.cmd run seed:demo:accounts -- [options]

Options:
  --tenant <slug>     Tenant slug to seed into (default: nomad-build)
  --domain <domain>   Email domain for the accounts (default: buildwatch.demo)
  --help              Show this help
`.trim();

const ROLES = [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "PROJECT_MANAGER",
  "ENGINEER",
  "SITE_SUPERVISOR",
  "STOREKEEPER",
  "OBSERVER",
] as const satisfies readonly Phase9Role[];

const DISPLAY_NAMES: Record<Phase9Role, string> = {
  SUPER_ADMIN: "Платформ администратор",
  COMPANY_ADMIN: "Компанийн администратор",
  PROJECT_MANAGER: "Төслийн менежер",
  ENGINEER: "Инженер / ПТО",
  SITE_SUPERVISOR: "Талбайн ахлагч",
  STOREKEEPER: "Нярав",
  OBSERVER: "Ажиглагч",
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function localPart(role: Phase9Role): string {
  return role.toLocaleLowerCase("en-US").replaceAll("_", ".");
}

function demoPassword(role: Phase9Role): string {
  const camel = role
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLocaleLowerCase("en-US"))
    .join("");
  return `BuildWatch-${camel}-2026!`;
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }
  const tenantSlug = (argument("--tenant") ?? "nomad-build").trim();
  const domain = (argument("--domain") ?? "buildwatch.demo").trim();

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (tenant === null) {
    throw new Error(`Tenant ${tenantSlug} was not found; run "pnpm run seed" first`);
  }
  const projects = await prisma.project.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, code: true },
    orderBy: { id: "asc" },
  });

  const rows: Array<{ role: Phase9Role; email: string; password: string; created: boolean }> = [];

  for (const role of ROLES) {
    const email = `${localPart(role)}@${domain}`;
    const emailNormalized = normalizePhase9Email(email);
    const password = demoPassword(role);
    const passwordHash = await hashPhase9Password(password);

    const existing = await prisma.user.findUnique({
      where: { tenantId_emailNormalized: { tenantId: tenant.id, emailNormalized } },
    });

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { tenantId_emailNormalized: { tenantId: tenant.id, emailNormalized } },
        update: {
          displayName: DISPLAY_NAMES[role],
          tenantRole: role,
          status: "ACTIVE",
          tokenVersion: { increment: 1 },
          emailVerifiedAt: new Date(),
        },
        create: {
          id: randomUUID(),
          tenantId: tenant.id,
          email,
          emailNormalized,
          displayName: DISPLAY_NAMES[role],
          tenantRole: role,
          status: "ACTIVE",
          tokenVersion: 1,
          emailVerifiedAt: new Date(),
        },
      });
      await tx.userCredential.upsert({
        where: { userId: user.id },
        update: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
        create: { userId: user.id, passwordHash },
      });
      // SUPER_ADMIN and COMPANY_ADMIN reach every project through their tenant
      // role; everyone else needs an explicit membership to see one at all.
      for (const project of projects) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: project.id, userId: user.id } },
          update: { role, active: true },
          create: {
            id: randomUUID(),
            tenantId: tenant.id,
            projectId: project.id,
            userId: user.id,
            role,
            active: true,
          },
        });
      }
      await tx.refreshSession.updateMany({
        where: { tenantId: tenant.id, userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          actorUserId: user.id,
          actorRole: role,
          action: "DEMO_ACCOUNT_SEEDED",
          entityType: "USER",
          entityId: user.id,
          reason: "Explicit demo account seed command",
          correlationId: randomUUID(),
          sourceVersion: "buildwatch-v22-demo-accounts-v1",
          metadata: { tenantSlug, projectIds: projects.map((project) => project.id) },
        },
      });
    });

    rows.push({ role, email: emailNormalized, password, created: existing === null });
  }

  process.stdout.write(
    `Seeded ${rows.length} demo accounts into ${tenantSlug} (${projects.length} project memberships each)\n\n`,
  );
  for (const row of rows) {
    process.stdout.write(
      `${row.created ? "created" : "updated"}  ${row.role.padEnd(16)} ${row.email.padEnd(34)} ${row.password.padEnd(34)} ${permissionsForRole(row.role).size} permissions\n`,
    );
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Demo account seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
