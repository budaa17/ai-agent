-- CreateTable
CREATE TABLE "RuleCatalog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleCatalogVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "VersionLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "jdmGraph" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleCatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RuleCatalog_tenantId_ruleId_key" ON "RuleCatalog"("tenantId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleCatalog_tenantId_id_key" ON "RuleCatalog"("tenantId", "id");

-- CreateIndex
CREATE INDEX "RuleCatalogVersion_tenantId_status_idx" ON "RuleCatalogVersion"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RuleCatalogVersion_tenantId_id_key" ON "RuleCatalogVersion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RuleCatalogVersion_catalogId_versionNumber_key" ON "RuleCatalogVersion"("catalogId", "versionNumber");

-- AddForeignKey
ALTER TABLE "RuleCatalog" ADD CONSTRAINT "RuleCatalog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleCatalogVersion" ADD CONSTRAINT "RuleCatalogVersion_tenantId_catalogId_fkey" FOREIGN KEY ("tenantId", "catalogId") REFERENCES "RuleCatalog"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
