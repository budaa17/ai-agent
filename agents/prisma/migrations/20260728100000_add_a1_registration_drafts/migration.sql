CREATE TYPE "RegistrationSourceType" AS ENUM ('TEXT', 'IMAGE', 'TEXT_IMAGE');

CREATE TYPE "RegistrationDraftStatus" AS ENUM ('PROCESSING', 'READY_FOR_REVIEW', 'NEEDS_CORRECTION', 'APPROVED', 'REJECTED', 'FAILED');

CREATE TABLE "RegistrationDraft" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceType" "RegistrationSourceType" NOT NULL,
    "sourceText" TEXT,
    "sourceImage" BYTEA,
    "sourceFileName" TEXT,
    "sourceMediaType" TEXT,
    "sourceSha256" TEXT NOT NULL,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "status" "RegistrationDraftStatus" NOT NULL DEFAULT 'PROCESSING',
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "structuredData" JSONB,
    "confidence" JSONB,
    "validation" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "RegistrationDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RegistrationDraft_requestId_key" ON "RegistrationDraft"("requestId");

CREATE INDEX "RegistrationDraft_tenantId_status_createdAt_idx" ON "RegistrationDraft"("tenantId", "status", "createdAt");

CREATE INDEX "RegistrationDraft_projectId_createdAt_idx" ON "RegistrationDraft"("projectId", "createdAt");

CREATE INDEX "RegistrationDraft_sourceSha256_idx" ON "RegistrationDraft"("sourceSha256");

ALTER TABLE "RegistrationDraft" ADD CONSTRAINT "RegistrationDraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegistrationDraft" ADD CONSTRAINT "RegistrationDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
