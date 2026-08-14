-- Phase 5: one-time email verification token for a public company signup.
-- Additive only. The token is stored as a hash and cleared on use, so a
-- verification link cannot be replayed.

ALTER TABLE "CompanySignupIntent" ADD COLUMN "emailVerificationTokenHash" TEXT;

CREATE UNIQUE INDEX "CompanySignupIntent_emailVerificationTokenHash_key"
ON "CompanySignupIntent"("emailVerificationTokenHash");
