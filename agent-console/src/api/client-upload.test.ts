import { describe, expect, it } from "vitest";
import {
  MAX_ARTIFACT_UPLOAD_BYTES,
  artifactUploadSizeError,
  encodeArtifactFileNameHeader,
} from "./client";

describe("artifact filename header encoding", () => {
  it("constructs an ASCII-safe header for a Mongolian PDF name", () => {
    const fileName = "Барилгын зураг №1.pdf";
    const encoded = encodeArtifactFileNameHeader(fileName);
    const headers = new Headers({
      "x-file-name": encoded,
      "x-file-name-encoding": "percent",
    });

    expect(headers.get("x-file-name")).toBe(encodeURIComponent(fileName));
    expect(headers.get("x-file-name-encoding")).toBe("percent");
    expect(decodeURIComponent(encoded)).toBe(fileName);
  });

  it("keeps legacy ASCII names round-trippable", () => {
    const fileName = "progress-plan 01.pdf";
    expect(decodeURIComponent(encodeArtifactFileNameHeader(fileName))).toBe(fileName);
  });

  it("accepts the 100 MiB boundary and explains oversized files before upload", () => {
    expect(artifactUploadSizeError(MAX_ARTIFACT_UPLOAD_BYTES)).toBeNull();
    expect(artifactUploadSizeError(MAX_ARTIFACT_UPLOAD_BYTES + 1)).toContain("100 MiB-ээс ихгүй");
    expect(artifactUploadSizeError(0)).toContain("Хоосон файл");
  });
});
