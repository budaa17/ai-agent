import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import {
  Phase9ApiError,
  phase9AccessClaimsSchema,
  phase9RefreshClaimsSchema,
  phase9TenantSelectionClaimsSchema,
  type Phase9AccessClaims,
  type Phase9RefreshClaims,
  type Phase9Role,
  type Phase9TenantSelectionClaims,
} from "./contracts.js";

const passwordParameters = Object.freeze({ N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

/** Long enough to read an organization list, short enough to be a poor thing to steal. */
const TENANT_SELECTION_TTL_SECONDS = 120;

/**
 * Upper bound on accounts sharing one email that sign-in will consider. Each
 * candidate costs a full scrypt verification, so this caps both latency and
 * the work an unauthenticated request can force.
 */
export const MAX_TENANT_CANDIDATES = 5;

let decoyPasswordHash: Promise<string> | null = null;

/**
 * A throwaway hash to verify against when an email matches no account, so an
 * unknown address costs the same scrypt work as a known one. Without it the
 * response time alone tells an attacker whether an address is registered.
 */
export function phase9DecoyPasswordHash(): Promise<string> {
  decoyPasswordHash ??= hashPhase9Password(randomBytes(24).toString("base64url"));
  return decoyPasswordHash;
}

function derivePasswordKey(
  password: string,
  salt: Buffer,
  length: number,
  options: Readonly<{ N: number; r: number; p: number; maxmem: number }>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey as Buffer);
    });
  });
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) {
    throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
  }
  return decoded;
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(decodeCanonicalBase64Url(value).toString("utf8"));
  } catch {
    throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
  }
}

export function phase9CanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(phase9CanonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${phase9CanonicalJson(entry)}`)
    .join(",")}}`;
}

export function phase9Sha256(value: unknown): string {
  const input = typeof value === "string" ? value : phase9CanonicalJson(value);
  return createHash("sha256").update(input).digest("hex");
}

