-- Operator-driven incident transitions carry an Idempotency-Key so a retried
-- request replays the original event rather than appending a duplicate.
ALTER TABLE "PlatformIncidentEvent" ADD COLUMN "idempotencyKey" TEXT;

-- NULL keys stay unconstrained, so evaluator-written events are unaffected.
CREATE UNIQUE INDEX "PlatformIncidentEvent_incidentId_idempotencyKey_key"
ON "PlatformIncidentEvent"("incidentId", "idempotencyKey");
