CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'REJECTED', 'FAILED');

CREATE TYPE "AgentToolCallStatus" AS ENUM ('COMPLETED', 'FAILED');

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "request" JSONB NOT NULL,
    "researchText" TEXT,
    "output" JSONB,
    "validation" JSONB,
    "errorMessage" TEXT,
    "langfuseTraceId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" "AgentToolCallStatus" NOT NULL,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentRun_tenantId_projectId_startedAt_idx" ON "AgentRun"("tenantId", "projectId", "startedAt");

CREATE INDEX "AgentRun_status_startedAt_idx" ON "AgentRun"("status", "startedAt");

CREATE INDEX "AgentRun_langfuseTraceId_idx" ON "AgentRun"("langfuseTraceId");

CREATE UNIQUE INDEX "AgentToolCall_agentRunId_toolCallId_key" ON "AgentToolCall"("agentRunId", "toolCallId");

CREATE INDEX "AgentToolCall_agentRunId_stepNumber_idx" ON "AgentToolCall"("agentRunId", "stepNumber");

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
