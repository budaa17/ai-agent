import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BUILDWATCH_SIMULATION_SEED, buildBuildWatchSimulation } from "../simulation/index.js";

type Arguments = {
  outputDirectory: string;
  seed: string;
};

function parseArguments(argv: string[]): Arguments {
  let outputDirectory = "data/simulation/phase1";
  let seed = BUILDWATCH_SIMULATION_SEED;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--") {
      continue;
    }

    if (argument === "--output") {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error("--output requires a directory");
      }

      outputDirectory = value;
      index += 1;
      continue;
    }

    if (argument === "--seed") {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error("--seed requires a value");
      }

      seed = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    outputDirectory: path.resolve(outputDirectory),
    seed,
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const simulation = buildBuildWatchSimulation(options.seed);

  await mkdir(options.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(options.outputDirectory, "snapshot.json"),
      `${JSON.stringify(simulation.snapshot, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(options.outputDirectory, "private-snapshot.json"),
      `${JSON.stringify(simulation.privateSnapshot, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(options.outputDirectory, "answer-key.json"),
      `${JSON.stringify(simulation.answerKey, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(options.outputDirectory, "manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: simulation.schemaVersion,
          seed: simulation.seed,
          generatedAt: simulation.generatedAt,
          windowStart: simulation.windowStart,
          windowEnd: simulation.windowEnd,
          files: {
            agentSnapshot: "snapshot.json",
            privateTenantFixture: "private-snapshot.json",
            hiddenAnswerKey: "answer-key.json",
          },
          counts: {
            workItems: simulation.snapshot.workItems.length,
            dependencies: simulation.snapshot.dependencies.length,
            dailyReports: simulation.snapshot.dailyReports.length,
            progressEntries: simulation.snapshot.progressEntries.length,
            answerIssues: simulation.answerKey.issues.length,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);

  process.stdout.write(
    [
      "Phase 1 simulation generated.",
      `output=${options.outputDirectory}`,
      `seed=${simulation.seed}`,
      `workItems=${simulation.snapshot.workItems.length}`,
      `dailyReports=${simulation.snapshot.dailyReports.length}`,
      `answerIssues=${simulation.answerKey.issues.length}`,
      "The answer key is separate and must not be passed to an agent.",
    ].join("\n") + "\n",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Simulation generation failed: ${message}\n`);
  process.exitCode = 1;
});
