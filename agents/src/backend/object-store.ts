import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Phase9ApiError } from "./contracts.js";
import type { Phase9ObjectStore } from "./api.js";
import type { Phase9FileAssetRecord } from "./store.js";

export class LocalPhase9ObjectStore implements Phase9ObjectStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  #path(asset: Phase9FileAssetRecord): string {
    if (isAbsolute(asset.objectKey)) {
      throw new Phase9ApiError("ARTIFACT_ACCESS_DENIED", 403, "Artifact access denied");
    }
    const path = resolve(this.#root, asset.objectKey);
    const relativePath = relative(this.#root, path);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Phase9ApiError("ARTIFACT_ACCESS_DENIED", 403, "Artifact access denied");
    }
    return path;
  }

  async read(asset: Phase9FileAssetRecord) {
    const path = this.#path(asset);
    const [metadata, body] = await Promise.all([stat(path), readFile(path)]);
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (!metadata.isFile() || metadata.size !== asset.sizeBytes || sha256 !== asset.sha256) {
      throw new Phase9ApiError("ARTIFACT_ACCESS_DENIED", 403, "Artifact access denied");
    }
    return {
      contentType: asset.mediaType,
      contentLength: body.length,
      body,
    };
  }
}

export class InMemoryPhase9ObjectStore implements Phase9ObjectStore {
  readonly #objects: ReadonlyMap<string, Buffer>;

  constructor(objects: Readonly<Record<string, Buffer>>) {
    this.#objects = new Map(
      Object.entries(objects).map(([key, value]) => [key, Buffer.from(value)]),
    );
  }

  async read(asset: Phase9FileAssetRecord) {
    const body = this.#objects.get(asset.objectKey);
    if (body === undefined) {
      throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Artifact not found");
    }
    return {
      contentType: asset.mediaType,
      contentLength: body.length,
      body: Buffer.from(body),
    };
  }
}
