import { createHash } from "node:crypto";

const safeKeySegmentPattern = /^[A-Za-z0-9_.-]+$/;

function normalizeKeySegment(value: string) {
  const normalized = value.trim().normalize("NFKC");

  if (!normalized) {
    throw new Error("pg-boss key segment cannot be empty");
  }

  if (safeKeySegmentPattern.test(normalized)) {
    return normalized;
  }

  const digest = createHash("sha256").update(normalized).digest("base64url").slice(0, 24);

  return `sha256-${digest}`;
}

export function createPgBossKey(first: string, ...rest: string[]) {
  return [first, ...rest].map(normalizeKeySegment).join("/");
}
