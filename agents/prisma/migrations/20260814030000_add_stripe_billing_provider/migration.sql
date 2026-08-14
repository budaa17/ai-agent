-- Stripe is the sole new self-service subscription rail. Existing provider
-- values remain readable so historical invoices and audit records are intact.
ALTER TYPE "BillingProviderKind" ADD VALUE IF NOT EXISTS 'STRIPE' BEFORE 'LEMON_SQUEEZY';
