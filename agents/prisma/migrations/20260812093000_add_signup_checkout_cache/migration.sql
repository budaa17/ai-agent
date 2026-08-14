-- Phase 5: remember the open checkout for a signup intent.
-- Additive only. Without the URL, checkout idempotency could only be enforced by
-- asking the provider again, which is exactly the duplicate call it must avoid.

ALTER TABLE "CompanySignupIntent" ADD COLUMN "providerCheckoutUrl" TEXT;
ALTER TABLE "CompanySignupIntent" ADD COLUMN "providerCheckoutExpiresAt" TIMESTAMP(3);
