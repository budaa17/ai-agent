import { createHash } from "node:crypto";

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalDesignJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalDesignJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalDesignJson(record[key])}`)
    .join(",")}}`;
}

export function hashCanonical(value: unknown): string {
  return sha256(canonicalDesignJson(value));
}

export function decimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("A deterministic decimal must be finite");
  }

  const normalized = value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "");
  return normalized === "-0" ? "0" : normalized;
}

export function deterministicId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}-${sha256(parts.join("\0")).slice(0, 20)}`;
}
