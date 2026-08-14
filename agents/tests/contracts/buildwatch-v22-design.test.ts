import { describe, expect, it } from "vitest";
import {
  designDocumentManifestV1Schema,
  designElementCandidateV1Schema,
  drawingRevisionV1Schema,
  verifiedDrawingScaleV1Schema,
} from "../../src/contracts/index.js";
import {
  buildDesignDocumentManifest,
  buildDesignElementCandidate,
  buildDrawingRevision,
  buildVerifiedDrawingScale,
} from "./buildwatch-v22-fixtures.js";

describe("BuildWatch v2.2 design contracts", () => {
  it("accepts a vector-PDF manifest, revision, verified scale, and reviewed candidate", () => {
    expect(
      designDocumentManifestV1Schema.parse(buildDesignDocumentManifest()).documents,
    ).toHaveLength(1);
    expect(drawingRevisionV1Schema.parse(buildDrawingRevision()).pages).toHaveLength(1);
    expect(verifiedDrawingScaleV1Schema.parse(buildVerifiedDrawingScale()).status).toBe("VERIFIED");
    expect(designElementCandidateV1Schema.parse(buildDesignElementCandidate()).official).toBe(
      false,
    );
  });

  it("rejects duplicate design identifiers without lineage", () => {
    const manifest = buildDesignDocumentManifest();
    manifest.documents.push({
      ...structuredClone(manifest.documents[0]!),
      duplicateOfDocumentId: null,
    });

    expect(designDocumentManifestV1Schema.safeParse(manifest).success).toBe(false);
  });

  it("rejects a verified scale with a cross-tenant source", () => {
    const scale = buildVerifiedDrawingScale();
    scale.sourceRefs[0]!.tenantId = "tenant-private";

    expect(verifiedDrawingScaleV1Schema.safeParse(scale).success).toBe(false);
  });

  it("rejects accepted candidates without an engineer approval", () => {
    const candidate = buildDesignElementCandidate();
    candidate.reviewDecision = null;

    expect(designElementCandidateV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("rejects unknown design fields and versions", () => {
    const manifest = buildDesignDocumentManifest();

    expect(
      designDocumentManifestV1Schema.safeParse({
        ...manifest,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      designDocumentManifestV1Schema.safeParse({
        ...manifest,
        futureField: true,
      }).success,
    ).toBe(false);
  });
});
