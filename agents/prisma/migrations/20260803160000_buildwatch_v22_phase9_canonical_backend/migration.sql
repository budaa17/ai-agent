-- CreateEnum
CREATE TYPE "IdentityRole" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'PROJECT_MANAGER', 'ENGINEER', 'SITE_SUPERVISOR', 'STOREKEEPER', 'OBSERVER');

-- CreateEnum
CREATE TYPE "IdentityUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SecurityTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "VersionLifecycleStatus" AS ENUM ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'APPLIED', 'SUPERSEDED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewTargetType" AS ENUM ('QUANTITY_TAKEOFF', 'ESTIMATE', 'SCHEDULE', 'BASELINE', 'DAILY_WORK_PLAN', 'DAILY_REPORT', 'PROGRESS_VERIFICATION', 'RECOVERY_SCENARIO');

-- CreateEnum
CREATE TYPE "ReviewTaskStatus" AS ENUM ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'APPLIED', 'SUPERSEDED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewDecisionType" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'CANCEL', 'APPLY', 'SUPERSEDE', 'CORRECT');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "FileAssetStatus" AS ENUM ('PENDING', 'AVAILABLE', 'QUARANTINED', 'DELETED');

-- CreateEnum
CREATE TYPE "DesignDocumentType" AS ENUM ('DRAWING', 'SPECIFICATION', 'BOQ', 'METHOD_STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PhotoEvidenceStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'LINKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- CreateEnum
CREATE TYPE "AppliedCommandStatus" AS ENUM ('APPLIED', 'REPLAYED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "tenantRole" "IdentityRole" NOT NULL DEFAULT 'OBSERVER',
    "status" "IdentityUserStatus" NOT NULL DEFAULT 'INVITED',
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCredential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TenantInvitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "role" "IdentityRole" NOT NULL,
    "projectIds" TEXT[] NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantInvitation_pkey" PRIMARY KEY ("id")
);

-- Add optimistic concurrency to the existing canonical project row.
ALTER TABLE "Project" ADD COLUMN "rowVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "IdentityRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
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

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SecurityTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "FileAssetStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedByUserId" TEXT NOT NULL,
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactAccessGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileAssetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileAssetId" TEXT NOT NULL,
    "documentCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "DesignDocumentType" NOT NULL,
    "classification" JSONB,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "currentRevisionId" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DesignDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revisionCode" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "supersedesId" TEXT,
    "sourceSha256" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingPage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "pageLabel" TEXT,
    "widthPoints" DECIMAL(18,6),
    "heightPoints" DECIMAL(18,6),
    "rasterObjectKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingScale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "scaleText" TEXT,
    "drawingDistance" DECIMAL(18,6) NOT NULL,
    "realDistance" DECIMAL(18,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "status" "SourceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "sourceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawingScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignElement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "elementType" TEXT NOT NULL,
    "elementCode" TEXT,
    "label" TEXT,
    "properties" JSONB NOT NULL,
    "confidence" DECIMAL(5,4),
    "verificationStatus" "SourceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementGeometry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "geometryType" TEXT NOT NULL,
    "coordinates" JSONB NOT NULL,
    "unit" TEXT,
    "area" DECIMAL(18,6),
    "length" DECIMAL(18,6),
    "volume" DECIMAL(18,6),

    CONSTRAINT "ElementGeometry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElementSourceRef" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "fileAssetId" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "region" JSONB,
    "sourceSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ElementSourceRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuantityTakeoffVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceRevisionIds" TEXT[],
    "formulaVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "totalQuantityHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuantityTakeoffVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuantityTakeoffItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "designElementId" TEXT,
    "workCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(24,8) NOT NULL,
    "formulaCode" TEXT NOT NULL,
    "formulaInputs" JSONB NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "verificationStatus" "SourceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuantityTakeoffItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoffAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "quantityDelta" DECIMAL(24,8) NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceRef" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TakeoffAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialCatalog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialCatalogVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceReference" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialCatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "specification" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MaterialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialAlias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "materialItemId" TEXT NOT NULL,
    "aliasNormalized" TEXT NOT NULL,
    "language" TEXT,

    CONSTRAINT "MaterialAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormCatalog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormCatalogVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceReference" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormCatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkNorm" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "normVersionId" TEXT NOT NULL,
    "workCode" TEXT NOT NULL,
    "materialItemId" TEXT NOT NULL,
    "outputUnit" TEXT NOT NULL,
    "materialUnit" TEXT NOT NULL,
    "quantityPerOutput" DECIMAL(24,8) NOT NULL,
    "wastePercent" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "assumptions" JSONB,

    CONSTRAINT "WorkNorm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductivityRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "normVersionId" TEXT NOT NULL,
    "workCode" TEXT NOT NULL,
    "outputUnit" TEXT NOT NULL,
    "crewType" TEXT NOT NULL,
    "outputPerCrewHour" DECIMAL(24,8) NOT NULL,
    "crewSize" INTEGER NOT NULL,
    "assumptions" JSONB,

    CONSTRAINT "ProductivityRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceCatalog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceCatalogVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceReference" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceCatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceCatalogEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "materialItemId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(24,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "supplierName" TEXT,
    "quotationRef" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),

    CONSTRAINT "PriceCatalogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "quantityVersionId" TEXT NOT NULL,
    "normCatalogVersionId" TEXT NOT NULL,
    "priceCatalogVersionId" TEXT NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "subtotal" DECIMAL(24,2) NOT NULL,
    "taxAmount" DECIMAL(24,2) NOT NULL,
    "contingencyAmount" DECIMAL(24,2) NOT NULL,
    "totalAmount" DECIMAL(24,2) NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "estimateVersionId" TEXT NOT NULL,
    "lineCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(24,8) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(24,6) NOT NULL,
    "amount" DECIMAL(24,2) NOT NULL,
    "sourceRefs" JSONB NOT NULL,

    CONSTRAINT "EstimateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateAssumption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "estimateVersionId" TEXT NOT NULL,
    "assumptionCode" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "sourceRef" JSONB NOT NULL,

    CONSTRAINT "EstimateAssumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateScenario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "estimateVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "totalAmount" DECIMAL(24,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EstimateScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "calendarVersion" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedFinish" TIMESTAMP(3) NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleActivity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scheduleVersionId" TEXT NOT NULL,
    "workItemId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedFinish" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "totalFloatMinutes" INTEGER NOT NULL,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "quantity" DECIMAL(24,8),
    "unit" TEXT,

    CONSTRAINT "ScheduleActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleDependency" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scheduleVersionId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "lagMinutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScheduleDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceRequirement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceCode" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "ResourceRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaselineVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "quantityVersionId" TEXT NOT NULL,
    "estimateVersionId" TEXT NOT NULL,
    "scheduleVersionId" TEXT NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaselineVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewAvailability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "availableDate" DATE NOT NULL,
    "availableMinutes" INTEGER NOT NULL,
    "shiftCode" TEXT,
    "reason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CrewAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "equipmentType" TEXT NOT NULL,
    "capacity" DECIMAL(18,4),
    "capacityUnit" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentAvailability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "availableDate" DATE NOT NULL,
    "availableMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "EquipmentAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyWorkPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "planDate" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "baselineVersionId" TEXT NOT NULL,
    "scheduleVersionId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyWorkPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyWorkPlanItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "activityId" TEXT,
    "sequence" INTEGER NOT NULL,
    "plannedQuantity" DECIMAL(24,8) NOT NULL,
    "unit" TEXT NOT NULL,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedFinish" TIMESTAMP(3) NOT NULL,
    "locationCode" TEXT,
    "decisionReason" TEXT NOT NULL,

    CONSTRAINT "DailyWorkPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPlanResource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "planItemId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "finishAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPlanResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPlanMaterial" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "planItemId" TEXT NOT NULL,
    "materialItemId" TEXT NOT NULL,
    "requiredQuantity" DECIMAL(24,8) NOT NULL,
    "availableQuantity" DECIMAL(24,8) NOT NULL,
    "unit" TEXT NOT NULL,
    "shortageQuantity" DECIMAL(24,8) NOT NULL DEFAULT 0,

    CONSTRAINT "DailyPlanMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPlanPrecondition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "planItemId" TEXT NOT NULL,
    "preconditionType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "satisfied" BOOLEAN NOT NULL,
    "sourceRef" JSONB,

    CONSTRAINT "DailyPlanPrecondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceDraftId" TEXT,
    "sourceHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "narrative" TEXT,
    "weather" JSONB,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "submittedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dailyReportId" TEXT NOT NULL,
    "planItemId" TEXT,
    "workItemId" TEXT NOT NULL,
    "quantity" DECIMAL(24,8) NOT NULL,
    "unit" TEXT NOT NULL,
    "progressPercent" DECIMAL(7,4),
    "sourceRefs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dailyReportId" TEXT NOT NULL,
    "crewId" TEXT,
    "trade" TEXT NOT NULL,
    "workerCount" INTEGER NOT NULL,
    "hoursPerWorker" DECIMAL(8,2) NOT NULL,
    "laborRate" DECIMAL(18,2),
    "sourceRefs" JSONB NOT NULL,

    CONSTRAINT "AttendanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "materialItemId" TEXT NOT NULL,
    "movementType" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(24,8) NOT NULL,
    "unit" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "reason" TEXT NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dailyReportId" TEXT,
    "fileAssetId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "orientation" INTEGER,
    "deviceMetadata" JSONB,
    "status" "PhotoEvidenceStatus" NOT NULL DEFAULT 'UPLOADED',
    "sha256" TEXT NOT NULL,
    "perceptualHash" TEXT,
    "sourceHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoEvidenceLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "planItemId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "sourceRegion" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoEvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoQualityAssessment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "blurScore" DECIMAL(5,4) NOT NULL,
    "exposureScore" DECIMAL(5,4) NOT NULL,
    "framingScore" DECIMAL(5,4) NOT NULL,
    "acceptable" BOOLEAN NOT NULL,
    "issues" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoQualityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoDuplicateFinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "candidatePhotoId" TEXT NOT NULL,
    "hammingDistance" INTEGER NOT NULL,
    "isDuplicate" BOOLEAN NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoDuplicateFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressVerification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "verificationDate" DATE NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "methodVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "claimedPercent" DECIMAL(7,4),
    "verifiedPercent" DECIMAL(7,4),
    "confidence" DECIMAL(5,4),
    "decision" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressVerificationIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "issueCode" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "blocksApproval" BOOLEAN NOT NULL,
    "details" JSONB NOT NULL,
    "sourceRefs" JSONB NOT NULL,

    CONSTRAINT "ProgressVerificationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyVariance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "varianceDate" DATE NOT NULL,
    "workItemId" TEXT NOT NULL,
    "plannedQuantity" DECIMAL(24,8) NOT NULL,
    "actualQuantity" DECIMAL(24,8) NOT NULL,
    "quantityVariance" DECIMAL(24,8) NOT NULL,
    "scheduleVarianceMinutes" INTEGER NOT NULL,
    "costVariance" DECIMAL(24,2),
    "sourceRefs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyVariance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "methodVersion" TEXT NOT NULL,
    "thresholdVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "projectedFinish" TIMESTAMP(3),
    "delayDays" DECIMAL(12,4),
    "confidence" DECIMAL(5,4),
    "sourceHash" TEXT NOT NULL,
    "baselineVersionId" TEXT NOT NULL,
    "scheduleVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastWorkItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "forecastId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "remainingQuantity" DECIMAL(24,8),
    "rollingProductivity" DECIMAL(24,8),
    "projectedFinish" TIMESTAMP(3),
    "delayDays" DECIMAL(12,4),
    "isCritical" BOOLEAN NOT NULL,
    "confidence" DECIMAL(5,4),
    "method" TEXT NOT NULL,

    CONSTRAINT "ForecastWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastDriver" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "forecastId" TEXT NOT NULL,
    "driverCode" TEXT NOT NULL,
    "contribution" DECIMAL(12,4) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceRefs" JSONB NOT NULL,

    CONSTRAINT "ForecastDriver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryScenario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "forecastId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "changes" JSONB NOT NULL,
    "projectedFinish" TIMESTAMP(3),
    "delayReductionDays" DECIMAL(12,4),
    "costImpact" DECIMAL(24,2),
    "baselineChanged" BOOLEAN NOT NULL DEFAULT false,
    "sourceHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalMatrix" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetType" "ReviewTargetType" NOT NULL,
    "submitterRoles" "IdentityRole"[],
    "reviewerRoles" "IdentityRole"[],
    "approverRoles" "IdentityRole"[],
    "applyRoles" "IdentityRole"[],
    "prohibitSelfApproval" BOOLEAN NOT NULL DEFAULT true,
    "emergencyOverrideRoles" "IdentityRole"[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "targetType" "ReviewTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetVersion" INTEGER NOT NULL,
    "status" "ReviewTaskStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "assignedRole" "IdentityRole" NOT NULL,
    "assignedUserId" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reviewTaskId" TEXT NOT NULL,
    "decision" "ReviewDecisionType" NOT NULL,
    "fromStatus" "ReviewTaskStatus" NOT NULL,
    "toStatus" "ReviewTaskStatus" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" "IdentityRole" NOT NULL,
    "reason" TEXT NOT NULL,
    "emergencyOverride" BOOLEAN NOT NULL DEFAULT false,
    "sourceHash" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCorrection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reviewTaskId" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "reason" TEXT NOT NULL,
    "correctedByUserId" TEXT NOT NULL,
    "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppliedCommand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reviewTaskId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "targetType" "ReviewTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetVersion" INTEGER NOT NULL,
    "expectedRowVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "status" "AppliedCommandStatus" NOT NULL DEFAULT 'APPLIED',
    "actorUserId" TEXT NOT NULL,
    "actorRole" "IdentityRole" NOT NULL,
    "reason" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "actorUserId" TEXT,
    "actorRole" "IdentityRole",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "correlationId" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "beforeHash" TEXT,
    "afterHash" TEXT,
    "metadata" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateVersion" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumedEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "eventId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_tenantId_status_idx" ON "User"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_emailNormalized_key" ON "User"("tenantId", "emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TenantInvitation_tokenHash_key" ON "TenantInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "TenantInvitation_tenantId_expiresAt_idx" ON "TenantInvitation"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "TenantInvitation_tenantId_emailNormalized_status_idx" ON "TenantInvitation"("tenantId", "emailNormalized", "status");

CREATE UNIQUE INDEX "TenantInvitation_one_pending_email_key"
ON "TenantInvitation"("tenantId", "emailNormalized")
WHERE "status" = 'PENDING';

-- CreateIndex
CREATE INDEX "ProjectMember_tenantId_projectId_role_active_idx" ON "ProjectMember"("tenantId", "projectId", "role", "active");

-- CreateIndex
CREATE INDEX "ProjectMember_tenantId_userId_active_idx" ON "ProjectMember"("tenantId", "userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_tenantId_userId_expiresAt_idx" ON "RefreshSession"("tenantId", "userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RefreshSession_tenantId_familyId_idx" ON "RefreshSession"("tenantId", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityToken_tokenHash_key" ON "SecurityToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SecurityToken_tenantId_userId_type_expiresAt_idx" ON "SecurityToken"("tenantId", "userId", "type", "expiresAt");

-- CreateIndex
CREATE INDEX "FileAsset_tenantId_projectId_status_createdAt_idx" ON "FileAsset"("tenantId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FileAsset_sha256_idx" ON "FileAsset"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "FileAsset_tenantId_projectId_id_key" ON "FileAsset"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FileAsset_tenantId_projectId_objectKey_key" ON "FileAsset"("tenantId", "projectId", "objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactAccessGrant_nonceHash_key" ON "ArtifactAccessGrant"("nonceHash");

-- CreateIndex
CREATE INDEX "ArtifactAccessGrant_tenantId_projectId_userId_expiresAt_idx" ON "ArtifactAccessGrant"("tenantId", "projectId", "userId", "expiresAt");

-- CreateIndex
CREATE INDEX "DesignDocument_tenantId_projectId_status_idx" ON "DesignDocument"("tenantId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DesignDocument_tenantId_projectId_id_key" ON "DesignDocument"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DesignDocument_projectId_documentCode_key" ON "DesignDocument"("projectId", "documentCode");

-- CreateIndex
CREATE INDEX "DrawingRevision_tenantId_projectId_status_effectiveFrom_idx" ON "DrawingRevision"("tenantId", "projectId", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingRevision_tenantId_projectId_id_key" ON "DrawingRevision"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingRevision_documentId_revisionCode_key" ON "DrawingRevision"("documentId", "revisionCode");

-- CreateIndex
CREATE INDEX "DrawingPage_tenantId_projectId_revisionId_idx" ON "DrawingPage"("tenantId", "projectId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingPage_tenantId_projectId_id_key" ON "DrawingPage"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingPage_revisionId_pageNumber_key" ON "DrawingPage"("revisionId", "pageNumber");

-- CreateIndex
CREATE INDEX "DrawingScale_tenantId_projectId_pageId_status_idx" ON "DrawingScale"("tenantId", "projectId", "pageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingScale_tenantId_projectId_id_key" ON "DrawingScale"("tenantId", "projectId", "id");

-- CreateIndex
CREATE INDEX "DesignElement_tenantId_projectId_pageId_elementType_idx" ON "DesignElement"("tenantId", "projectId", "pageId", "elementType");

-- CreateIndex
CREATE UNIQUE INDEX "DesignElement_tenantId_projectId_id_key" ON "DesignElement"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ElementGeometry_tenantId_projectId_elementId_key" ON "ElementGeometry"("tenantId", "projectId", "elementId");

-- CreateIndex
CREATE INDEX "ElementSourceRef_tenantId_projectId_elementId_idx" ON "ElementSourceRef"("tenantId", "projectId", "elementId");

-- CreateIndex
CREATE UNIQUE INDEX "ElementSourceRef_elementId_fileAssetId_sourceSha256_key" ON "ElementSourceRef"("elementId", "fileAssetId", "sourceSha256");

-- CreateIndex
CREATE INDEX "QuantityTakeoffVersion_tenantId_projectId_status_createdAt_idx" ON "QuantityTakeoffVersion"("tenantId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuantityTakeoffVersion_tenantId_projectId_id_key" ON "QuantityTakeoffVersion"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "QuantityTakeoffVersion_projectId_versionNumber_key" ON "QuantityTakeoffVersion"("projectId", "versionNumber");

-- CreateIndex
CREATE INDEX "QuantityTakeoffItem_tenantId_projectId_versionId_workCode_idx" ON "QuantityTakeoffItem"("tenantId", "projectId", "versionId", "workCode");

-- CreateIndex
CREATE INDEX "QuantityTakeoffItem_designElementId_idx" ON "QuantityTakeoffItem"("designElementId");

-- CreateIndex
CREATE UNIQUE INDEX "QuantityTakeoffItem_tenantId_projectId_id_key" ON "QuantityTakeoffItem"("tenantId", "projectId", "id");

-- CreateIndex
CREATE INDEX "TakeoffAdjustment_tenantId_projectId_itemId_idx" ON "TakeoffAdjustment"("tenantId", "projectId", "itemId");

-- CreateIndex
CREATE INDEX "MaterialCatalog_tenantId_createdAt_idx" ON "MaterialCatalog"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCatalog_tenantId_code_key" ON "MaterialCatalog"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCatalog_tenantId_id_key" ON "MaterialCatalog"("tenantId", "id");

-- CreateIndex
CREATE INDEX "MaterialCatalogVersion_tenantId_status_effectiveFrom_idx" ON "MaterialCatalogVersion"("tenantId", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCatalogVersion_tenantId_id_key" ON "MaterialCatalogVersion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCatalogVersion_catalogId_versionNumber_key" ON "MaterialCatalogVersion"("catalogId", "versionNumber");

-- CreateIndex
CREATE INDEX "MaterialItem_tenantId_canonicalName_idx" ON "MaterialItem"("tenantId", "canonicalName");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialItem_tenantId_id_key" ON "MaterialItem"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialItem_catalogVersionId_code_key" ON "MaterialItem"("catalogVersionId", "code");

-- CreateIndex
CREATE INDEX "MaterialAlias_tenantId_materialItemId_idx" ON "MaterialAlias"("tenantId", "materialItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialAlias_tenantId_aliasNormalized_key" ON "MaterialAlias"("tenantId", "aliasNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "NormCatalog_tenantId_code_key" ON "NormCatalog"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "NormCatalog_tenantId_id_key" ON "NormCatalog"("tenantId", "id");

-- CreateIndex
CREATE INDEX "NormCatalogVersion_tenantId_status_effectiveFrom_idx" ON "NormCatalogVersion"("tenantId", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "NormCatalogVersion_tenantId_id_key" ON "NormCatalogVersion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NormCatalogVersion_catalogId_versionNumber_key" ON "NormCatalogVersion"("catalogId", "versionNumber");

-- CreateIndex
CREATE INDEX "WorkNorm_tenantId_workCode_idx" ON "WorkNorm"("tenantId", "workCode");

-- CreateIndex
CREATE UNIQUE INDEX "WorkNorm_normVersionId_workCode_materialItemId_key" ON "WorkNorm"("normVersionId", "workCode", "materialItemId");

-- CreateIndex
CREATE INDEX "ProductivityRate_tenantId_workCode_idx" ON "ProductivityRate"("tenantId", "workCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductivityRate_normVersionId_workCode_crewType_key" ON "ProductivityRate"("normVersionId", "workCode", "crewType");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCatalog_tenantId_code_key" ON "PriceCatalog"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCatalog_tenantId_id_key" ON "PriceCatalog"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PriceCatalogVersion_tenantId_status_effectiveFrom_idx" ON "PriceCatalogVersion"("tenantId", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCatalogVersion_tenantId_id_key" ON "PriceCatalogVersion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCatalogVersion_catalogId_versionNumber_key" ON "PriceCatalogVersion"("catalogId", "versionNumber");

-- CreateIndex
CREATE INDEX "PriceCatalogEntry_tenantId_materialItemId_validFrom_idx" ON "PriceCatalogEntry"("tenantId", "materialItemId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCatalogEntry_catalogVersionId_materialItemId_validFrom_key" ON "PriceCatalogEntry"("catalogVersionId", "materialItemId", "validFrom");

-- CreateIndex
CREATE INDEX "EstimateVersion_tenantId_projectId_status_createdAt_idx" ON "EstimateVersion"("tenantId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EstimateVersion_tenantId_projectId_id_key" ON "EstimateVersion"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EstimateVersion_projectId_versionNumber_key" ON "EstimateVersion"("projectId", "versionNumber");

-- CreateIndex
CREATE INDEX "EstimateLine_tenantId_projectId_estimateVersionId_category_idx" ON "EstimateLine"("tenantId", "projectId", "estimateVersionId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "EstimateLine_estimateVersionId_lineCode_key" ON "EstimateLine"("estimateVersionId", "lineCode");

-- CreateIndex
CREATE INDEX "EstimateAssumption_tenantId_projectId_estimateVersionId_idx" ON "EstimateAssumption"("tenantId", "projectId", "estimateVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "EstimateAssumption_estimateVersionId_assumptionCode_key" ON "EstimateAssumption"("estimateVersionId", "assumptionCode");

-- CreateIndex
CREATE INDEX "EstimateScenario_tenantId_projectId_estimateVersionId_idx" ON "EstimateScenario"("tenantId", "projectId", "estimateVersionId");

-- CreateIndex
CREATE INDEX "ScheduleVersion_tenantId_projectId_status_createdAt_idx" ON "ScheduleVersion"("tenantId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleVersion_tenantId_projectId_id_key" ON "ScheduleVersion"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleVersion_projectId_versionNumber_key" ON "ScheduleVersion"("projectId", "versionNumber");

-- CreateIndex
CREATE INDEX "ScheduleActivity_tenantId_projectId_scheduleVersionId_isCri_idx" ON "ScheduleActivity"("tenantId", "projectId", "scheduleVersionId", "isCritical");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleActivity_tenantId_projectId_id_key" ON "ScheduleActivity"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleActivity_scheduleVersionId_code_key" ON "ScheduleActivity"("scheduleVersionId", "code");

-- CreateIndex
CREATE INDEX "ScheduleDependency_tenantId_projectId_scheduleVersionId_idx" ON "ScheduleDependency"("tenantId", "projectId", "scheduleVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleDependency_scheduleVersionId_predecessorId_successo_key" ON "ScheduleDependency"("scheduleVersionId", "predecessorId", "successorId", "type");

-- CreateIndex
CREATE INDEX "ResourceRequirement_tenantId_projectId_activityId_resourceT_idx" ON "ResourceRequirement"("tenantId", "projectId", "activityId", "resourceType");

-- CreateIndex
CREATE INDEX "BaselineVersion_tenantId_projectId_status_createdAt_idx" ON "BaselineVersion"("tenantId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BaselineVersion_tenantId_projectId_id_key" ON "BaselineVersion"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BaselineVersion_projectId_versionNumber_key" ON "BaselineVersion"("projectId", "versionNumber");

-- CreateIndex
CREATE INDEX "Crew_tenantId_projectId_active_idx" ON "Crew"("tenantId", "projectId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Crew_tenantId_projectId_id_key" ON "Crew"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Crew_projectId_code_key" ON "Crew"("projectId", "code");

-- CreateIndex
CREATE INDEX "CrewAvailability_tenantId_projectId_availableDate_idx" ON "CrewAvailability"("tenantId", "projectId", "availableDate");

-- CreateIndex
CREATE UNIQUE INDEX "CrewAvailability_crewId_availableDate_shiftCode_key" ON "CrewAvailability"("crewId", "availableDate", "shiftCode");

-- CreateIndex
CREATE INDEX "Equipment_tenantId_projectId_active_idx" ON "Equipment"("tenantId", "projectId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_tenantId_projectId_id_key" ON "Equipment"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_projectId_code_key" ON "Equipment"("projectId", "code");

-- CreateIndex
CREATE INDEX "EquipmentAvailability_tenantId_projectId_availableDate_stat_idx" ON "EquipmentAvailability"("tenantId", "projectId", "availableDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentAvailability_equipmentId_availableDate_key" ON "EquipmentAvailability"("equipmentId", "availableDate");

-- CreateIndex
CREATE INDEX "DailyWorkPlan_tenantId_projectId_planDate_status_idx" ON "DailyWorkPlan"("tenantId", "projectId", "planDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyWorkPlan_tenantId_projectId_id_key" ON "DailyWorkPlan"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DailyWorkPlan_tenantId_projectId_idempotencyKey_key" ON "DailyWorkPlan"("tenantId", "projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "DailyWorkPlanItem_tenantId_projectId_planId_sequence_idx" ON "DailyWorkPlanItem"("tenantId", "projectId", "planId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "DailyWorkPlanItem_tenantId_projectId_id_key" ON "DailyWorkPlanItem"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DailyWorkPlanItem_planId_workItemId_key" ON "DailyWorkPlanItem"("planId", "workItemId");

-- CreateIndex
CREATE INDEX "DailyPlanResource_tenantId_projectId_resourceType_resourceI_idx" ON "DailyPlanResource"("tenantId", "projectId", "resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlanResource_planItemId_resourceType_resourceId_key" ON "DailyPlanResource"("planItemId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "DailyPlanMaterial_tenantId_projectId_materialItemId_idx" ON "DailyPlanMaterial"("tenantId", "projectId", "materialItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlanMaterial_planItemId_materialItemId_key" ON "DailyPlanMaterial"("planItemId", "materialItemId");

-- CreateIndex
CREATE INDEX "DailyPlanPrecondition_tenantId_projectId_planItemId_satisfi_idx" ON "DailyPlanPrecondition"("tenantId", "projectId", "planItemId", "satisfied");

-- CreateIndex
CREATE INDEX "DailyReport_tenantId_projectId_reportDate_status_idx" ON "DailyReport"("tenantId", "projectId", "reportDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_tenantId_projectId_id_key" ON "DailyReport"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_tenantId_projectId_idempotencyKey_key" ON "DailyReport"("tenantId", "projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProgressEntry_tenantId_projectId_workItemId_createdAt_idx" ON "ProgressEntry"("tenantId", "projectId", "workItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressEntry_dailyReportId_workItemId_key" ON "ProgressEntry"("dailyReportId", "workItemId");

-- CreateIndex
CREATE INDEX "AttendanceEntry_tenantId_projectId_dailyReportId_trade_idx" ON "AttendanceEntry"("tenantId", "projectId", "dailyReportId", "trade");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_projectId_materialItemId_occurredAt_idx" ON "StockMovement"("tenantId", "projectId", "materialItemId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_reversalOfId_idx" ON "StockMovement"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_tenantId_projectId_id_key" ON "StockMovement"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_tenantId_projectId_idempotencyKey_key" ON "StockMovement"("tenantId", "projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PhotoEvidence_tenantId_projectId_capturedAt_status_idx" ON "PhotoEvidence"("tenantId", "projectId", "capturedAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoEvidence_tenantId_projectId_id_key" ON "PhotoEvidence"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoEvidence_projectId_sha256_key" ON "PhotoEvidence"("projectId", "sha256");

-- CreateIndex
CREATE INDEX "PhotoEvidenceLink_tenantId_projectId_planItemId_idx" ON "PhotoEvidenceLink"("tenantId", "projectId", "planItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoEvidenceLink_photoId_planItemId_linkType_key" ON "PhotoEvidenceLink"("photoId", "planItemId", "linkType");

-- CreateIndex
CREATE INDEX "PhotoQualityAssessment_tenantId_projectId_acceptable_idx" ON "PhotoQualityAssessment"("tenantId", "projectId", "acceptable");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoQualityAssessment_tenantId_projectId_photoId_key" ON "PhotoQualityAssessment"("tenantId", "projectId", "photoId");

-- CreateIndex
CREATE INDEX "PhotoDuplicateFinding_tenantId_projectId_isDuplicate_idx" ON "PhotoDuplicateFinding"("tenantId", "projectId", "isDuplicate");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoDuplicateFinding_photoId_candidatePhotoId_key" ON "PhotoDuplicateFinding"("photoId", "candidatePhotoId");

-- CreateIndex
CREATE INDEX "ProgressVerification_tenantId_projectId_verificationDate_st_idx" ON "ProgressVerification"("tenantId", "projectId", "verificationDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressVerification_tenantId_projectId_id_key" ON "ProgressVerification"("tenantId", "projectId", "id");

-- CreateIndex
CREATE INDEX "ProgressVerificationIssue_tenantId_projectId_verificationId_idx" ON "ProgressVerificationIssue"("tenantId", "projectId", "verificationId", "blocksApproval");

-- CreateIndex
CREATE INDEX "DailyVariance_tenantId_projectId_varianceDate_idx" ON "DailyVariance"("tenantId", "projectId", "varianceDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyVariance_projectId_varianceDate_workItemId_key" ON "DailyVariance"("projectId", "varianceDate", "workItemId");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_tenantId_projectId_asOf_idx" ON "ForecastSnapshot"("tenantId", "projectId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshot_tenantId_projectId_id_key" ON "ForecastSnapshot"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshot_projectId_asOf_methodVersion_key" ON "ForecastSnapshot"("projectId", "asOf", "methodVersion");

-- CreateIndex
CREATE INDEX "ForecastWorkItem_tenantId_projectId_isCritical_projectedFin_idx" ON "ForecastWorkItem"("tenantId", "projectId", "isCritical", "projectedFinish");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastWorkItem_forecastId_workItemId_key" ON "ForecastWorkItem"("forecastId", "workItemId");

-- CreateIndex
CREATE INDEX "ForecastDriver_tenantId_projectId_forecastId_contribution_idx" ON "ForecastDriver"("tenantId", "projectId", "forecastId", "contribution");

-- CreateIndex
CREATE INDEX "RecoveryScenario_tenantId_projectId_forecastId_status_idx" ON "RecoveryScenario"("tenantId", "projectId", "forecastId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryScenario_tenantId_projectId_id_key" ON "RecoveryScenario"("tenantId", "projectId", "id");

-- CreateIndex
CREATE INDEX "ApprovalMatrix_tenantId_active_targetType_idx" ON "ApprovalMatrix"("tenantId", "active", "targetType");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalMatrix_tenantId_targetType_version_key" ON "ApprovalMatrix"("tenantId", "targetType", "version");

-- CreateIndex
CREATE INDEX "ReviewTask_tenantId_projectId_status_assignedRole_idx" ON "ReviewTask"("tenantId", "projectId", "status", "assignedRole");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewTask_tenantId_projectId_id_key" ON "ReviewTask"("tenantId", "projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewTask_projectId_targetType_targetId_targetVersion_key" ON "ReviewTask"("projectId", "targetType", "targetId", "targetVersion");

-- CreateIndex
CREATE INDEX "ReviewDecision_tenantId_projectId_actorUserId_decidedAt_idx" ON "ReviewDecision"("tenantId", "projectId", "actorUserId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDecision_reviewTaskId_sourceHash_key" ON "ReviewDecision"("reviewTaskId", "sourceHash");

-- CreateIndex
CREATE INDEX "ReviewCorrection_tenantId_projectId_reviewTaskId_correctedA_idx" ON "ReviewCorrection"("tenantId", "projectId", "reviewTaskId", "correctedAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_tenantId_projectId_route_createdAt_idx" ON "IdempotencyRecord"("tenantId", "projectId", "route", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_tenantId_key_key" ON "IdempotencyRecord"("tenantId", "key");

-- CreateIndex
CREATE INDEX "AppliedCommand_tenantId_projectId_targetType_targetId_appli_idx" ON "AppliedCommand"("tenantId", "projectId", "targetType", "targetId", "appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppliedCommand_tenantId_idempotencyKey_key" ON "AppliedCommand"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AppliedCommand_tenantId_projectId_id_key" ON "AppliedCommand"("tenantId", "projectId", "id");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_projectId_occurredAt_idx" ON "AuditLog"("tenantId", "projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_actorUserId_occurredAt_idx" ON "AuditLog"("tenantId", "actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_createdAt_idx" ON "OutboxEvent"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_tenantId_projectId_eventType_createdAt_idx" ON "OutboxEvent"("tenantId", "projectId", "eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_tenantId_idempotencyKey_key" ON "OutboxEvent"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ConsumedEvent_tenantId_projectId_consumedAt_idx" ON "ConsumedEvent"("tenantId", "projectId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedEvent_consumer_idempotencyKey_key" ON "ConsumedEvent"("consumer", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Notification_tenantId_projectId_status_createdAt_idx" ON "Notification"("tenantId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_tenantId_eventId_channel_userId_key" ON "Notification"("tenantId", "eventId", "channel", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_id_key" ON "Project"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_tenantId_invitedByUserId_fkey" FOREIGN KEY ("tenantId", "invitedByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantInvitation" ADD CONSTRAINT "TenantInvitation_tenantId_acceptedByUserId_fkey" FOREIGN KEY ("tenantId", "acceptedByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityToken" ADD CONSTRAINT "SecurityToken_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_tenantId_uploadedByUserId_fkey" FOREIGN KEY ("tenantId", "uploadedByUserId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactAccessGrant" ADD CONSTRAINT "ArtifactAccessGrant_tenantId_projectId_fileAssetId_fkey" FOREIGN KEY ("tenantId", "projectId", "fileAssetId") REFERENCES "FileAsset"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactAccessGrant" ADD CONSTRAINT "ArtifactAccessGrant_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignDocument" ADD CONSTRAINT "DesignDocument_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignDocument" ADD CONSTRAINT "DesignDocument_tenantId_projectId_fileAssetId_fkey" FOREIGN KEY ("tenantId", "projectId", "fileAssetId") REFERENCES "FileAsset"("tenantId", "projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingRevision" ADD CONSTRAINT "DrawingRevision_tenantId_projectId_documentId_fkey" FOREIGN KEY ("tenantId", "projectId", "documentId") REFERENCES "DesignDocument"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingPage" ADD CONSTRAINT "DrawingPage_tenantId_projectId_revisionId_fkey" FOREIGN KEY ("tenantId", "projectId", "revisionId") REFERENCES "DrawingRevision"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingScale" ADD CONSTRAINT "DrawingScale_tenantId_projectId_pageId_fkey" FOREIGN KEY ("tenantId", "projectId", "pageId") REFERENCES "DrawingPage"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignElement" ADD CONSTRAINT "DesignElement_tenantId_projectId_pageId_fkey" FOREIGN KEY ("tenantId", "projectId", "pageId") REFERENCES "DrawingPage"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElementGeometry" ADD CONSTRAINT "ElementGeometry_tenantId_projectId_elementId_fkey" FOREIGN KEY ("tenantId", "projectId", "elementId") REFERENCES "DesignElement"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElementSourceRef" ADD CONSTRAINT "ElementSourceRef_tenantId_projectId_elementId_fkey" FOREIGN KEY ("tenantId", "projectId", "elementId") REFERENCES "DesignElement"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElementSourceRef" ADD CONSTRAINT "ElementSourceRef_tenantId_projectId_fileAssetId_fkey" FOREIGN KEY ("tenantId", "projectId", "fileAssetId") REFERENCES "FileAsset"("tenantId", "projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityTakeoffVersion" ADD CONSTRAINT "QuantityTakeoffVersion_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityTakeoffItem" ADD CONSTRAINT "QuantityTakeoffItem_tenantId_projectId_versionId_fkey" FOREIGN KEY ("tenantId", "projectId", "versionId") REFERENCES "QuantityTakeoffVersion"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffAdjustment" ADD CONSTRAINT "TakeoffAdjustment_tenantId_projectId_itemId_fkey" FOREIGN KEY ("tenantId", "projectId", "itemId") REFERENCES "QuantityTakeoffItem"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCatalog" ADD CONSTRAINT "MaterialCatalog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialCatalogVersion" ADD CONSTRAINT "MaterialCatalogVersion_tenantId_catalogId_fkey" FOREIGN KEY ("tenantId", "catalogId") REFERENCES "MaterialCatalog"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialItem" ADD CONSTRAINT "MaterialItem_tenantId_catalogVersionId_fkey" FOREIGN KEY ("tenantId", "catalogVersionId") REFERENCES "MaterialCatalogVersion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialAlias" ADD CONSTRAINT "MaterialAlias_tenantId_materialItemId_fkey" FOREIGN KEY ("tenantId", "materialItemId") REFERENCES "MaterialItem"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormCatalog" ADD CONSTRAINT "NormCatalog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormCatalogVersion" ADD CONSTRAINT "NormCatalogVersion_tenantId_catalogId_fkey" FOREIGN KEY ("tenantId", "catalogId") REFERENCES "NormCatalog"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkNorm" ADD CONSTRAINT "WorkNorm_tenantId_normVersionId_fkey" FOREIGN KEY ("tenantId", "normVersionId") REFERENCES "NormCatalogVersion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkNorm" ADD CONSTRAINT "WorkNorm_tenantId_materialItemId_fkey" FOREIGN KEY ("tenantId", "materialItemId") REFERENCES "MaterialItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductivityRate" ADD CONSTRAINT "ProductivityRate_tenantId_normVersionId_fkey" FOREIGN KEY ("tenantId", "normVersionId") REFERENCES "NormCatalogVersion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceCatalog" ADD CONSTRAINT "PriceCatalog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceCatalogVersion" ADD CONSTRAINT "PriceCatalogVersion_tenantId_catalogId_fkey" FOREIGN KEY ("tenantId", "catalogId") REFERENCES "PriceCatalog"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceCatalogEntry" ADD CONSTRAINT "PriceCatalogEntry_tenantId_catalogVersionId_fkey" FOREIGN KEY ("tenantId", "catalogVersionId") REFERENCES "PriceCatalogVersion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceCatalogEntry" ADD CONSTRAINT "PriceCatalogEntry_tenantId_materialItemId_fkey" FOREIGN KEY ("tenantId", "materialItemId") REFERENCES "MaterialItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateVersion" ADD CONSTRAINT "EstimateVersion_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLine" ADD CONSTRAINT "EstimateLine_tenantId_projectId_estimateVersionId_fkey" FOREIGN KEY ("tenantId", "projectId", "estimateVersionId") REFERENCES "EstimateVersion"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateAssumption" ADD CONSTRAINT "EstimateAssumption_tenantId_projectId_estimateVersionId_fkey" FOREIGN KEY ("tenantId", "projectId", "estimateVersionId") REFERENCES "EstimateVersion"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateScenario" ADD CONSTRAINT "EstimateScenario_tenantId_projectId_estimateVersionId_fkey" FOREIGN KEY ("tenantId", "projectId", "estimateVersionId") REFERENCES "EstimateVersion"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleVersion" ADD CONSTRAINT "ScheduleVersion_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleActivity" ADD CONSTRAINT "ScheduleActivity_tenantId_projectId_scheduleVersionId_fkey" FOREIGN KEY ("tenantId", "projectId", "scheduleVersionId") REFERENCES "ScheduleVersion"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDependency" ADD CONSTRAINT "ScheduleDependency_tenantId_projectId_predecessorId_fkey" FOREIGN KEY ("tenantId", "projectId", "predecessorId") REFERENCES "ScheduleActivity"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleDependency" ADD CONSTRAINT "ScheduleDependency_tenantId_projectId_successorId_fkey" FOREIGN KEY ("tenantId", "projectId", "successorId") REFERENCES "ScheduleActivity"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceRequirement" ADD CONSTRAINT "ResourceRequirement_tenantId_projectId_activityId_fkey" FOREIGN KEY ("tenantId", "projectId", "activityId") REFERENCES "ScheduleActivity"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineVersion" ADD CONSTRAINT "BaselineVersion_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineVersion" ADD CONSTRAINT "BaselineVersion_tenantId_projectId_quantityVersionId_fkey" FOREIGN KEY ("tenantId", "projectId", "quantityVersionId") REFERENCES "QuantityTakeoffVersion"("tenantId", "projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineVersion" ADD CONSTRAINT "BaselineVersion_tenantId_projectId_estimateVersionId_fkey" FOREIGN KEY ("tenantId", "projectId", "estimateVersionId") REFERENCES "EstimateVersion"("tenantId", "projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineVersion" ADD CONSTRAINT "BaselineVersion_tenantId_projectId_scheduleVersionId_fkey" FOREIGN KEY ("tenantId", "projectId", "scheduleVersionId") REFERENCES "ScheduleVersion"("tenantId", "projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewAvailability" ADD CONSTRAINT "CrewAvailability_tenantId_projectId_crewId_fkey" FOREIGN KEY ("tenantId", "projectId", "crewId") REFERENCES "Crew"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentAvailability" ADD CONSTRAINT "EquipmentAvailability_tenantId_projectId_equipmentId_fkey" FOREIGN KEY ("tenantId", "projectId", "equipmentId") REFERENCES "Equipment"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyWorkPlan" ADD CONSTRAINT "DailyWorkPlan_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyWorkPlanItem" ADD CONSTRAINT "DailyWorkPlanItem_tenantId_projectId_planId_fkey" FOREIGN KEY ("tenantId", "projectId", "planId") REFERENCES "DailyWorkPlan"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlanResource" ADD CONSTRAINT "DailyPlanResource_tenantId_projectId_planItemId_fkey" FOREIGN KEY ("tenantId", "projectId", "planItemId") REFERENCES "DailyWorkPlanItem"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlanMaterial" ADD CONSTRAINT "DailyPlanMaterial_tenantId_projectId_planItemId_fkey" FOREIGN KEY ("tenantId", "projectId", "planItemId") REFERENCES "DailyWorkPlanItem"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlanMaterial" ADD CONSTRAINT "DailyPlanMaterial_tenantId_materialItemId_fkey" FOREIGN KEY ("tenantId", "materialItemId") REFERENCES "MaterialItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlanPrecondition" ADD CONSTRAINT "DailyPlanPrecondition_tenantId_projectId_planItemId_fkey" FOREIGN KEY ("tenantId", "projectId", "planItemId") REFERENCES "DailyWorkPlanItem"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_tenantId_projectId_dailyReportId_fkey" FOREIGN KEY ("tenantId", "projectId", "dailyReportId") REFERENCES "DailyReport"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_tenantId_projectId_planItemId_fkey" FOREIGN KEY ("tenantId", "projectId", "planItemId") REFERENCES "DailyWorkPlanItem"("tenantId", "projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_tenantId_projectId_dailyReportId_fkey" FOREIGN KEY ("tenantId", "projectId", "dailyReportId") REFERENCES "DailyReport"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_materialItemId_fkey" FOREIGN KEY ("tenantId", "materialItemId") REFERENCES "MaterialItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_projectId_reversalOfId_fkey" FOREIGN KEY ("tenantId", "projectId", "reversalOfId") REFERENCES "StockMovement"("tenantId", "projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoEvidence" ADD CONSTRAINT "PhotoEvidence_tenantId_projectId_dailyReportId_fkey" FOREIGN KEY ("tenantId", "projectId", "dailyReportId") REFERENCES "DailyReport"("tenantId", "projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoEvidence" ADD CONSTRAINT "PhotoEvidence_tenantId_projectId_fileAssetId_fkey" FOREIGN KEY ("tenantId", "projectId", "fileAssetId") REFERENCES "FileAsset"("tenantId", "projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoEvidenceLink" ADD CONSTRAINT "PhotoEvidenceLink_tenantId_projectId_photoId_fkey" FOREIGN KEY ("tenantId", "projectId", "photoId") REFERENCES "PhotoEvidence"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoEvidenceLink" ADD CONSTRAINT "PhotoEvidenceLink_tenantId_projectId_planItemId_fkey" FOREIGN KEY ("tenantId", "projectId", "planItemId") REFERENCES "DailyWorkPlanItem"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoQualityAssessment" ADD CONSTRAINT "PhotoQualityAssessment_tenantId_projectId_photoId_fkey" FOREIGN KEY ("tenantId", "projectId", "photoId") REFERENCES "PhotoEvidence"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoDuplicateFinding" ADD CONSTRAINT "PhotoDuplicateFinding_tenantId_projectId_photoId_fkey" FOREIGN KEY ("tenantId", "projectId", "photoId") REFERENCES "PhotoEvidence"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoDuplicateFinding" ADD CONSTRAINT "PhotoDuplicateFinding_tenantId_projectId_candidatePhotoId_fkey" FOREIGN KEY ("tenantId", "projectId", "candidatePhotoId") REFERENCES "PhotoEvidence"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressVerification" ADD CONSTRAINT "ProgressVerification_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressVerificationIssue" ADD CONSTRAINT "ProgressVerificationIssue_tenantId_projectId_verificationI_fkey" FOREIGN KEY ("tenantId", "projectId", "verificationId") REFERENCES "ProgressVerification"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyVariance" ADD CONSTRAINT "DailyVariance_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastWorkItem" ADD CONSTRAINT "ForecastWorkItem_tenantId_projectId_forecastId_fkey" FOREIGN KEY ("tenantId", "projectId", "forecastId") REFERENCES "ForecastSnapshot"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastDriver" ADD CONSTRAINT "ForecastDriver_tenantId_projectId_forecastId_fkey" FOREIGN KEY ("tenantId", "projectId", "forecastId") REFERENCES "ForecastSnapshot"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryScenario" ADD CONSTRAINT "RecoveryScenario_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryScenario" ADD CONSTRAINT "RecoveryScenario_tenantId_projectId_forecastId_fkey" FOREIGN KEY ("tenantId", "projectId", "forecastId") REFERENCES "ForecastSnapshot"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalMatrix" ADD CONSTRAINT "ApprovalMatrix_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_tenantId_projectId_reviewTaskId_fkey" FOREIGN KEY ("tenantId", "projectId", "reviewTaskId") REFERENCES "ReviewTask"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCorrection" ADD CONSTRAINT "ReviewCorrection_tenantId_projectId_reviewTaskId_fkey" FOREIGN KEY ("tenantId", "projectId", "reviewTaskId") REFERENCES "ReviewTask"("tenantId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppliedCommand" ADD CONSTRAINT "AppliedCommand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppliedCommand" ADD CONSTRAINT "AppliedCommand_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppliedCommand" ADD CONSTRAINT "AppliedCommand_tenantId_projectId_reviewTaskId_fkey" FOREIGN KEY ("tenantId", "projectId", "reviewTaskId") REFERENCES "ReviewTask"("tenantId", "projectId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumedEvent" ADD CONSTRAINT "ConsumedEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AgentToolReadModel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "artifactIds" TEXT[],
    "catalogVersionIds" TEXT[],
    "sourceRefs" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentToolReadModel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentToolReadModel_tenantId_projectId_toolName_recordId_key"
ON "AgentToolReadModel"("tenantId", "projectId", "toolName", "recordId");
CREATE INDEX "AgentToolReadModel_tenantId_projectId_toolName_effectiveAt_idx"
ON "AgentToolReadModel"("tenantId", "projectId", "toolName", "effectiveAt");
CREATE INDEX "AgentToolReadModel_tenantId_projectId_versionId_idx"
ON "AgentToolReadModel"("tenantId", "projectId", "versionId");
ALTER TABLE "AgentToolReadModel" ADD CONSTRAINT "AgentToolReadModel_tenantId_projectId_fkey"
FOREIGN KEY ("tenantId", "projectId") REFERENCES "Project"("tenantId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- BuildWatch invariant: approved/applied/superseded version content is immutable.
-- Only lifecycle timestamps and the forward-only status transition may change.
CREATE OR REPLACE FUNCTION buildwatch_guard_immutable_version()
RETURNS TRIGGER AS $$
DECLARE
  old_content JSONB;
  new_content JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status::TEXT IN ('APPROVED', 'APPLIED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'BUILDWATCH_IMMUTABLE_VERSION';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status::TEXT IN ('APPROVED', 'APPLIED', 'SUPERSEDED') THEN
    old_content := to_jsonb(OLD) - ARRAY['status', 'updatedAt', 'approvedAt', 'appliedAt'];
    new_content := to_jsonb(NEW) - ARRAY['status', 'updatedAt', 'approvedAt', 'appliedAt'];
    IF old_content IS DISTINCT FROM new_content THEN
      RAISE EXCEPTION 'BUILDWATCH_IMMUTABLE_VERSION';
    END IF;
    IF OLD.status::TEXT = 'APPROVED' AND NEW.status::TEXT NOT IN ('APPROVED', 'APPLIED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'BUILDWATCH_INVALID_VERSION_TRANSITION';
    END IF;
    IF OLD.status::TEXT = 'APPLIED' AND NEW.status::TEXT NOT IN ('APPLIED', 'SUPERSEDED') THEN
      RAISE EXCEPTION 'BUILDWATCH_INVALID_VERSION_TRANSITION';
    END IF;
    IF OLD.status::TEXT = 'SUPERSEDED' AND NEW.status::TEXT <> 'SUPERSEDED' THEN
      RAISE EXCEPTION 'BUILDWATCH_INVALID_VERSION_TRANSITION';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DrawingRevision_immutable_version"
BEFORE UPDATE OR DELETE ON "DrawingRevision"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "QuantityTakeoffVersion_immutable_version"
BEFORE UPDATE OR DELETE ON "QuantityTakeoffVersion"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "MaterialCatalogVersion_immutable_version"
BEFORE UPDATE OR DELETE ON "MaterialCatalogVersion"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "NormCatalogVersion_immutable_version"
BEFORE UPDATE OR DELETE ON "NormCatalogVersion"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "PriceCatalogVersion_immutable_version"
BEFORE UPDATE OR DELETE ON "PriceCatalogVersion"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "EstimateVersion_immutable_version"
BEFORE UPDATE OR DELETE ON "EstimateVersion"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "ScheduleVersion_immutable_version"
BEFORE UPDATE OR DELETE ON "ScheduleVersion"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "BaselineVersion_immutable_version"
BEFORE UPDATE OR DELETE ON "BaselineVersion"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "DailyWorkPlan_immutable_version"
BEFORE UPDATE OR DELETE ON "DailyWorkPlan"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "DailyReport_immutable_version"
BEFORE UPDATE OR DELETE ON "DailyReport"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "ProgressVerification_immutable_version"
BEFORE UPDATE OR DELETE ON "ProgressVerification"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();
CREATE TRIGGER "RecoveryScenario_immutable_version"
BEFORE UPDATE OR DELETE ON "RecoveryScenario"
FOR EACH ROW EXECUTE FUNCTION buildwatch_guard_immutable_version();

-- BuildWatch invariant: ledgers and audit/decision records are append-only.
CREATE OR REPLACE FUNCTION buildwatch_reject_append_only_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'BUILDWATCH_APPEND_ONLY_RECORD';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockMovement_append_only"
BEFORE UPDATE OR DELETE ON "StockMovement"
FOR EACH ROW EXECUTE FUNCTION buildwatch_reject_append_only_mutation();
CREATE TRIGGER "CostEntry_append_only"
BEFORE UPDATE OR DELETE ON "CostEntry"
FOR EACH ROW EXECUTE FUNCTION buildwatch_reject_append_only_mutation();
CREATE TRIGGER "AuditLog_append_only"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION buildwatch_reject_append_only_mutation();
CREATE TRIGGER "ReviewDecision_append_only"
BEFORE UPDATE OR DELETE ON "ReviewDecision"
FOR EACH ROW EXECUTE FUNCTION buildwatch_reject_append_only_mutation();
CREATE TRIGGER "AppliedCommand_append_only"
BEFORE UPDATE OR DELETE ON "AppliedCommand"
FOR EACH ROW EXECUTE FUNCTION buildwatch_reject_append_only_mutation();
CREATE TRIGGER "ConsumedEvent_append_only"
BEFORE UPDATE OR DELETE ON "ConsumedEvent"
FOR EACH ROW EXECUTE FUNCTION buildwatch_reject_append_only_mutation();
