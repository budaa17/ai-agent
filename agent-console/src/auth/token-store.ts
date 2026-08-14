import { z } from "zod";

export const tokenPairSchema = z
  .object({
    tokenType: z.literal("Bearer"),
    accessToken: z.string().min(32),
    accessExpiresAt: z.string().datetime(),
    refreshToken: z.string().min(32),
    refreshExpiresAt: z.string().datetime(),
  })
  .strict();

export type TokenPair = z.infer<typeof tokenPairSchema>;

const STORAGE_KEY = "buildwatch.auth.v1";
const listeners = new Set<(tokens: TokenPair | null) => void>();
let memoryTokens: TokenPair | null | undefined;

function readSessionStorage(): TokenPair | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    return tokenPairSchema.parse(JSON.parse(raw));
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function getTokens(): TokenPair | null {
  if (memoryTokens === undefined) memoryTokens = readSessionStorage();
  return memoryTokens;
}

export function setTokens(tokens: TokenPair | null): void {
  memoryTokens = tokens;
  if (typeof window !== "undefined") {
    if (tokens === null) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  }
  for (const listener of listeners) listener(tokens);
}

export function subscribeTokens(listener: (tokens: TokenPair | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasUsableRefreshToken(tokens = getTokens()): boolean {
  return tokens !== null && Date.parse(tokens.refreshExpiresAt) > Date.now() + 5_000;
}
