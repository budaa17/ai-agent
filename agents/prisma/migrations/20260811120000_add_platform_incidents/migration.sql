-- Phase 6: persistent platform incidents. Additive only; nothing existing is
-- dropped or rewritten, so the migration can ship ahead of the API rollout.

-- CreateEnum
CREATE TYPE "PlatformIncidentSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "PlatformIncidentState" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'REOPENED');
CREATE TYPE "PlatformIncidentEventType" AS ENUM (
  'OPENED',
  'SEVERITY_CHANGED',
  'ACKNOWLEDGED',
  'ASSIGNED',
  'RESOLVED',
  'AUTO_RESOLVED',
  'REOPENED'
);

-- CreateTable
CREATE TABLE "PlatformIncident" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "severity" "PlatformIncidentSeverity" NOT NULL,
    "state" "PlatformIncidentState" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "diagnosticsHref" TEXT NOT NULL,
    "tenantId" TEXT,
    "tenantName" TEXT,
    "agentType" TEXT,
    "component" TEXT,
    "evidence" JSONB NOT NULL,
    "firstEvidenceAt" TIMESTAMP(3),
    "lastEvidenceAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "autoResolvedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformIncidentEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "type" "PlatformIncidentEventType" NOT NULL,
    "fromState" "PlatformIncidentState",
    "toState" "PlatformIncidentState" NOT NULL,
    "actorPrincipalId" TEXT,
    "actorRole" "PlatformRole",
    "reason" TEXT,
    "note" TEXT,
    "correlationId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformIncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformIncident_signalId_key" ON "PlatformIncident"("signalId");
CREATE INDEX "PlatformIncident_state_severity_lastEvidenceAt_idx"
ON "PlatformIncident"("state", "severity", "lastEvidenceAt");
CREATE INDEX "PlatformIncident_tenantId_state_idx" ON "PlatformIncident"("tenantId", "state");
CREATE INDEX "PlatformIncident_agentType_state_idx" ON "PlatformIncident"("agentType", "state");
CREATE INDEX "PlatformIncident_openedAt_idx" ON "PlatformIncident"("openedAt");
CREATE INDEX "PlatformIncidentEvent_incidentId_occurredAt_idx"
ON "PlatformIncidentEvent"("incidentId", "occurredAt");
CREATE INDEX "PlatformIncidentEvent_correlationId_idx"
ON "PlatformIncidentEvent"("correlationId");

-- Keyset page for the incident list and its lifecycle timeline.
CREATE INDEX "PlatformIncident_keyset_opened_id_idx"
ON "PlatformIncident"("openedAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "PlatformIncident"
ADD CONSTRAINT "PlatformIncident_acknowledgedById_fkey"
FOREIGN KEY ("acknowledgedById") REFERENCES "PlatformPrincipal"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformIncident"
ADD CONSTRAINT "PlatformIncident_assignedToId_fkey"
FOREIGN KEY ("assignedToId") REFERENCES "PlatformPrincipal"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformIncident"
ADD CONSTRAINT "PlatformIncident_resolvedById_fkey"
FOREIGN KEY ("resolvedById") REFERENCES "PlatformPrincipal"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformIncidentEvent"
ADD CONSTRAINT "PlatformIncidentEvent_incidentId_fkey"
FOREIGN KEY ("incidentId") REFERENCES "PlatformIncident"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformIncidentEvent"
ADD CONSTRAINT "PlatformIncidentEvent_actorPrincipalId_fkey"
FOREIGN KEY ("actorPrincipalId") REFERENCES "PlatformPrincipal"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Incident history is evidence, so it is append-only like the audit trail.
CREATE TRIGGER "PlatformIncidentEvent_append_only"
BEFORE UPDATE OR DELETE ON "PlatformIncidentEvent"
FOR EACH ROW EXECUTE FUNCTION buildwatch_reject_append_only_mutation();
