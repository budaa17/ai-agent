import { describe, expect, it } from "vitest";
import { artifactUploadIdempotencyKey } from "./artifact-idempotency";

describe("artifactUploadIdempotencyKey", () => {
  const sha256 = "a".repeat(64);

  it("ижил project ба file retry хийхэд тогтвортой байна", () => {
    expect(artifactUploadIdempotencyKey("project-a", sha256)).toBe(
      artifactUploadIdempotencyKey("project-a", sha256),
    );
  });

  it("ижил файлыг өөр project-д оруулахад өөр key үүсгэнэ", () => {
    expect(artifactUploadIdempotencyKey("project-a", sha256)).not.toBe(
      artifactUploadIdempotencyKey("project-b", sha256),
    );
  });
});
