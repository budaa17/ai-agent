import { resolve } from "node:path";
import { validatePhase11ReleaseEvidence } from "../operations/index.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const path = resolve(argument("--evidence") ?? "data/release-evidence/phase11-evidence.json");
  const manifest = await validatePhase11ReleaseEvidence(path);
  process.stdout.write(
    `Phase 11 FULL RELEASE: PASS release=${manifest.release} photos=${manifest.photoDataset.imageCount} drawingBoqCases=${manifest.drawingBoq.caseCount}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Phase 11 FULL RELEASE: BLOCKED (${error instanceof Error ? error.message : String(error)})\n`,
  );
  process.exitCode = 1;
});
