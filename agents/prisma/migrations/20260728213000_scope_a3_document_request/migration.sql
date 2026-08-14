DROP INDEX "A3DocumentDraft_requestId_type_key";

CREATE UNIQUE INDEX "A3DocumentDraft_tenantId_projectId_requestId_type_key"
ON "A3DocumentDraft"("tenantId", "projectId", "requestId", "type");
