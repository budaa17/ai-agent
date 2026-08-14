-- ADR 0017: platform operators are not tenant-scoped users. This migration is
-- additive; the legacy IdentityRole.SUPER_ADMIN value remains untouched until
-- the later tenant-role migration wave.

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM (
    'PLATFORM_SUPER_ADMIN',
    'PLATFORM_OPERATOR',
    'PLATFORM_AUDITOR'
);

CREATE TYPE "PlatformAuditResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');

-- CreateTable
CREATE TABLE "PlatformPrincipal" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL DEFAULT 'PLATFORM_AUDITOR',
    "status" "IdentityUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPrincipal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCredential" (
    "principalId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCredential_pkey" PRIMARY KEY ("principalId")
);

-- CreateTable
CREATE TABLE "PlatformRefreshSession" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "parentSessionId" TEXT,
    "replacedById" TEXT,
    "deviceName" TEXT,
    "userAgent" TEXT,
    "ipAddressHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "reuseDetectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformRefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "actorPrincipalId" TEXT,
    "actorRole" "PlatformRole",
    "tenantId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "result" "PlatformAuditResult" NOT NULL DEFAULT 'SUCCESS',
    "reason" TEXT,
    "correlationId" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "beforeHash" TEXT,
    "afterHash" TEXT,
    "metadata" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPrincipal_emailNormalized_key"
ON "PlatformPrincipal"("emailNormalized");
CREATE INDEX "PlatformPrincipal_status_role_idx"
ON "PlatformPrincipal"("status", "role");
CREATE UNIQUE INDEX "PlatformRefreshSession_tokenHash_key"
ON "PlatformRefreshSession"("tokenHash");
CREATE INDEX "PlatformRefreshSession_principalId_expiresAt_idx"
ON "PlatformRefreshSession"("principalId", "expiresAt");
CREATE INDEX "PlatformRefreshSession_familyId_idx"
ON "PlatformRefreshSession"("familyId");
CREATE INDEX "PlatformAuditLog_actorPrincipalId_occurredAt_idx"
ON "PlatformAuditLog"("actorPrincipalId", "occurredAt");
CREATE INDEX "PlatformAuditLog_correlationId_idx"
ON "PlatformAuditLog"("correlationId");
CREATE INDEX "PlatformAuditLog_action_occurredAt_idx"
ON "PlatformAuditLog"("action", "occurredAt");
CREATE INDEX "PlatformAuditLog_occurredAt_idx"
ON "PlatformAuditLog"("occurredAt");
CREATE INDEX "PlatformAuditLog_tenantId_occurredAt_idx"
ON "PlatformAuditLog"("tenantId", "occurredAt");

-- AddForeignKey
ALTER TABLE "PlatformCredential"
ADD CONSTRAINT "PlatformCredential_principalId_fkey"
FOREIGN KEY ("principalId") REFERENCES "PlatformPrincipal"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformRefreshSession"
ADD CONSTRAINT "PlatformRefreshSession_principalId_fkey"
FOREIGN KEY ("principalId") REFERENCES "PlatformPrincipal"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformAuditLog"
ADD CONSTRAINT "PlatformAuditLog_actorPrincipalId_fkey"
FOREIGN KEY ("actorPrincipalId") REFERENCES "PlatformPrincipal"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Platform audit is append-only for the same reason as tenant AuditLog.
CREATE TRIGGER "PlatformAuditLog_append_only"
BEFORE UPDATE OR DELETE ON "PlatformAuditLog"
FOR EACH ROW EXECUTE FUNCTION buildwatch_reject_append_only_mutation();
