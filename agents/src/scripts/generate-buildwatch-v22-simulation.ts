import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BUILDWATCH_OPERATIONAL_SIMULATION_SEED,
  buildBuildWatchOperationalSimulation,
  operationalSimulationCounts,
} from "../simulation/index.js";

type Arguments = {
  outputDirectory: string;
  seed: string;
};

function parseArguments(argv: string[]): Arguments {
  let outputDirectory = "data/simulation/buildwatch-v22";
  let seed = BUILDWATCH_OPERATIONAL_SIMULATION_SEED;

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
  const simulation = buildBuildWatchOperationalSimulation(options.seed);
  const counts = operationalSimulationCounts(simulation);

  await mkdir(options.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(options.outputDirectory, "agent-dataset.json"),
      `${JSON.stringify(simulation.agentDataset, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(options.outputDirectory, "private-fixture.json"),
      `${JSON.stringify(simulation.privateFixture, null, 2)}\n`,
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
          simulationType: simulation.simulationType,
          seed: simulation.seed,
          generatedAt: simulation.generatedAt,
          windowStart: simulation.windowStart,
          windowEnd: simulation.windowEnd,
          deterministic: true,
          llmRequired: false,
          files: {
            publicAgentDataset: "agent-dataset.json",
            privateTenantFixture: "private-fixture.json",
            hiddenAnswerKey: "answer-key.json",
          },
          counts,
          safety:
            "answer-key.json and private-fixture.json must never be passed to an agent under evaluation",
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);

  process.stdout.write(
    [
      "BuildWatch v2.2 operational simulation generated.",
      `output=${options.outputDirectory}`,
      `seed=${simulation.seed}`,
      `workItems=${counts.workItems}`,
      `planningDays=${counts.planningDays}`,
      `planItemDecisions=${counts.planItemDecisions}`,
      `photos=${counts.photos}`,
      `verificationDrafts=${counts.verificationDrafts}`,
      `forecasts=${counts.forecasts}`,
      `answerCases=${counts.answerCases}`,
      "LLM required: no",
      "Keep answer-key.json and private-fixture.json outside agent context.",
    ].join("\n") + "\n",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`BuildWatch v2.2 simulation generation failed: ${message}\n`);
  process.exitCode = 1;
});
