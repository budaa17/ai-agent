-- Phase 8: persisted AI evaluation history and time-boxed support access.
-- Additive only; nothing existing is dropped or rewritten.

-- CreateEnum
CREATE TYPE "PlatformSupportAccessState" AS ENUM (
  'REQUESTED',
  'APPROVED',
  'DENIED',
  'REVOKED',
  'EXPIRED'
);
CREATE TYPE "PlatformSupportAccessEventType" AS ENUM (
  'REQUESTED',
  'APPROVED',
  'DENIED',
  'REVOKED',
  'EXPIRED',
  'USED'
);

-- CreateTable
CREATE TABLE "PlatformEvaluationRun" (
    "id" TEXT NOT NULL,
    "suiteKey" TEXT NOT NULL,
    "suiteVersion" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "agentRelease" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "toolBundleVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "caseCount" INTEGER NOT NULL,
    "passedCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformEvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSupportAccessGrant" (
    "id" TEXT NOT NULL,
    "ticketReference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "allowedOperations" TEXT[],
    "maskedOnly" BOOLEAN NOT NULL DEFAULT true,
    "state" "PlatformSupportAccessState" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decisionReason" TEXT,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSupportAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSupportAccessEvent" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "type" "PlatformSupportAccessEventType" NOT NULL,
    "fromState" "PlatformSupportAccessState",
    "toState" "PlatformSupportAccessState" NOT NULL,
    "actorPrincipalId" TEXT,
    "actorRole" "PlatformRole",
    "reason" TEXT,
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "metadata" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSupportAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformEvaluationRun_suite_release_started_key"
ON "PlatformEvaluationRun"("suiteKey", "suiteVersion", "agentRelease", "startedAt");
CREATE INDEX "PlatformEvaluationRun_agentType_completedAt_idx"
ON "PlatformEvaluationRun"("agentType", "completedAt");
CREATE INDEX "PlatformEvaluationRun_suite_completedAt_idx"
ON "PlatformEvaluationRun"("suiteKey", "suiteVersion", "completedAt");
CREATE INDEX "PlatformEvaluationRun_completedAt_idx"
ON "PlatformEvaluationRun"("completedAt");

CREATE INDEX "PlatformSupportAccessGrant_state_expiresAt_idx"
ON "PlatformSupportAccessGrant"("state", "expiresAt");
CREATE INDEX "PlatformSupportAccessGrant_tenantId_state_idx"
ON "PlatformSupportAccessGrant"("tenantId", "state");
CREATE INDEX "PlatformSupportAccessGrant_requestedById_requestedAt_idx"
ON "PlatformSupportAccessGrant"("requestedById", "requestedAt");
CREATE INDEX "PlatformSupportAccessGrant_requestedAt_idx"
ON "PlatformSupportAccessGrant"("requestedAt");

CREATE UNIQUE INDEX "PlatformSupportAccessEvent_grantId_idempotencyKey_key"
ON "PlatformSupportAccessEvent"("grantId", "idempotencyKey");
CREATE INDEX "PlatformSupportAccessEvent_grantId_occurredAt_idx"
ON "PlatformSupportAccessEvent"("grantId", "occurredAt");
CREATE INDEX "PlatformSupportAccessEvent_correlationId_idx"
ON "PlatformSupportAccessEvent"("correlationId");

-- Read paths behind the AI Quality module.
CREATE INDEX "AgentFeedback_quality_agent_reviewed_idx"
ON "AgentFeedback"("agentType", "reviewedAt", "promptVersion");
CREATE INDEX "AgentRun_quality_release_started_idx"
ON "AgentRun"("agentType", "promptVersion", "modelId", "startedAt");

-- AddForeignKey
ALTER TABLE "PlatformSupportAccessGrant"
ADD CONSTRAINT "PlatformSupportAccessGrant_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformSupportAccessGrant"
ADD CONSTRAINT "PlatformSupportAccessGrant_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "PlatformPrincipal"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlatformSupportAccessGrant"
ADD CONSTRAINT "PlatformSupportAccessGrant_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "PlatformPrincipal"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformSupportAccessGrant"
ADD CONSTRAINT "PlatformSupportAccessGrant_revokedById_fkey"
FOREIGN KEY ("revokedById") REFERENCES "PlatformPrincipal"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformSupportAccessEvent"
ADD CONSTRAINT "PlatformSupportAccessEvent_grantId_fkey"
FOREIGN KEY ("grantId") REFERENCES "PlatformSupportAccessGrant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformSupportAccessEvent"
ADD CONSTRAINT "PlatformSupportAccessEvent_actorPrincipalId_fkey"
FOREIGN KEY ("actorPrincipalId") REFERENCES "PlatformPrincipal"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Support access history is evidence, so it is append-only like the audit trail.
CREATE TRIGGER "PlatformSupportAccessEvent_append_only"
BEFORE UPDATE OR DELETE ON "PlatformSupportAccessEvent"
FOR EACH ROW EXECUTE FUNCTION buildwatch_reject_append_only_mutation();

-- A grant can never be its own approval: two-person control is a database rule,
-- not only an application rule.
ALTER TABLE "PlatformSupportAccessGrant"
ADD CONSTRAINT "PlatformSupportAccessGrant_two_person_approval"
CHECK ("approvedById" IS NULL OR "approvedById" <> "requestedById");
