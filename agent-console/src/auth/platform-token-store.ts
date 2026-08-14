import { tokenPairSchema, type TokenPair } from "./token-store";

const PLATFORM_STORAGE_KEY = "buildwatch.platform.auth.v1";
const listeners = new Set<(tokens: TokenPair | null) => void>();
let memoryTokens: TokenPair | null | undefined;

function readSessionStorage(): TokenPair | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(PLATFORM_STORAGE_KEY);
  if (raw === null) return null;
  try {
    return tokenPairSchema.parse(JSON.parse(raw));
  } catch {
    window.sessionStorage.removeItem(PLATFORM_STORAGE_KEY);
    return null;
  }
}

export function getPlatformTokens(): TokenPair | null {
  if (memoryTokens === undefined) memoryTokens = readSessionStorage();
  return memoryTokens;
}

export function setPlatformTokens(tokens: TokenPair | null): void {
  memoryTokens = tokens;
  if (typeof window !== "undefined") {
    if (tokens === null) window.sessionStorage.removeItem(PLATFORM_STORAGE_KEY);
    else window.sessionStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(tokens));
  }
  for (const listener of listeners) listener(tokens);
}

export function subscribePlatformTokens(listener: (tokens: TokenPair | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasUsablePlatformRefreshToken(tokens = getPlatformTokens()): boolean {
  return tokens !== null && Date.parse(tokens.refreshExpiresAt) > Date.now() + 5_000;
}
