ALTER TYPE "AgentRunStatus" ADD VALUE IF NOT EXISTS 'DEGRADED';
ALTER TYPE "AgentToolCallStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "AgentRun"
  ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'REQUEST',
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "eventId" TEXT,
  ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "toolBundleVersion" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "outputSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "inputTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outputTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "estimatedCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "actualCostMicroUsd" INTEGER,
  ADD COLUMN "latencyMs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failureCategory" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "traceId" TEXT,
  ADD COLUMN "dataSnapshotVersion" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "outputSha256" TEXT,
  ADD COLUMN "contentLoggingEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AgentToolCall"
  ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "authorizedScopeSha256" TEXT,
  ADD COLUMN "argumentsSha256" TEXT,
  ADD COLUMN "rowCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "returnedRowCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "truncated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "outputSha256" TEXT,
  ADD COLUMN "failureCategory" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "AgentFeedback" (
  "id" TEXT NOT NULL,
  "agentRunId" TEXT,
  "tenantId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "agentType" TEXT NOT NULL,
  "feedbackType" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "fieldPath" TEXT,
  "beforeValue" JSONB,
  "afterValue" JSONB,
  "reason" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "modelVersion" TEXT,
  "toolBundleVersion" TEXT NOT NULL,
  "dataSnapshotVersion" TEXT NOT NULL,
  "regressionStatus" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentUsageBudget" (
  "tenantId" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "usedMicroUsd" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentUsageBudget_pkey" PRIMARY KEY ("tenantId", "month")
);

CREATE INDEX "AgentRun_tenantId_requestId_idx"
  ON "AgentRun"("tenantId", "requestId");
CREATE INDEX "AgentRun_tenantId_eventId_idx"
  ON "AgentRun"("tenantId", "eventId");
CREATE INDEX "AgentRun_failureCategory_startedAt_idx"
  ON "AgentRun"("failureCategory", "startedAt");
CREATE INDEX "AgentRun_traceId_idx" ON "AgentRun"("traceId");
CREATE INDEX "AgentToolCall_toolName_status_occurredAt_idx"
  ON "AgentToolCall"("toolName", "status", "occurredAt");
CREATE INDEX "AgentFeedback_tenantId_projectId_agentType_reviewedAt_idx"
  ON "AgentFeedback"("tenantId", "projectId", "agentType", "reviewedAt");
CREATE INDEX "AgentFeedback_artifactId_reviewedAt_idx"
  ON "AgentFeedback"("artifactId", "reviewedAt");
CREATE INDEX "AgentFeedback_regressionStatus_reviewedAt_idx"
  ON "AgentFeedback"("regressionStatus", "reviewedAt");
CREATE INDEX "AgentUsageBudget_month_usedMicroUsd_idx"
  ON "AgentUsageBudget"("month", "usedMicroUsd");

ALTER TABLE "AgentFeedback"
  ADD CONSTRAINT "AgentFeedback_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentFeedback"
  ADD CONSTRAINT "AgentFeedback_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentFeedback"
  ADD CONSTRAINT "AgentFeedback_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentUsageBudget"
  ADD CONSTRAINT "AgentUsageBudget_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
