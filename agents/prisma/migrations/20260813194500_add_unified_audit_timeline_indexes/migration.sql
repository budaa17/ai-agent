-- Control Tower merges platform and tenant audit streams by occurredAt/id.
-- These indexes keep cross-tenant keyset pagination bounded without indexing
-- any metadata or business-content JSON fields.
CREATE INDEX "PlatformAuditLog_occurredAt_id_idx"
ON "PlatformAuditLog"("occurredAt", "id");

CREATE INDEX "AuditLog_occurredAt_id_idx"
ON "AuditLog"("occurredAt", "id");
