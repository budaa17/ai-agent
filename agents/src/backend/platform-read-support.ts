import { Phase9ApiError } from "./contracts.js";
import type {
  PlatformOverviewFreshness,
  PlatformOverviewWindow,
} from "./platform-overview-contracts.js";
import type { PlatformOverviewQueryResult } from "./platform-overview-read-model.js";

/**
 * Helpers shared by every read-only platform aggregate: the overview and the
 * Phase 5 drill-down endpoints. Keeping them in one module is what stops the
 * two surfaces from drifting on freshness, redaction or numeric semantics.
 */

export const DAY_MS = 24 * 60 * 60 * 1_000;
export const FRESHNESS_STALE_AFTER_SECONDS = 60;
export const MIN_AGENT_SAMPLE = 20;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/u;

export interface DomainAvailable<T> {
  available: true;
  data: T;
  freshness: PlatformOverviewFreshness;
}

export interface DomainUnavailable {
  available: false;
  freshness: PlatformOverviewFreshness;
  stale: boolean;
}

export type Domain<T> = DomainAvailable<T> | DomainUnavailable;

export function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

export function utcMonthStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function previousUtcMonthStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() - 1, 1));
}

export function selectedWindow(from: Date, to: Date): PlatformOverviewWindow {
  return {
    kind: "SELECTED_RANGE",
    from: from.toISOString(),
    to: to.toISOString(),
    timeZone: "UTC",
  };
}

export function snapshotWindow(asOf: Date): PlatformOverviewWindow {
  return { kind: "SNAPSHOT", from: null, to: asOf.toISOString(), timeZone: "UTC" };
}

export function unknownFreshness(
  checkedAt: Date,
  source: PlatformOverviewFreshness["source"] = "LIVE_QUERY",
): PlatformOverviewFreshness {
  return {
    state: "UNKNOWN",
    source,
    checkedAt: checkedAt.toISOString(),
    freshAt: null,
    ageSeconds: null,
    staleAfterSeconds: FRESHNESS_STALE_AFTER_SECONDS,
    reason: "Source is temporarily unavailable",
  };
}

export function freshFreshness(
  checkedAt: Date,
  source: PlatformOverviewFreshness["source"] = "LIVE_QUERY",
): PlatformOverviewFreshness {
  return {
    state: "FRESH",
    source,
    checkedAt: checkedAt.toISOString(),
    freshAt: checkedAt.toISOString(),
    ageSeconds: 0,
    staleAfterSeconds: FRESHNESS_STALE_AFTER_SECONDS,
    reason: null,
  };
}

export function freshnessOf<T>(
  result: PlatformOverviewQueryResult<T>,
  checkedAt: Date,
): PlatformOverviewFreshness {
  if (result.source === "LIVE_QUERY") return freshFreshness(checkedAt);
  if (result.freshAt === null) return unknownFreshness(checkedAt, result.source);
  const ageSeconds = Math.max(
    0,
    Math.floor((checkedAt.getTime() - result.freshAt.getTime()) / 1_000),
  );
  const stale = ageSeconds > FRESHNESS_STALE_AFTER_SECONDS;
  return {
    state: stale ? "STALE" : "FRESH",
    source: result.source,
    checkedAt: checkedAt.toISOString(),
    freshAt: result.freshAt.toISOString(),
    ageSeconds,
    staleAfterSeconds: FRESHNESS_STALE_AFTER_SECONDS,
    reason: stale ? "Source snapshot is stale" : null,
  };
}

export function domainFromSettled<T>(
  result: PromiseSettledResult<PlatformOverviewQueryResult<T>>,
  checkedAt: Date,
  source: PlatformOverviewFreshness["source"] = "LIVE_QUERY",
): Domain<T> {
  if (result.status === "rejected") {
    return { available: false, stale: false, freshness: unknownFreshness(checkedAt, source) };
  }
  const freshness = freshnessOf(result.value, checkedAt);
  if (freshness.state !== "FRESH") {
    return { available: false, stale: freshness.state === "STALE", freshness };
  }
  return { available: true, data: result.value.data, freshness };
}

export function combinedFreshness(
  domains: readonly Domain<unknown>[],
  checkedAt: Date,
): PlatformOverviewFreshness {
  const unavailable = domains.find((domain) => !domain.available && !domain.stale);
  if (unavailable !== undefined) return unknownFreshness(checkedAt);
  const stale = domains.find((domain) => !domain.available && domain.stale);
  if (stale !== undefined) return stale.freshness;
  return freshFreshness(checkedAt);
}

export function nonnegativeInteger(value: bigint | number | null | undefined): number {
  const number = typeof value === "bigint" ? Number(value) : (value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Aggregate exceeded the supported numeric range");
  }
  return number;
}

export function roundedPercent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1_000) / 10;
}

export function unavailableComparison(
  reason: "NOT_APPLICABLE" | "NO_HISTORY" | "INSUFFICIENT_SAMPLE" | "SOURCE_UNAVAILABLE",
) {
  return { state: "UNAVAILABLE" as const, reason };
}

export function boundedPublicText(
  value: string | null | undefined,
  maximum: number,
): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) return null;
  return normalized;
}

/**
 * Audit reasons are operator-authored text. Keep their useful explanation but
 * remove credential-shaped values before a cross-tenant platform reader can
 * see them. Raw metadata remains excluded at the SQL projection boundary.
 */
export function redactedAuditReason(
  value: string | null | undefined,
  maximum = 300,
): string | null {
  if (value === null || value === undefined) return null;
  const redacted = value
    .replace(/\bBearer\s+\S+/giu, "Bearer [redacted]")
    .replace(
      /\b(api[_ -]?key|authorization|password|secret|token)\b\s*[:=]?\s*\S+/giu,
      "$1 [redacted]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, "[redacted]")
    .trim();
  return redacted.length === 0 ? null : redacted.slice(0, maximum);
}

export function safeAgentType(value: string | null | undefined): string | null {
  return boundedPublicText(value, 100);
}

export function safeTenantDisplayName(name: string, tenantId: string): string {
  const normalized = name.trim();
  if (normalized.length > 0) return normalized.slice(0, 200);
  return tenantId.slice(0, 200);
}

export function scope(input: {
  tenantId?: string | null;
  tenantName?: string | null;
  agentType?: string | null;
  component?: string | null;
}) {
  return {
    tenantId: input.tenantId ?? null,
    tenantName: boundedPublicText(input.tenantName, 200),
    agentType: safeAgentType(input.agentType),
    component: boundedPublicText(input.component, 100),
  };
}

export function safeIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.length > 200 || !identifierPattern.test(value)) return null;
  return value;
}

/**
 * Keyset cursors are opaque to the client but must never become a way to reach
 * rows the filter would not have returned, so the service re-validates the
 * decoded payload against the endpoint's own schema before using it.
 */
export function encodeKeysetCursor(payload: Record<string, string | number | null>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeKeysetCursor(value: string): unknown {
  if (value.length > 2_048) {
    throw new Phase9ApiError("CURSOR_INVALID", 400, "Cursor is not valid");
  }
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new Phase9ApiError("CURSOR_INVALID", 400, "Cursor is not valid");
  }
  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    throw new Phase9ApiError("CURSOR_INVALID", 400, "Cursor is not valid");
  }
}
