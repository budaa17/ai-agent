import type { Prisma } from "@prisma/client";
import type { BillingFeatureKey } from "./billing-contracts.js";
import type { TenantAccessPolicy } from "./tenant-access-policy.js";

/**
 * Race-free plan limit enforcement (landing-page-roadmap.md §28, Phase 9).
 *
 * Checking a limit and then creating the resource in two separate steps lets two
 * simultaneous requests both see the last free slot. This reserves instead: the
 * count and the insert happen inside one transaction, guarded by a
 * transaction-scoped Postgres advisory lock keyed on the tenant and the limit.
 *
 * `pg_advisory_xact_lock` is used rather than the session-level variant because
 * it is released automatically on commit or rollback — with a connection pool a
 * session-level lock can outlive the request that took it.
 */

export type LimitTransactionClient = Pick<
  Prisma.TransactionClient,
  "project" | "user" | "fileAsset" | "agentRun" | "agentUsageBudget" | "$executeRaw"
>;

async function currentUsage(
  transaction: LimitTransactionClient,
  tenantId: string,
  featureKey: BillingFeatureKey,
  monthStart: Date,
): Promise<number | bigint | null> {
  switch (featureKey) {
    case "PROJECT_ACTIVE_MAX":
      return transaction.project.count({
        where: { tenantId, status: { in: ["PLANNED", "ACTIVE", "PAUSED"] } },
      });
    case "USER_ACTIVE_MAX":
      return transaction.user.count({
        where: { tenantId, deletedAt: null, status: { in: ["ACTIVE", "INVITED"] } },
      });
    case "STORAGE_BYTES_MAX": {
      const storage = await transaction.fileAsset.aggregate({
        where: { tenantId },
        _sum: { sizeBytes: true },
      });
      return BigInt(storage._sum?.sizeBytes ?? 0);
    }
    case "AI_MONTHLY_RUNS_INCLUDED":
      return transaction.agentRun.count({
        where: { tenantId, startedAt: { gte: monthStart } },
      });
    case "AI_MONTHLY_MICRO_USD_MAX": {
      const budget = await transaction.agentUsageBudget.aggregate({
        where: { tenantId },
        _sum: { usedMicroUsd: true },
      });
      return BigInt(budget._sum.usedMicroUsd ?? 0);
    }
    default:
      // A non-countable feature has no reservation; `requireFeature` covers it.
      return null;
  }
}

export interface TenantLimitReservation {
  reserve(
    transaction: LimitTransactionClient,
    tenantId: string,
    featureKey: BillingFeatureKey,
    delta?: number,
  ): Promise<void>;
}

export function createTenantLimitReservation(options: {
  policy: TenantAccessPolicy;
  now?: () => Date;
}): TenantLimitReservation {
  const now = options.now ?? (() => new Date());
  return {
    async reserve(transaction, tenantId, featureKey, delta = 1) {
      // Two 32-bit keys keep the lock namespace per tenant and per limit, so a
      // project create never blocks an unrelated user invite.
      const tenantKey = hash32(tenantId);
      const featureKey32 = hash32(featureKey);
      // `$executeRaw` rather than `$queryRaw`: the lock function returns void,
      // which Prisma cannot deserialise as a result column.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${tenantKey}::int, ${featureKey32}::int)`;

      const reference = now();
      const monthStart = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
      const usage = await currentUsage(transaction, tenantId, featureKey, monthStart);
      if (usage === null) return;
      await options.policy.requireLimit(tenantId, featureKey, usage, delta);
    },
  };
}

/** Stable 32-bit signed hash; only needs to spread keys, not resist collisions. */
function hash32(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  }
  return hash;
}
