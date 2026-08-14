import { createHash } from "node:crypto";
import { SupabaseArtifactStorage } from "../../src/backend/supabase-artifact-storage.js";
import type { Phase9FileAssetRecord } from "../../src/backend/store.js";

function asset(body: Buffer, overrides: Partial<Phase9FileAssetRecord> = {}): Phase9FileAssetRecord {
  return {
    id: "asset-1",
    tenantId: "tenant-1",
    projectId: "project-1",
    bucket: "buildwatch-artifacts",
    objectKey: "tenant-1/project-1/asset-1/plan.pdf",
    originalFileName: "plan.pdf",
    mediaType: "application/pdf",
    sizeBytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
    status: "AVAILABLE",
    ...overrides,
  };
}

describe("SupabaseArtifactStorage", () => {
  it("uploads and removes a private object with server-only credentials", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const storage = new SupabaseArtifactStorage({
      projectUrl: "https://example.supabase.co/",
      serviceRoleKey: "service-role-secret-value",
      bucket: "buildwatch-artifacts",
      fetchImpl,
    });

    const written = await storage.put({
      tenantId: "tenant-1",
      projectId: "project-1",
      artifactId: "asset-1",
      originalFileName: "../site зураг.png",
      mediaType: "image/png",
      body: Buffer.from("image-bytes"),
    });
    expect(written).toMatchObject({
      bucket: "buildwatch-artifacts",
      objectKey: "tenant-1/project-1/asset-1/site-.png",
    });
    expect(requests[0]?.url).toBe(
      "https://example.supabase.co/storage/v1/object/buildwatch-artifacts/tenant-1/project-1/asset-1/site-.png",
    );
    expect(requests[0]?.init?.method).toBe("POST");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer service-role-secret-value",
      apikey: "service-role-secret-value",
      "content-type": "image/png",
      "x-upsert": "false",
    });

    await written.remove();
    expect(requests[1]?.init?.method).toBe("DELETE");
  });

  it("downloads only from its configured bucket and verifies stored bytes", async () => {
    const body = Buffer.from("verified-pdf");
    const storage = new SupabaseArtifactStorage({
      projectUrl: "https://example.supabase.co",
      serviceRoleKey: "service-role-secret-value",
      bucket: "buildwatch-artifacts",
      fetchImpl: (async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        })) as typeof fetch,
    });

    await expect(storage.read(asset(body))).resolves.toMatchObject({
      contentType: "application/pdf",
      contentLength: body.length,
      body,
    });
    await expect(storage.read(asset(body, { bucket: "another-bucket" }))).rejects.toMatchObject({
      code: "ARTIFACT_ACCESS_DENIED",
      status: 403,
    });
    await expect(storage.read(asset(body, { sha256: "0".repeat(64) }))).rejects.toMatchObject({
      code: "ARTIFACT_ACCESS_DENIED",
      status: 403,
    });
  });
});
