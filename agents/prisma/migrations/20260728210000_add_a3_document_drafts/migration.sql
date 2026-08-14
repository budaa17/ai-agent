CREATE TYPE "A3DocumentType" AS ENUM (
    'PROJECT_REPORT',
    'EXECUTIVE_CONCLUSION',
    'OFFICIAL_LETTER'
);

CREATE TYPE "A3DocumentDraftStatus" AS ENUM (
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED'
);

CREATE TABLE "A3DocumentDraft" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentRunId" TEXT,
    "type" "A3DocumentType" NOT NULL,
    "status" "A3DocumentDraftStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "sourceAsOf" TIMESTAMP(3) NOT NULL,
    "trigger" TEXT NOT NULL,
    "artifactPath" TEXT,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "A3DocumentDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "A3DocumentDraft_requestId_type_key"
ON "A3DocumentDraft"("requestId", "type");

CREATE INDEX "A3DocumentDraft_tenantId_projectId_status_createdAt_idx"
ON "A3DocumentDraft"("tenantId", "projectId", "status", "createdAt");

CREATE INDEX "A3DocumentDraft_agentRunId_idx"
ON "A3DocumentDraft"("agentRunId");

ALTER TABLE "A3DocumentDraft"
ADD CONSTRAINT "A3DocumentDraft_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "A3DocumentDraft"
ADD CONSTRAINT "A3DocumentDraft_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "A3DocumentDraft"
ADD CONSTRAINT "A3DocumentDraft_agentRunId_fkey"
FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