export function normalizePhase9Email(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export function randomPhase9Token(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function hashPhase9Password(password: string): Promise<string> {
  if (password.length < 12 || password.length > 200) {
    throw new Phase9ApiError("VALIDATION_FAILED", 400, "Password policy was not satisfied");
  }
  const salt = randomBytes(16);
  const derived = await derivePasswordKey(password.normalize("NFKC"), salt, 64, passwordParameters);
  return [
    "scrypt",
    passwordParameters.N,
    passwordParameters.r,
    passwordParameters.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPhase9Password(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue] = encodedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    nValue === undefined ||
    rValue === undefined ||
    pValue === undefined ||
    saltValue === undefined ||
    hashValue === undefined
  ) {
    return false;
  }
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await derivePasswordKey(
    password.normalize("NFKC"),
    Buffer.from(saltValue, "base64url"),
    expected.length,
    {
      N: Number(nValue),
      r: Number(rValue),
      p: Number(pValue),
      maxmem: passwordParameters.maxmem,
    },
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface Phase9TokenServiceOptions {
  secret: string;
  issuer: string;
  audience: string;
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
  now?: () => Date;
}

export class Phase9TokenService {
  readonly #secret: Buffer;
  readonly #issuer: string;
  readonly #audience: string;
  readonly #accessTtlSeconds: number;
  readonly #refreshTtlSeconds: number;
  readonly #now: () => Date;

  constructor(options: Phase9TokenServiceOptions) {
    if (Buffer.byteLength(options.secret, "utf8") < 32) {
      throw new Error("Phase 9 JWT secret must be at least 32 bytes");
    }
    this.#secret = Buffer.from(options.secret, "utf8");
    this.#issuer = options.issuer;
    this.#audience = options.audience;
    this.#accessTtlSeconds = options.accessTtlSeconds ?? 900;
    this.#refreshTtlSeconds = options.refreshTtlSeconds ?? 2_592_000;
    this.#now = options.now ?? (() => new Date());
  }

  #sign(payload: Record<string, unknown>): string {
    const header = encodeJson({ alg: "HS256", typ: "JWT", kid: "buildwatch-v22-phase9-hs256-v1" });
    const body = encodeJson(payload);
    const signature = createHmac("sha256", this.#secret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return `${header}.${body}.${signature}`;
  }

  #verify(token: string): unknown {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
    }
    const [header, payload, signature] = parts as [string, string, string];
    const decodedHeader = decodeJson(header) as Record<string, unknown>;
    if (
      decodedHeader.alg !== "HS256" ||
      decodedHeader.typ !== "JWT" ||
      decodedHeader.kid !== "buildwatch-v22-phase9-hs256-v1"
    ) {
      throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
    }
    const expected = createHmac("sha256", this.#secret).update(`${header}.${payload}`).digest();
    const actual = decodeCanonicalBase64Url(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
    }
    const claims = decodeJson(payload) as Record<string, unknown>;
    const nowSeconds = Math.floor(this.#now().getTime() / 1_000);
    if (
      claims.iss !== this.#issuer ||
      claims.aud !== this.#audience ||
      typeof claims.exp !== "number" ||
      typeof claims.iat !== "number" ||
      claims.exp <= nowSeconds ||
      claims.iat > nowSeconds + 60
    ) {
      throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
    }
    return claims;
  }

  issueAccess(
    input: Readonly<{
      userId: string;
      tenantId: string;
      tenantRole: Phase9Role;
      sessionId: string;
      tokenVersion: number;
    }>,
  ): { token: string; claims: Phase9AccessClaims; expiresAt: Date } {
    const issuedAt = Math.floor(this.#now().getTime() / 1_000);
    const claims = phase9AccessClaimsSchema.parse({
      sub: input.userId,
      tenantId: input.tenantId,
      tenantRole: input.tenantRole,
      sessionId: input.sessionId,
      tokenVersion: input.tokenVersion,
      tokenUse: "access",
      jti: randomUUID(),
      iss: this.#issuer,
      aud: this.#audience,
      iat: issuedAt,
      exp: issuedAt + this.#accessTtlSeconds,
    });
    return {
      token: this.#sign(claims),
      claims,
      expiresAt: new Date(claims.exp * 1_000),
    };
  }

  issueRefresh(
    input: Readonly<{
      userId: string;
      tenantId: string;
      sessionId: string;
      familyId: string;
    }>,
  ): { token: string; claims: Phase9RefreshClaims; expiresAt: Date } {
    const issuedAt = Math.floor(this.#now().getTime() / 1_000);
    const claims = phase9RefreshClaimsSchema.parse({
      sub: input.userId,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      familyId: input.familyId,
      tokenUse: "refresh",
      jti: randomUUID(),
      iss: this.#issuer,
      aud: this.#audience,
      iat: issuedAt,
      exp: issuedAt + this.#refreshTtlSeconds,
    });
    return {
      token: this.#sign(claims),
      claims,
      expiresAt: new Date(claims.exp * 1_000),
    };
  }

  issueTenantSelection(input: Readonly<{ emailNormalized: string; userIds: readonly string[] }>): {
    token: string;
    expiresAt: Date;
  } {
    const issuedAt = Math.floor(this.#now().getTime() / 1_000);
    const claims = phase9TenantSelectionClaimsSchema.parse({
      sub: input.emailNormalized,
      userIds: [...input.userIds],
      tokenUse: "tenant_selection",
      jti: randomUUID(),
      iss: this.#issuer,
      aud: this.#audience,
      iat: issuedAt,
      exp: issuedAt + TENANT_SELECTION_TTL_SECONDS,
    });
    return { token: this.#sign(claims), expiresAt: new Date(claims.exp * 1_000) };
  }

  verifyTenantSelection(token: string): Phase9TenantSelectionClaims {
    return phase9TenantSelectionClaimsSchema.parse(this.#verify(token));
  }

  verifyAccess(token: string): Phase9AccessClaims {
    return phase9AccessClaimsSchema.parse(this.#verify(token));
  }

  verifyRefresh(token: string): Phase9RefreshClaims {
    return phase9RefreshClaimsSchema.parse(this.#verify(token));
  }
}

export class Phase9LoginRateLimiter {
  readonly #attempts = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts = 8,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  assertAllowed(key: string): void {
    const cutoff = this.now().getTime() - this.windowMs;
    const recent = (this.#attempts.get(key) ?? []).filter((value) => value > cutoff);
    this.#attempts.set(key, recent);
    if (recent.length >= this.maxAttempts) {
      throw new Phase9ApiError("AUTH_RATE_LIMITED", 429, "Too many authentication attempts");
    }
  }

  recordFailure(key: string): void {
    this.assertAllowed(key);
    this.#attempts.get(key)!.push(this.now().getTime());
  }

  clear(key: string): void {
    this.#attempts.delete(key);
  }
}
