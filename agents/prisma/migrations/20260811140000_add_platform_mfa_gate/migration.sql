-- Phase 7 release hardening: the production MFA gate needs somewhere to record
-- that a second factor was enrolled. Until enrolment ships, the column stays
-- null and production platform sign-in is refused by the auth service.
ALTER TABLE "PlatformPrincipal" ADD COLUMN "mfaEnrolledAt" TIMESTAMP(3);

CREATE INDEX "PlatformPrincipal_mfaEnrolledAt_idx"
ON "PlatformPrincipal"("mfaEnrolledAt");
