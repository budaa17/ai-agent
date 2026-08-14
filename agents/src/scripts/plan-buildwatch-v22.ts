import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  A5_PLANNING_EVALUATION_SCENARIOS,
  buildA5SimulationRequest,
  generateA5DailyPlan,
} from "../planning/index.js";
import { buildBuildWatchOperationalSimulation } from "../simulation/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const agentsRoot = path.resolve(scriptDirectory, "../..");

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const scenario = option("--scenario") ?? "HEALTHY_CONTROL";
if (!new Set<string>(A5_PLANNING_EVALUATION_SCENARIOS).has(scenario)) {
  throw new Error(`--scenario must be one of ${A5_PLANNING_EVALUATION_SCENARIOS.join(", ")}`);
}
const mode = option("--mode") ?? "auto";
if (!["auto", "validate"].includes(mode)) {
  throw new Error("--mode must be auto or validate");
}
const simulation = buildBuildWatchOperationalSimulation();
const answerCase = simulation.answerKey.cases.find((candidate) => candidate.scenario === scenario);
if (answerCase === undefined) {
  throw new Error(`Simulation does not contain scenario ${scenario}`);
}
const request = buildA5SimulationRequest(
  simulation,
  answerCase,
  mode === "auto" ? "AUTO" : "VALIDATE_REQUESTED",
);
const result = generateA5DailyPlan(request);
const output = path.resolve(
  agentsRoot,
  option("--output") ?? "data/planning/a5-daily-plan-latest.json",
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(
  `A5 plan: scenario=${scenario} mode=${mode} selected=${result.draft?.content.items.length ?? 0} conflicts=${result.draft?.content.conflicts.length ?? 0}`,
);
console.log(
  `deterministic=${result.deterministic} llmRequired=${result.llmRequired} status=${result.draft?.status ?? "NO_DRAFT"}`,
);
console.log(`Output: ${output}`);
