import { resolve } from "node:path";
import { scanRepositoryForSecrets } from "../security/secret-scan.js";

async function main() {
  const root = resolve(process.argv[2] ?? ".");
  const findings = await scanRepositoryForSecrets(root);
  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(
        `${finding.ruleId} ${finding.file}:${finding.line} fingerprint=${finding.fingerprint}\n`,
      );
    }
    throw new Error(`Secret scan found ${findings.length} high-confidence finding(s)`);
  }
  process.stdout.write("Phase 11 secret scan: PASS (no high-confidence secrets)\n");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Phase 11 secret scan failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
