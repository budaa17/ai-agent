import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  projectAnalysisSnapshotV1Schema,
  type ProjectAnalysisSnapshotV1,
} from "../contracts/index.js";
import { analyzeProjectSnapshot } from "../production-analysis/index.js";
import {
  BUILDWATCH_SIMULATION_WINDOW_END,
  buildBuildWatchSimulation,
  replayBuildWatchSimulation,
} from "../simulation/index.js";

type Options = {
  asOfDate: string;
  outputPath: string | null;
  snapshotPath: string | null;
};

function parseArguments(argv: string[]): Options {
  let asOfDate = BUILDWATCH_SIMULATION_WINDOW_END;
  let outputPath: string | null = null;
  let snapshotPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--") {
      continue;
    }

    if (argument === "--as-of") {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error("--as-of requires YYYY-MM-DD");
      }

      asOfDate = value;
      index += 1;
      continue;
    }

    if (argument === "--output") {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error("--output requires a file path");
      }

      outputPath = path.resolve(value);
      index += 1;
      continue;
    }

    if (argument === "--snapshot") {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error("--snapshot requires a JSON file path");
      }

      snapshotPath = path.resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { asOfDate, outputPath, snapshotPath };
}

async function loadSnapshot(options: Options): Promise<ProjectAnalysisSnapshotV1> {
  if (options.snapshotPath !== null) {
    const content = await readFile(options.snapshotPath, "utf8");
    return projectAnalysisSnapshotV1Schema.parse(JSON.parse(content));
  }

  return replayBuildWatchSimulation(buildBuildWatchSimulation(), options.asOfDate);
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const snapshot = await loadSnapshot(options);
  const analysis = analyzeProjectSnapshot(snapshot);
  const summary = {
    analysisId: analysis.analysisId,
    asOf: analysis.asOf,
    projectedEndDate: analysis.forecast.projectedEndDate,
    delayWorkingDays: analysis.forecast.delayWorkingDays,
    forecastConfidence: analysis.forecast.confidence,
    deviations: analysis.deviations.length,
    byRule: Object.fromEntries(
      analysis.ruleEvaluations.map((evaluation) => [evaluation.ruleId, evaluation.matchedCount]),
    ),
    scenarios: analysis.recoveryScenarios.map((scenario) => ({
      type: scenario.type,
      targetWorkItemIds: scenario.targetWorkItemIds,
      estimatedImpactDays: scenario.estimatedImpactDays,
      dataSufficient: scenario.dataSufficient,
    })),
  };

  if (options.outputPath !== null) {
    await mkdir(path.dirname(options.outputPath), {
      recursive: true,
    });
    await writeFile(options.outputPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (options.outputPath !== null) {
    process.stdout.write(`output=${options.outputPath}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Phase 1 analysis failed: ${message}\n`);
  process.exitCode = 1;
});
