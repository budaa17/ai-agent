-- Sign-in no longer asks for a tenant slug: the tenant is resolved from the
-- email, so the lookup crosses tenants and cannot use User_tenantId_emailNormalized_key.
CREATE INDEX "User_emailNormalized_idx" ON "User"("emailNormalized");
