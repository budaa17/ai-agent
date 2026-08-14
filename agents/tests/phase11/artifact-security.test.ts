import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { BuiltInArtifactMalwareScanner } from "../../src/artifacts/index.js";
import { ClamAvInstreamScanner, Phase11ArtifactSecurity } from "../../src/backend/index.js";
import { buildEngineeringWorkbookFixture } from "../../src/design-intake/fixtures.js";
import { createPngFixture } from "../structuring/image-fixtures.js";

function sha256(body: Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}

describe("BuildWatch Phase 11 artifact security", () => {
  it("accepts a clean image only when signature, extension, and MIME agree", async () => {
    const body = createPngFixture(64, 32);
    const security = new Phase11ArtifactSecurity(
      new BuiltInArtifactMalwareScanner(() => "2026-08-04T00:00:00.000Z"),
    );
    const inspection = await security.inspect({
      body,
      originalFileName: "site-progress.png",
      mediaType: "image/png",
      sha256: sha256(body),
    });

    expect(inspection).toMatchObject({
      mediaType: "image/png",
      malwareScan: { status: "CLEAN" },
      format: { kind: "IMAGE", width: 64, height: 32, frameCount: 1 },
    });
  });

  it("rejects content-type spoofing before storage", async () => {
    const body = createPngFixture();
    const security = new Phase11ArtifactSecurity(new BuiltInArtifactMalwareScanner());
    await expect(
      security.inspect({
        body,
        originalFileName: "spoofed.jpg",
        mediaType: "image/jpeg",
        sha256: sha256(body),
      }),
    ).rejects.toMatchObject({
      category: "CONTENT_INVALID",
    });
  });

  it("rejects malware before format parsing", async () => {
    const body = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!",
      "ascii",
    );
    const security = new Phase11ArtifactSecurity(new BuiltInArtifactMalwareScanner());
    await expect(
      security.inspect({
        body,
        originalFileName: "infected.pdf",
        mediaType: "application/pdf",
        sha256: sha256(body),
      }),
    ).rejects.toMatchObject({
      category: "MALWARE_DETECTED",
      malwareScan: { status: "INFECTED" },
    });
  });

  it("inspects an XLSX container and blocks extension mismatch", async () => {
    const body = Buffer.from(await buildEngineeringWorkbookFixture());
    const security = new Phase11ArtifactSecurity(new BuiltInArtifactMalwareScanner());
    const inspection = await security.inspect({
      body,
      originalFileName: "baseline.xlsx",
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sha256: sha256(body),
    });
    expect(inspection.format).toMatchObject({ kind: "XLSX" });

    await expect(
      security.inspect({
        body,
        originalFileName: "baseline.zip",
        mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sha256: sha256(body),
      }),
    ).rejects.toMatchObject({
      category: "EXTENSION_MISMATCH",
    });
  });

  it("accepts a DWG only when its AutoCAD signature and extension agree", async () => {
    const body = Buffer.concat([Buffer.from("AC1032", "ascii"), Buffer.alloc(64)]);
    const security = new Phase11ArtifactSecurity(new BuiltInArtifactMalwareScanner());
    await expect(
      security.inspect({
        body,
        originalFileName: "house-plan.dwg",
        mediaType: "application/acad",
        sha256: sha256(body),
      }),
    ).resolves.toMatchObject({ format: { kind: "DWG", version: "AC1032" } });
  });

  it("implements ClamAV INSTREAM framing and fail-closed response parsing", async () => {
    const server = createServer((socket) => {
      let input = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        input = Buffer.concat([input, chunk]);
      });
      socket.on("end", () => {
        expect(input.subarray(0, 10).toString("ascii")).toBe("zINSTREAM\0");
        socket.end("stream: OK\0");
      });
    });
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("ClamAV test server address is unavailable");
      }
      const body = Buffer.from("safe");
      const scanner = new ClamAvInstreamScanner({
        host: "127.0.0.1",
        port: address.port,
        timeoutMs: 2_000,
        now: () => "2026-08-04T00:00:00.000Z",
      });
      await expect(
        scanner.scan({
          data: body,
          sha256: sha256(body),
          mediaType: "application/pdf",
          fileName: "safe.pdf",
        }),
      ).resolves.toMatchObject({ status: "CLEAN", scannerId: "clamav-instream" });
    } finally {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  });
});
