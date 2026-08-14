import { createConnection } from "node:net";
import { extname } from "node:path";
import { malwareScanResultV1Schema, type MalwareScanResultV1 } from "../artifacts/contracts.js";
import { BuiltInArtifactMalwareScanner, type MalwareScanner } from "../artifacts/malware.js";
import { inspectPdfDocument } from "../design-intake/pdf-inspection.js";
import { inspectXlsxContainer } from "../design-intake/xlsx-container.js";
import { inspectProjectUpdateImage } from "../structuring/image-inspection.js";

export const phase11ArtifactMediaTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/acad",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type Phase11ArtifactMediaType = (typeof phase11ArtifactMediaTypes)[number];

export type Phase11ArtifactSecurityPolicy = {
  maxBytes: number;
  maxPdfPages: number;
  maxXlsxEntries: number;
  maxXlsxExpandedBytes: number;
  maxXlsxCompressionRatio: number;
};

export const defaultPhase11ArtifactSecurityPolicy: Phase11ArtifactSecurityPolicy = {
  maxBytes: 100 * 1024 * 1024,
  maxPdfPages: 250,
  maxXlsxEntries: 5_000,
  maxXlsxExpandedBytes: 200 * 1024 * 1024,
  maxXlsxCompressionRatio: 100,
};

export type Phase11ArtifactInspection = {
  mediaType: Phase11ArtifactMediaType;
  malwareScan: MalwareScanResultV1;
  format:
    | { kind: "PDF"; pageCount: number }
    | { kind: "XLSX"; entryCount: number }
    | { kind: "DWG"; version: string }
    | {
        kind: "IMAGE";
        width: number;
        height: number;
        frameCount: number;
      };
};

export class Phase11ArtifactRejectedError extends Error {
  constructor(
    readonly category:
      | "SIZE_INVALID"
      | "MEDIA_TYPE_INVALID"
      | "EXTENSION_MISMATCH"
      | "MALWARE_DETECTED"
      | "MALWARE_SCAN_FAILED"
      | "CONTENT_INVALID",
    message: string,
    readonly malwareScan?: MalwareScanResultV1,
  ) {
    super(message);
    this.name = "Phase11ArtifactRejectedError";
  }
}

function scannerErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\u0000-\u001f]+/gu, " ").slice(0, 1_000);
}

export class ClamAvInstreamScanner implements MalwareScanner {
  readonly #host: string;
  readonly #port: number;
  readonly #timeoutMs: number;
  readonly #now: () => string;

  constructor(options: { host: string; port?: number; timeoutMs?: number; now?: () => string }) {
    this.#host = options.host;
    this.#port = options.port ?? 3310;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async scan(input: {
    data: Uint8Array;
    sha256: string;
    mediaType: string;
    fileName: string;
  }): Promise<MalwareScanResultV1> {
    try {
      const response = await this.#scanBytes(input.data);
      const normalized = response.replace(/\0/gu, "").trim();
      const found = /:\s*(.+)\s+FOUND$/iu.exec(normalized);
      const clean = /:\s*OK$/iu.test(normalized);
      if (!clean && found === null) {
        throw new Error("ClamAV returned an unrecognized response");
      }
      return malwareScanResultV1Schema.parse({
        schemaVersion: 1,
        scannerId: "clamav-instream",
        scannerVersion: "daemon-managed",
        signatureVersion: "daemon-managed",
        status: found === null ? "CLEAN" : "INFECTED",
        scannedAt: this.#now(),
        sha256: input.sha256,
        threatName: found?.[1]?.trim().slice(0, 500) ?? null,
        errorMessage: null,
      });
    } catch (error) {
      return malwareScanResultV1Schema.parse({
        schemaVersion: 1,
        scannerId: "clamav-instream",
        scannerVersion: "daemon-managed",
        signatureVersion: "daemon-managed",
        status: "ERROR",
        scannedAt: this.#now(),
        sha256: input.sha256,
        threatName: null,
        errorMessage: scannerErrorMessage(error),
      });
    }
  }

  #scanBytes(data: Uint8Array): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const socket = createConnection({ host: this.#host, port: this.#port });
      let response = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error !== undefined) reject(error);
        else resolvePromise(response);
      };
      socket.setTimeout(this.#timeoutMs, () => finish(new Error("ClamAV scan timed out")));
      socket.once("error", (error) => finish(error));
      socket.on("data", (chunk: Buffer) => {
        response += chunk.toString("utf8");
        if (response.length > 4_096) {
          finish(new Error("ClamAV response exceeded the safety limit"));
        } else if (response.includes("\0")) {
          finish();
        }
      });
      socket.once("end", () => {
        if (response.length === 0) {
          finish(new Error("ClamAV closed without a response"));
        } else {
          finish();
        }
      });
      socket.once("connect", () => {
        socket.write("zINSTREAM\0");
        const bytes = Buffer.from(data);
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
          const chunk = bytes.subarray(offset, offset + 64 * 1024);
          const size = Buffer.allocUnsafe(4);
          size.writeUInt32BE(chunk.length);
          socket.write(size);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
    });
  }
}

