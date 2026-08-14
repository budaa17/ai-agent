import type { TenantAccessOperation } from "./tenant-access-policy.js";

/**
 * Maps an incoming request onto the operation class the access policy reasons
 * about (landing-page-roadmap.md §19.1, §19.3).
 *
 * The classifier is deliberately dumb and default-deny shaped: anything it does
 * not recognise falls back to the most restrictive class the HTTP method allows.
 * A path can only reach the permissive `BILLING` class by matching the allowlist
 * exactly.
 */

/**
 * Endpoints a Company Admin keeps while the subscription is closed, so payment
 * can always be recovered. `/v1/auth/*` is not listed because those routes are
 * registered before the authenticated `/v1` stack and never reach this gate.
 */
export const TENANT_BILLING_ALLOWLIST_EXACT: readonly string[] = [
  "/v1/session",
  "/v1/account/export-status",
];

export const TENANT_BILLING_ALLOWLIST_PREFIXES: readonly string[] = ["/v1/billing/"];

/** Routes that start a new AI agent run and therefore consume plan AI budget. */
export const TENANT_AI_JOB_PATH_SUFFIXES: readonly string[] = [
  "/a0-intakes",
  "/a1-intakes",
  "/a3-documents",
  "/chat",
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A path is only trusted for allowlist matching when it is already in canonical
 * form. Traversal or encoded segments are refused so that `/v1/billing/../projects`
 * can never inherit billing-tier permissions.
 */
function isCanonicalPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.includes("//") || path.includes("\\")) return false;
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return false;
  return !/%2e|%2f|%5c/i.test(path);
}

export function requestPathWithoutQuery(originalUrl: string): string {
  const queryIndex = originalUrl.indexOf("?");
  const hashIndex = originalUrl.indexOf("#");
  const end = Math.min(
    queryIndex === -1 ? originalUrl.length : queryIndex,
    hashIndex === -1 ? originalUrl.length : hashIndex,
  );
  return originalUrl.slice(0, end);
}

export function isTenantBillingPath(path: string): boolean {
  if (!isCanonicalPath(path)) return false;
  if (TENANT_BILLING_ALLOWLIST_EXACT.includes(path)) return true;
  return TENANT_BILLING_ALLOWLIST_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isTenantAiJobRequest(method: string, path: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return false;
  if (!isCanonicalPath(path)) return false;
  return TENANT_AI_JOB_PATH_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

export function classifyTenantAccessOperation(method: string, path: string): TenantAccessOperation {
  if (isTenantBillingPath(path)) return "BILLING";
  if (isTenantAiJobRequest(method, path)) return "AI_JOB";
  return READ_METHODS.has(method.toUpperCase()) ? "READ" : "WRITE";
}
