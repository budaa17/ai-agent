-- Additive read-path indexes for the platform overview aggregates.
CREATE INDEX "AgentRun_overview_started_tenant_agent_status_idx"
ON "AgentRun"("startedAt", "tenantId", "agentType", "status");

CREATE INDEX "AgentRun_overview_tenant_started_agent_status_idx"
ON "AgentRun"("tenantId", "startedAt", "agentType", "status");

CREATE INDEX "AgentRun_overview_running_started_tenant_agent_idx"
ON "AgentRun"("startedAt", "tenantId", "agentType")
WHERE "status" = 'RUNNING';

CREATE INDEX "ReviewTask_overview_due_tenant_required_idx"
ON "ReviewTask"("dueAt", "tenantId")
WHERE "status" = 'REVIEW_REQUIRED';

CREATE INDEX "ReviewTask_overview_tenant_due_created_required_idx"
ON "ReviewTask"("tenantId", "dueAt", "createdAt")
WHERE "status" = 'REVIEW_REQUIRED';

CREATE INDEX "OutboxEvent_overview_tenant_status_available_idx"
ON "OutboxEvent"("tenantId", "status", "availableAt");

CREATE INDEX "Notification_overview_status_created_idx"
ON "Notification"("status", "createdAt");

CREATE INDEX "Notification_overview_tenant_status_created_idx"
ON "Notification"("tenantId", "status", "createdAt");

CREATE INDEX "FileAsset_overview_status_created_idx"
ON "FileAsset"("status", "createdAt");

CREATE INDEX "FileAsset_overview_active_tenant_usage_idx"
ON "FileAsset"("tenantId") INCLUDE ("sizeBytes", "status", "createdAt")
WHERE "deletedAt" IS NULL AND "status" <> 'DELETED';

CREATE INDEX "User_overview_active_tenant_login_idx"
ON "User"("tenantId", "lastLoginAt" DESC)
WHERE "deletedAt" IS NULL AND "status" = 'ACTIVE';

CREATE INDEX "PlatformAuditLog_overview_occurred_id_idx"
ON "PlatformAuditLog"("occurredAt" DESC, "id" DESC);
