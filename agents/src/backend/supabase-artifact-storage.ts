import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { Phase9ObjectStore } from "./api.js";
import { Phase9ApiError } from "./contracts.js";
import type { Phase10ArtifactStorage, Phase10ArtifactWrite } from "./phase10-service.js";
import type { Phase9FileAssetRecord } from "./store.js";

export type SupabaseArtifactStorageOptions = Readonly<{
  projectUrl: string;
  serviceRoleKey: string;
  bucket: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  upsertWrites?: boolean;
}>;

function encodedObjectPath(objectKey: string): string {
  const segments = objectKey.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Phase9ApiError("ARTIFACT_ACCESS_DENIED", 403, "Artifact access denied");
  }
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function safeArtifactName(originalFileName: string): string {
  return basename(originalFileName).replace(/[^A-Za-z0-9._-]+/gu, "-") || "artifact.bin";
}

export class SupabaseArtifactStorage implements Phase10ArtifactStorage, Phase9ObjectStore {
  readonly #baseUrl: string;
  readonly #serviceRoleKey: string;
  readonly #bucket: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #upsertWrites: boolean;

  constructor(options: SupabaseArtifactStorageOptions) {
    this.#baseUrl = options.projectUrl.replace(/\/+$/u, "");
    this.#serviceRoleKey = options.serviceRoleKey;
    this.#bucket = options.bucket;
    this.#timeoutMs = options.requestTimeoutMs ?? 30_000;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#upsertWrites = options.upsertWrites ?? false;
  }

  async put(
    input: Readonly<{
      tenantId: string;
      projectId: string;
      artifactId: string;
      originalFileName: string;
      mediaType: string;
      body: Buffer;
    }>,
  ): Promise<Phase10ArtifactWrite> {
    const objectKey = [
      input.tenantId,
      input.projectId,
      input.artifactId,
      safeArtifactName(input.originalFileName),
    ].join("/");
    const response = await this.#request(objectKey, {
      method: "POST",
      headers: {
        "content-type": input.mediaType,
        "x-upsert": String(this.#upsertWrites),
      },
      body: input.body,
    });
    if (!response.ok) {
      throw this.#failure("upload", response);
    }
    return {
      bucket: this.#bucket,
      objectKey,
      remove: async () => {
        const deleted = await this.#request(objectKey, { method: "DELETE" });
        if (!deleted.ok && deleted.status !== 404) {
          throw this.#failure("delete", deleted);
        }
      },
    };
  }

  async read(asset: Phase9FileAssetRecord) {
    if (asset.bucket !== this.#bucket) {
      throw new Phase9ApiError("ARTIFACT_ACCESS_DENIED", 403, "Artifact access denied");
    }
    const response = await this.#request(asset.objectKey, { method: "GET" });
    if (!response.ok) {
      if (response.status === 404) {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Artifact not found");
      }
      throw this.#failure("download", response);
    }
    const body = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (body.length !== asset.sizeBytes || sha256 !== asset.sha256) {
      throw new Phase9ApiError("ARTIFACT_ACCESS_DENIED", 403, "Artifact access denied");
    }
    return {
      contentType: asset.mediaType,
      contentLength: body.length,
      body,
    };
  }

  async #request(objectKey: string, init: RequestInit): Promise<Response> {
    const url = `${this.#baseUrl}/storage/v1/object/${encodeURIComponent(this.#bucket)}/${encodedObjectPath(objectKey)}`;
    try {
      return await this.#fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${this.#serviceRoleKey}`,
          apikey: this.#serviceRoleKey,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new Phase9ApiError("INTERNAL_ERROR", 502, "Artifact storage is unavailable");
    }
  }

  #failure(operation: string, response: Response): Phase9ApiError {
    return new Phase9ApiError("INTERNAL_ERROR", 502, `Artifact storage ${operation} failed`, {
      providerStatus: response.status,
    });
  }
}
