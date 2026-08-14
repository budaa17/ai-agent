import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentLogger, redactAgentLogValue } from "../../src/runtime/logging.js";
import { scanRepositoryForSecrets } from "../../src/security/secret-scan.js";

describe("BuildWatch Phase 11 privacy and secret scanning", () => {
  it("redacts structured and inline secrets while suppressing content", () => {
    const lines: string[] = [];
    const logger = createAgentLogger({
      service: "privacy-test",
      now: () => "2026-08-04T00:00:00.000Z",
      sink: (line) => lines.push(line),
    });
    logger.info("request", {
      authorization: "Bearer private-token-value",
      note: "password=NeverLogThis123!",
      prompt: "private construction report",
      tenantTag: undefined,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("private-token-value");
    expect(lines[0]).not.toContain("NeverLogThis123!");
    expect(lines[0]).not.toContain("private construction report");
    expect(lines[0]).toContain("[REDACTED_SECRET]");
    expect(lines[0]).toContain("[CONTENT_LOGGING_DISABLED]");
    expect(lines[0]).not.toContain('"tenantTag"');
    expect(lines[0]).not.toContain('"undefined"');
    expect(
      redactAgentLogValue(`api_key=${"sk"}-${"proj"}-super-secret-value-123456789`),
    ).not.toContain("super-secret-value");
  });

  it("reports only fingerprint metadata and excludes real .env files", async () => {
    const root = await mkdtemp(join(tmpdir(), "buildwatch-secret-scan-"));
    try {
      await mkdir(join(root, "src"));
      await writeFile(
        join(root, "src", "leak.ts"),
        `export const leaked = "${"sk"}-${"proj"}-abcdefghijklmnopqrstuvwxyz123456";\n`,
      );
      await writeFile(
        join(root, ".env"),
        `OPENAI_API_KEY=${"sk"}-${"proj"}-this-file-is-explicitly-excluded-123456\n`,
      );
      const findings = await scanRepositoryForSecrets(root);
      expect(findings).toEqual([
        expect.objectContaining({
          ruleId: "OPENAI_API_KEY",
          file: "src/leak.ts",
          line: 1,
          fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/u),
        }),
      ]);
      expect(JSON.stringify(findings)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