function expectedExtensions(mediaType: Phase11ArtifactMediaType): Set<string> {
  if (mediaType === "application/pdf") return new Set([".pdf"]);
  if (mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return new Set([".xlsx"]);
  }
  if (mediaType === "image/jpeg") return new Set([".jpg", ".jpeg"]);
  if (mediaType === "image/png") return new Set([".png"]);
  if (mediaType === "application/acad") return new Set([".dwg"]);
  return new Set([".webp"]);
}

export class Phase11ArtifactSecurity {
  constructor(
    private readonly scanner: MalwareScanner,
    private readonly policy: Phase11ArtifactSecurityPolicy = defaultPhase11ArtifactSecurityPolicy,
  ) {}

  async inspect(input: {
    body: Buffer;
    originalFileName: string;
    mediaType: string;
    sha256: string;
  }): Promise<Phase11ArtifactInspection> {
    if (input.body.length < 1 || input.body.length > this.policy.maxBytes) {
      throw new Phase11ArtifactRejectedError(
        "SIZE_INVALID",
        `Artifact size must be between 1 and ${this.policy.maxBytes} bytes`,
      );
    }
    if (!phase11ArtifactMediaTypes.includes(input.mediaType as Phase11ArtifactMediaType)) {
      throw new Phase11ArtifactRejectedError(
        "MEDIA_TYPE_INVALID",
        "Unsupported artifact media type",
      );
    }
    const mediaType = input.mediaType as Phase11ArtifactMediaType;
    const extension = extname(input.originalFileName).toLowerCase();
    if (!expectedExtensions(mediaType).has(extension)) {
      throw new Phase11ArtifactRejectedError(
        "EXTENSION_MISMATCH",
        "Artifact extension does not match its declared media type",
      );
    }

    const scan = malwareScanResultV1Schema.parse(
      await this.scanner.scan({
        data: input.body,
        sha256: input.sha256,
        mediaType,
        fileName: input.originalFileName,
      }),
    );
    if (scan.status !== "CLEAN") {
      throw new Phase11ArtifactRejectedError(
        scan.status === "INFECTED" ? "MALWARE_DETECTED" : "MALWARE_SCAN_FAILED",
        scan.status === "INFECTED"
          ? "Artifact was rejected by malware scanning"
          : "Artifact could not be verified by malware scanning",
        scan,
      );
    }

    try {
      if (mediaType === "application/pdf") {
        const document = await inspectPdfDocument(input.body, {
          maxPages: this.policy.maxPdfPages,
        });
        return {
          mediaType,
          malwareScan: scan,
          format: { kind: "PDF", pageCount: document.pageCount },
        };
      }
      if (mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
        const container = inspectXlsxContainer(input.body, {
          maxEntries: this.policy.maxXlsxEntries,
          maxUncompressedBytes: this.policy.maxXlsxExpandedBytes,
          maxCompressionRatio: this.policy.maxXlsxCompressionRatio,
        });
        return {
          mediaType,
          malwareScan: scan,
          format: { kind: "XLSX", entryCount: container.entries.length },
        };
      }
      if (mediaType === "application/acad") {
        const version = input.body.subarray(0, 6).toString("ascii");
        if (!/^AC10\d{2}$/u.test(version)) {
          throw new Error("DWG signature is invalid or unsupported");
        }
        return {
          mediaType,
          malwareScan: scan,
          format: { kind: "DWG", version },
        };
      }
      const image = inspectProjectUpdateImage(input.body);
      if (image.mediaType !== mediaType) {
        throw new Error("Image signature does not match its declared media type");
      }
      return {
        mediaType,
        malwareScan: scan,
        format: {
          kind: "IMAGE",
          width: image.width,
          height: image.height,
          frameCount: image.frameCount,
        },
      };
    } catch (error) {
      throw new Phase11ArtifactRejectedError("CONTENT_INVALID", scannerErrorMessage(error), scan);
    }
  }
}

export function createPhase11ArtifactSecurity(
  options: {
    maxBytes?: number;
    clamAv?: { host: string; port: number; timeoutMs: number } | null;
  } = {},
) {
  const scanner = options.clamAv
    ? new ClamAvInstreamScanner(options.clamAv)
    : new BuiltInArtifactMalwareScanner();
  return new Phase11ArtifactSecurity(scanner, {
    ...defaultPhase11ArtifactSecurityPolicy,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
}
