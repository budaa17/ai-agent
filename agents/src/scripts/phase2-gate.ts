import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadA1RealImageEvaluationManifest, runPhase2ProductionGate } from "../phase2/index.js";

function valueAfter(args: readonly string[], name: string) {
  const index = args.indexOf(name);

  if (index < 0) {
    return undefined;
  }

  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const manifestPath = valueAfter(args, "--real-image-manifest");
  const outputPath = valueAfter(args, "--output");
  const release = args.includes("--release");
  const manifest =
    manifestPath === undefined
      ? undefined
      : await loadA1RealImageEvaluationManifest(path.resolve(manifestPath));
  const report = await runPhase2ProductionGate({
    realImageManifest: manifest,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;

  if (outputPath !== undefined) {
    const absolute = path.resolve(outputPath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, json, "utf8");
  }

  process.stdout.write(json);

  if (release ? !report.releasePass : !report.technicalPass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Phase 2 gate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
