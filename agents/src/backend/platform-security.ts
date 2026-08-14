import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Phase9ApiError } from "./contracts.js";
import {
  PLATFORM_TOKEN_AUDIENCE,
  PLATFORM_TOKEN_ISSUER,
  platformAccessClaimsSchema,
  platformRefreshClaimsSchema,
  type PlatformAccessClaims,
  type PlatformRefreshClaims,
  type PlatformRole,
} from "./platform-contracts.js";

const PLATFORM_TOKEN_KID = "buildwatch-platform-hs256-v1";

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function invalidToken(): never {
  throw new Phase9ApiError("AUTH_TOKEN_INVALID", 401, "Invalid authentication token");
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) invalidToken();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) invalidToken();
  return decoded;
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(decodeCanonicalBase64Url(value).toString("utf8"));
  } catch (error) {
    if (error instanceof Phase9ApiError) throw error;
    invalidToken();
  }
}

export interface PlatformTokenServiceOptions {
  secret: string;
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
  now?: () => Date;
}

/**
 * A deliberately separate token codec for platform identities. Its fixed kid,
 * audience and strict `principalKind` claims make tenant/platform token
 * substitution fail even while both token families share a rollout secret.
 */
export class PlatformTokenService {
  readonly #secret: Buffer;
  readonly #accessTtlSeconds: number;
  readonly #refreshTtlSeconds: number;
  readonly #now: () => Date;

  constructor(options: PlatformTokenServiceOptions) {
    if (Buffer.byteLength(options.secret, "utf8") < 32) {
      throw new Error("Platform JWT secret must be at least 32 bytes");
    }
    this.#secret = Buffer.from(options.secret, "utf8");
    this.#accessTtlSeconds = options.accessTtlSeconds ?? 900;
    this.#refreshTtlSeconds = options.refreshTtlSeconds ?? 2_592_000;
    this.#now = options.now ?? (() => new Date());
  }

  #sign(payload: Record<string, unknown>): string {
    const header = encodeJson({ alg: "HS256", typ: "JWT", kid: PLATFORM_TOKEN_KID });
    const body = encodeJson(payload);
    const signature = createHmac("sha256", this.#secret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return `${header}.${body}.${signature}`;
  }

  #verify(token: string): unknown {
    const parts = token.split(".");
    if (parts.length !== 3) invalidToken();
    const [header, payload, signature] = parts as [string, string, string];
    const decodedHeader = decodeJson(header) as Record<string, unknown>;
    if (
      decodedHeader.alg !== "HS256" ||
      decodedHeader.typ !== "JWT" ||
      decodedHeader.kid !== PLATFORM_TOKEN_KID
    ) {
      invalidToken();
    }
    const expected = createHmac("sha256", this.#secret).update(`${header}.${payload}`).digest();
    const actual = decodeCanonicalBase64Url(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) invalidToken();
    const claims = decodeJson(payload) as Record<string, unknown>;
    const nowSeconds = Math.floor(this.#now().getTime() / 1_000);
    if (
      claims.iss !== PLATFORM_TOKEN_ISSUER ||
      claims.aud !== PLATFORM_TOKEN_AUDIENCE ||
      claims.principalKind !== "PLATFORM" ||
      typeof claims.exp !== "number" ||
      typeof claims.iat !== "number" ||
      claims.exp <= nowSeconds ||
      claims.iat > nowSeconds + 60
    ) {
      invalidToken();
    }
    return claims;
  }

  issueAccess(
    input: Readonly<{
      principalId: string;
      platformRole: PlatformRole;
      sessionId: string;
      tokenVersion: number;
    }>,
  ): { token: string; claims: PlatformAccessClaims; expiresAt: Date } {
    const issuedAt = Math.floor(this.#now().getTime() / 1_000);
    const claims = platformAccessClaimsSchema.parse({
      sub: input.principalId,
      principalKind: "PLATFORM",
      platformRole: input.platformRole,
      sessionId: input.sessionId,
      tokenVersion: input.tokenVersion,
      tokenUse: "access",
      jti: randomUUID(),
      iss: PLATFORM_TOKEN_ISSUER,
      aud: PLATFORM_TOKEN_AUDIENCE,
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
      principalId: string;
      sessionId: string;
      familyId: string;
    }>,
  ): { token: string; claims: PlatformRefreshClaims; expiresAt: Date } {
    const issuedAt = Math.floor(this.#now().getTime() / 1_000);
    const claims = platformRefreshClaimsSchema.parse({
      sub: input.principalId,
      principalKind: "PLATFORM",
      sessionId: input.sessionId,
      familyId: input.familyId,
      tokenUse: "refresh",
      jti: randomUUID(),
      iss: PLATFORM_TOKEN_ISSUER,
      aud: PLATFORM_TOKEN_AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + this.#refreshTtlSeconds,
    });
    return {
      token: this.#sign(claims),
      claims,
      expiresAt: new Date(claims.exp * 1_000),
    };
  }

  verifyAccess(token: string): PlatformAccessClaims {
    try {
      return platformAccessClaimsSchema.parse(this.#verify(token));
    } catch (error) {
      if (error instanceof Phase9ApiError) throw error;
      invalidToken();
    }
  }

  verifyRefresh(token: string): PlatformRefreshClaims {
    try {
      return platformRefreshClaimsSchema.parse(this.#verify(token));
    } catch (error) {
      if (error instanceof Phase9ApiError) throw error;
      invalidToken();
    }
  }
}
