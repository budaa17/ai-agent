-- Six-digit company-signup email verification codes.
-- The existing token hash column is reused, but new codes are stored as a
-- server-secret HMAC. Legacy long-link tokens are deliberately invalidated.

ALTER TABLE "CompanySignupIntent"
  ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationSentAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationAttemptCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "CompanySignupIntent"
SET "emailVerificationTokenHash" = NULL
WHERE "status" = 'PENDING_VERIFICATION';

ALTER TABLE "CompanySignupIntent"
  ADD CONSTRAINT "CompanySignupIntent_emailVerificationAttemptCount_check"
  CHECK ("emailVerificationAttemptCount" >= 0);

CREATE INDEX "CompanySignupIntent_verification_expiry_idx"
ON "CompanySignupIntent"("status", "emailVerificationExpiresAt");
