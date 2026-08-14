import { describe, expect, it } from "vitest";
import { BuiltInArtifactMalwareScanner } from "../../src/artifacts/index.js";
import {
  buildVectorArchitecturalPdfFixture,
  intakeDesignFile,
} from "../../src/design-intake/index.js";

const now = "2026-08-01T00:00:00.000Z";

function request(data: Uint8Array, fileName = "A-101.pdf") {
  return {
    intakeId: "intake-test",
    tenantId: "tenant-demo",
    projectId: "project-atlas",
    documentId: "document-test",
    artifactId: "artifact-test",
    originalFileName: fileName,
    data,
    declaredMediaType: "PDF" as const,
    scanner: new BuiltInArtifactMalwareScanner(() => now),
    createdAt: now,
    createdBy: "engineer-test",
  };
}

describe("BuildWatch v2.2 design file intake", () => {
  it("validates vector PDF bytes and records rotated page profiles", async () => {
    const output = await intakeDesignFile(
      request(buildVectorArchitecturalPdfFixture({ rotation: 90 })),
    );

    expect(output.result.status).toBe("ACCEPTED");
    expect(output.result.classification).toBe("ARCHITECTURAL_DRAWING");
    expect(output.result.extractionMode).toBe("VECTOR");
    expect(output.result.pages).toMatchObject([{ rotation: 90, contentMode: "VECTOR" }]);
    expect(output.inspectedPdf?.pages[0]?.vectorPaths.length).toBeGreaterThan(0);
  });

  it("records exact duplicate lineage and routes it to review", async () => {
    const data = buildVectorArchitecturalPdfFixture();
    const first = await intakeDesignFile(request(data));
    const second = await intakeDesignFile({
      ...request(data),
      intakeId: "intake-duplicate",
      documentId: "document-duplicate",
      artifactId: "artifact-duplicate",
      existingFiles: [
        {
          documentId: first.result.documentId,
          artifactId: first.result.artifactId,
          sha256: first.result.sha256,
        },
      ],
    });

    expect(second.result.status).toBe("REVIEW_REQUIRED");
    expect(second.result.duplicate).toEqual({
      exactDuplicate: true,
      duplicateOfDocumentId: "document-test",
      duplicateOfArtifactId: "artifact-test",
    });
  });

  it("rejects malware and file-extension spoofing", async () => {
    const marker = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!",
      "ascii",
    );
    const infected = new Uint8Array(
      Buffer.concat([Buffer.from(buildVectorArchitecturalPdfFixture()), marker]),
    );
    const output = await intakeDesignFile(request(infected, "drawing.xlsx"));

    expect(output.result.status).toBe("REJECTED");
    expect(output.result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["DESIGN_FILE_INFECTED", "DESIGN_FILE_EXTENSION_MISMATCH"]),
    );
  });
});
