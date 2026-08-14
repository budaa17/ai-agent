import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  Phase9ApiError,
  phase9SignedArtifactRequestSchema,
  phase9SignedArtifactResultSchema,
  type Phase9AuthenticatedPrincipal,
} from "./contracts.js";
import { requireProjectPermission } from "./authorization.js";
import type { Phase9FileAssetRecord, Phase9Store } from "./store.js";

export class Phase9ArtifactService {
  readonly #secret: Buffer;

  constructor(
    private readonly store: Phase9Store,
    secret: string,
    private readonly publicBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(secret) < 32) {
      throw new Error("Phase 9 artifact signing secret must be at least 32 bytes");
    }
    this.#secret = Buffer.from(secret, "utf8");
  }

  #signature(payload: string): Buffer {
    return createHmac("sha256", this.#secret).update(payload).digest();
  }

  async issueSignedUrl(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    artifactId: string,
    input: unknown,
    correlationId: string,
  ) {
    const request = phase9SignedArtifactRequestSchema.parse(input);
    return this.store.transaction(async (transaction) => {
      const [asset, membership] = await Promise.all([
        transaction.getFileAsset(principal.tenantId, projectId, artifactId),
        transaction.findMembership(principal.tenantId, projectId, principal.userId),
      ]);
      const actorRole = requireProjectPermission(
        principal,
        membership?.role ?? null,
        "ARTIFACT_READ",
      );
      if (asset === null || asset.status !== "AVAILABLE") {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Artifact not found");
      }
      const expiresAt = new Date(this.now().getTime() + request.expiresInSeconds * 1_000);
      const nonce = randomUUID();
      const payload = [
        principal.tenantId,
        projectId,
        artifactId,
        principal.userId,
        Math.floor(expiresAt.getTime() / 1_000),
        nonce,
        asset.sha256,
      ].join("\n");
      const parameters = new URLSearchParams({
        tid: principal.tenantId,
        pid: projectId,
        uid: principal.userId,
        exp: String(Math.floor(expiresAt.getTime() / 1_000)),
        nonce,
        sig: this.#signature(payload).toString("base64url"),
      });
      await transaction.createAudit({
        id: randomUUID(),
        tenantId: principal.tenantId,
        projectId,
        actorUserId: principal.userId,
        actorRole,
        action: "ARTIFACT_SIGNED_URL_ISSUED",
        entityType: "FILE_ASSET",
        entityId: artifactId,
        reason: null,
        correlationId,
        sourceVersion: "buildwatch-v22-phase9-artifact-v1",
        beforeHash: null,
        afterHash: asset.sha256,
        metadata: { expiresAt: expiresAt.toISOString(), nonce },
        occurredAt: this.now().toISOString(),
      });
      return phase9SignedArtifactResultSchema.parse({
        artifactId,
        url: `${this.publicBaseUrl.replace(/\/$/, "")}/v1/artifacts/${encodeURIComponent(artifactId)}/content?${parameters}`,
        expiresAt: expiresAt.toISOString(),
      });
    });
  }

  async resolveSignedUrl(
    artifactId: string,
    query: Readonly<Record<string, string | undefined>>,
  ): Promise<Phase9FileAssetRecord> {
    const tenantId = query.tid;
    const projectId = query.pid;
    const userId = query.uid;
    const expires = query.exp;
    const nonce = query.nonce;
    const signature = query.sig;
    if (
      tenantId === undefined ||
      projectId === undefined ||
      userId === undefined ||
      expires === undefined ||
      nonce === undefined ||
      signature === undefined ||
      !/^\d+$/.test(expires) ||
      Number(expires) <= Math.floor(this.now().getTime() / 1_000)
    ) {
      throw new Phase9ApiError("ARTIFACT_ACCESS_DENIED", 403, "Artifact access denied");
    }
    return this.store.read(async (transaction) => {
      const [asset, membership, user] = await Promise.all([
        transaction.getFileAsset(tenantId, projectId, artifactId),
        transaction.findMembership(tenantId, projectId, userId),
        transaction.findUserById(tenantId, userId),
      ]);
      if (asset === null || asset.status !== "AVAILABLE" || user?.status !== "ACTIVE") {
        throw new Phase9ApiError("ARTIFACT_ACCESS_DENIED", 403, "Artifact access denied");
      }
      try {
        requireProjectPermission(
          {
            userId: user.id,
            tenantId: user.tenantId,
            tenantRole: user.tenantRole,
            sessionId: "signed-artifact-session",
            tokenVersion: user.tokenVersion,
          },
          membership?.role ?? null,
          "ARTIFACT_READ",
        );
      } catch {
        throw new Phase9ApiError("ARTIFACT_ACCESS_DENIED", 403, "Artifact access denied");
      }
      const payload = [tenantId, projectId, artifactId, userId, expires, nonce, asset.sha256].join(
        "\n",
      );
      const expected = this.#signature(payload);
      const actual = Buffer.from(signature, "base64url");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new Phase9ApiError("ARTIFACT_ACCESS_DENIED", 403, "Artifact access denied");
      }
      return asset;
    });
  }
}
