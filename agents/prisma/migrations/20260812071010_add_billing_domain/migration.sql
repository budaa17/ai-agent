-- Phase 1: canonical billing domain (landing-page-roadmap.md §18, §27 Phase 1).
--
-- Additive only. No table, column, type or index is dropped or rewritten.
-- Prisma's diff also proposed dropping ten Platform Control Tower performance
-- indexes and renaming two PlatformEvaluationRun indexes; those indexes are
-- raw-SQL only (created by 20260811110000 / 20260811120000) and are not declared
-- in schema.prisma, so the proposals are pre-existing drift, not part of this
-- change. They are intentionally excluded: dropping them would silently degrade
-- the Control Tower overview queries.

-- CreateEnum
CREATE TYPE "TenantLifecycleStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'PAYMENT_GRACE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BillingProviderKind" AS ENUM ('LEMON_SQUEEZY', 'PADDLE', 'MANUAL_INVOICE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BillingEventProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CompanySignupIntentStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'CHECKOUT_STARTED', 'COMPLETED', 'EXPIRED', 'ABANDONED');

-- AlterTable
-- The column is added with DEFAULT 'ACTIVE' so that every tenant which existed
-- before billing keeps full access (roadmap §18.2, §30 step 2). The default is
-- switched to 'PENDING_PAYMENT' immediately afterwards so that tenants created
-- from now on must go through a confirmed payment.
ALTER TABLE "Tenant" ADD COLUMN     "accessChangedAt" TIMESTAMP(3),
ADD COLUMN     "accessReason" TEXT,
ADD COLUMN     "lifecycleStatus" "TenantLifecycleStatus" NOT NULL DEFAULT 'ACTIVE';

-- Grandfather the pre-billing tenants with an explicit, auditable reason.
UPDATE "Tenant"
SET "accessReason" = 'GRANDFATHERED_PRE_BILLING',
    "accessChangedAt" = CURRENT_TIMESTAMP
WHERE "accessReason" IS NULL;

ALTER TABLE "Tenant" ALTER COLUMN "lifecycleStatus" SET DEFAULT 'PENDING_PAYMENT';

-- CreateTable
CREATE TABLE "BillingPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "currency" TEXT NOT NULL,
    "unitAmountMinor" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanEntitlement" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "limitValue" BIGINT,
    "unit" TEXT,

    CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingProviderPrice" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" "BillingProviderKind" NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "externalPriceId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingProviderPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "BillingProviderKind" NOT NULL,
    "providerCustomerId" TEXT,
    "billingEmail" TEXT NOT NULL,
    "legalName" TEXT,
    "registrationNumber" TEXT,
    "vatPayer" BOOLEAN NOT NULL DEFAULT false,
    "countryCode" TEXT NOT NULL DEFAULT 'MN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" "BillingProviderKind" NOT NULL,
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "status" "SubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantEntitlementSnapshot" (
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "sourceVersion" TEXT NOT NULL,
    "entitlements" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantEntitlementSnapshot_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "CompanySignupIntent" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "desiredSlug" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "adminEmailNormalized" TEXT NOT NULL,
    "adminDisplayName" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" "BillingProviderKind" NOT NULL,
    "providerCheckoutId" TEXT,
    "status" "CompanySignupIntentStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "completedTenantId" TEXT,
    "idempotencyKeyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySignupIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "BillingProviderKind" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" "BillingEventProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "provider" "BillingProviderKind" NOT NULL,
    "providerInvoiceId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "status" "InvoiceStatus" NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotalMinor" BIGINT NOT NULL,
    "taxMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "hostedInvoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingPlan_active_public_idx" ON "BillingPlan"("active", "public");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlan_code_version_interval_key" ON "BillingPlan"("code", "version", "interval");

-- CreateIndex
CREATE UNIQUE INDEX "PlanEntitlement_planId_featureKey_key" ON "PlanEntitlement"("planId", "featureKey");

-- CreateIndex
CREATE INDEX "BillingProviderPrice_planId_idx" ON "BillingProviderPrice"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingProviderPrice_provider_environment_externalPriceId_key" ON "BillingProviderPrice"("provider", "environment", "externalPriceId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingProviderPrice_planId_provider_environment_key" ON "BillingProviderPrice"("planId", "provider", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_tenantId_key" ON "BillingCustomer"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_provider_providerCustomerId_key" ON "BillingCustomer"("provider", "providerCustomerId");

-- CreateIndex
CREATE INDEX "TenantSubscription_tenantId_status_currentPeriodEnd_idx" ON "TenantSubscription"("tenantId", "status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "TenantSubscription_status_graceEndsAt_idx" ON "TenantSubscription"("status", "graceEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_provider_providerSubscriptionId_key" ON "TenantSubscription"("provider", "providerSubscriptionId");

-- CreateIndex
CREATE INDEX "TenantEntitlementSnapshot_effectiveUntil_idx" ON "TenantEntitlementSnapshot"("effectiveUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySignupIntent_providerCheckoutId_key" ON "CompanySignupIntent"("providerCheckoutId");

-- CreateIndex
CREATE INDEX "CompanySignupIntent_adminEmailNormalized_status_idx" ON "CompanySignupIntent"("adminEmailNormalized", "status");

-- CreateIndex
CREATE INDEX "CompanySignupIntent_expiresAt_status_idx" ON "CompanySignupIntent"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "BillingWebhookEvent_status_receivedAt_idx" ON "BillingWebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingWebhookEvent_provider_providerEventId_key" ON "BillingWebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "BillingInvoice_tenantId_createdAt_idx" ON "BillingInvoice"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingInvoice_subscriptionId_idx" ON "BillingInvoice"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_provider_providerInvoiceId_key" ON "BillingInvoice"("provider", "providerInvoiceId");

-- CreateIndex
CREATE INDEX "Tenant_lifecycleStatus_idx" ON "Tenant"("lifecycleStatus");

-- AddForeignKey
ALTER TABLE "PlanEntitlement" ADD CONSTRAINT "PlanEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingProviderPrice" ADD CONSTRAINT "BillingProviderPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCustomer" ADD CONSTRAINT "BillingCustomer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantEntitlementSnapshot" ADD CONSTRAINT "TenantEntitlementSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySignupIntent" ADD CONSTRAINT "CompanySignupIntent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "TenantSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Canonical subscription invariant (roadmap §18.4): at any instant a tenant has
-- at most one subscription in a state that can grant access. CANCELED and
-- EXPIRED rows are terminal history and may accumulate freely.
CREATE UNIQUE INDEX "TenantSubscription_one_canonical_per_tenant_key"
ON "TenantSubscription"("tenantId")
WHERE "status" IN ('PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED');

-- Money and period integrity. Prisma does not model CHECK constraints, so these
-- are database-level guards against projection bugs in the webhook pipeline.
ALTER TABLE "BillingPlan"
ADD CONSTRAINT "BillingPlan_unit_amount_non_negative_check"
CHECK ("unitAmountMinor" IS NULL OR "unitAmountMinor" >= 0);

-- A publicly listed plan must carry a price; Enterprise stays non-public with a
-- negotiated amount, so the landing page can never render a priceless card.
ALTER TABLE "BillingPlan"
ADD CONSTRAINT "BillingPlan_public_requires_amount_check"
CHECK (NOT "public" OR "unitAmountMinor" IS NOT NULL);

ALTER TABLE "PlanEntitlement"
ADD CONSTRAINT "PlanEntitlement_limit_non_negative_check"
CHECK ("limitValue" IS NULL OR "limitValue" >= 0);

ALTER TABLE "BillingInvoice"
ADD CONSTRAINT "BillingInvoice_total_matches_components_check"
CHECK ("totalMinor" = "subtotalMinor" + "taxMinor");

ALTER TABLE "TenantSubscription"
ADD CONSTRAINT "TenantSubscription_period_order_check"
CHECK (
  "currentPeriodStart" IS NULL
  OR "currentPeriodEnd" IS NULL
  OR "currentPeriodEnd" > "currentPeriodStart"
);
