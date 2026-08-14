import { createHash, timingSafeEqual } from "node:crypto";
import type { Response } from "express";

export type Phase11RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export class Phase11FixedWindowRateLimiter {
  readonly #buckets = new Map<string, RateLimitBucket>();
  readonly #windowMs: number;
  readonly #maxRequests: number;
  readonly #maxKeys: number;
  readonly #now: () => number;

  constructor(options: {
    windowMs: number;
    maxRequests: number;
    maxKeys?: number;
    now?: () => number;
  }) {
    if (!Number.isInteger(options.windowMs) || options.windowMs < 1_000) {
      throw new Error("Rate-limit window must be at least 1000 ms");
    }
    if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1) {
      throw new Error("Rate-limit maximum must be a positive integer");
    }
    this.#windowMs = options.windowMs;
    this.#maxRequests = options.maxRequests;
    this.#maxKeys = options.maxKeys ?? 50_000;
    this.#now = options.now ?? Date.now;
  }

  consume(key: string): Phase11RateLimitDecision {
    const now = this.#now();
    let bucket = this.#buckets.get(key);
    if (bucket === undefined || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.#windowMs };
      this.#buckets.set(key, bucket);
    }

    const allowed = bucket.count < this.#maxRequests;
    if (allowed) bucket.count += 1;
    this.#prune(now);
    return {
      allowed,
      limit: this.#maxRequests,
      remaining: Math.max(0, this.#maxRequests - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  }

  #prune(now: number) {
    if (this.#buckets.size <= this.#maxKeys) return;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now || this.#buckets.size > this.#maxKeys) {
        this.#buckets.delete(key);
      }
      if (this.#buckets.size <= this.#maxKeys) break;
    }
  }
}

export function applyPhase11SecurityHeaders(response: Response, production: boolean) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-site");
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  response.setHeader("cache-control", "no-store");
  if (production) {
    response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
}

export function setPhase11RateLimitHeaders(response: Response, decision: Phase11RateLimitDecision) {
  response.setHeader("ratelimit-limit", String(decision.limit));
  response.setHeader("ratelimit-remaining", String(decision.remaining));
  response.setHeader("ratelimit-reset", String(decision.retryAfterSeconds));
  if (!decision.allowed) {
    response.setHeader("retry-after", String(decision.retryAfterSeconds));
  }
}

export function phase11TokenMatches(
  supplied: string | undefined,
  expected: string | null | undefined,
): boolean {
  if (supplied === undefined || expected === null || expected === undefined) {
    return false;
  }
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export function phase11TelemetryTag(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function phase11RequestFamily(path: string): string {
  if (path.startsWith("/health/")) return "health";
  if (path.startsWith("/internal/")) return "internal";
  if (path.startsWith("/platform/v1/auth/")) return "auth";
  if (path.startsWith("/platform/v1/")) return "platform";
  if (path.startsWith("/v1/auth/") || path === "/v1/invitations/accept") {
    return "auth";
  }
  if (path.includes("/artifacts")) return "artifact";
  if (path.includes("/chat")) return "chat";
  if (path.startsWith("/v1/projects")) return "project";
  return "other";
}

function prometheusName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_:]/gu, "_");
  return /^[A-Za-z_:]/u.test(normalized) ? normalized : `buildwatch_${normalized}`;
}

export function renderPhase11PrometheusMetrics(
  snapshot: {
    counters: Record<string, number>;
    observations: Record<string, { count: number; average: number; max: number }>;
  },
  gauges: Record<string, number> = {},
): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(snapshot.counters).sort()) {
    lines.push(`${prometheusName(`buildwatch_${name}`)} ${value}`);
  }
  for (const [name, value] of Object.entries(snapshot.observations).sort()) {
    const metric = prometheusName(`buildwatch_${name}`);
    lines.push(`${metric}_count ${value.count}`);
    lines.push(`${metric}_average ${value.average}`);
    lines.push(`${metric}_max ${value.max}`);
  }
  for (const [name, value] of Object.entries(gauges).sort()) {
    if (!Number.isFinite(value)) continue;
    lines.push(`${prometheusName(`buildwatch_${name}`)} ${value}`);
  }
  return `${lines.join("\n")}\n`;
}
