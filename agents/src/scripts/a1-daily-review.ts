import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  approvedDailyReportCommandV1Schema,
  dailyReportDraftV1Schema,
  projectAnalysisSnapshotV1Schema,
  type ProjectAnalysisSnapshotV1,
} from "../contracts/index.js";
import { buildBuildWatchSimulation } from "../simulation/index.js";
import {
  applyApprovedDailyReportToSnapshot,
  FileDailyReportReviewStore,
} from "../structuring/index.js";

type Command = "drafts" | "show" | "edit" | "approve" | "reject" | "apply-simulation";

type Options = {
  command: Command;
  storeDirectory: string;
  draftId?: string;
  file?: string;
  reviewer?: string;
  note?: string;
  reason?: string;
  snapshotPath?: string;
  outputPath?: string;
  simulationAsOf?: string;
};

const HELP = `
Usage:
  pnpm.cmd agent:a1:drafts [-- --store <dir>]
  pnpm.cmd agent:a1:show -- --draft <id>
  pnpm.cmd agent:a1:edit -- --draft <id> --file <DailyReportDraftV1.json>
  pnpm.cmd agent:a1:approve -- --draft <id> --reviewer <id> [--note <text>]
  pnpm.cmd agent:a1:reject -- --draft <id> --reviewer <id> --reason <text>
  pnpm.cmd agent:a1:apply-simulation -- --draft <id> [--snapshot <json>] [--output <json>]

Common:
  --store <directory>    Review store (default: data/a1-review)

Simulation apply:
  --simulation-as-of <ISO datetime>
                         Override review time only in the generated simulation snapshot
`.trim();

function requiredValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function parseArguments(argv: string[]): Options {
  const command = argv.find((argument) => argument !== "--" && !argument.startsWith("--")) as
    Command | undefined;

  if (
    command === undefined ||
    !["drafts", "show", "edit", "approve", "reject", "apply-simulation"].includes(command)
  ) {
    throw new Error(HELP);
  }

  const options: Options = {
    command,
    storeDirectory: "data/a1-review",
  };
  let commandConsumed = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--") {
      continue;
    }

    if (!commandConsumed && argument === command) {
      commandConsumed = true;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      throw new Error(HELP);
    }

    const value = requiredValue(argv, index, argument);
    index += 1;

    if (argument === "--store") {
      options.storeDirectory = value;
    } else if (argument === "--draft") {
      options.draftId = value;
    } else if (argument === "--file") {
      options.file = value;
    } else if (argument === "--reviewer") {
      options.reviewer = value;
    } else if (argument === "--note") {
      options.note = value;
    } else if (argument === "--reason") {
      options.reason = value;
    } else if (argument === "--snapshot") {
      options.snapshotPath = value;
    } else if (argument === "--output") {
      options.outputPath = value;
    } else if (argument === "--simulation-as-of") {
      options.simulationAsOf = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function requireOption(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function loadSnapshot(snapshotPath: string | undefined): Promise<ProjectAnalysisSnapshotV1> {
  if (snapshotPath === undefined) {
    return buildBuildWatchSimulation().snapshot;
  }

  const content = await readFile(path.resolve(snapshotPath), "utf8");
  return projectAnalysisSnapshotV1Schema.parse(JSON.parse(content));
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const store = new FileDailyReportReviewStore(options.storeDirectory);

  if (options.command === "drafts") {
    const records = await store.list();
    process.stdout.write(
      `${JSON.stringify(
        records.map((record) => ({
          draftId: record.draftId,
          requestId: record.requestId,
          tenantId: record.tenantId,
          projectId: record.projectId,
          reportDate: record.draft.reportDate,
          status: record.status,
          confidence: record.draft.overallConfidence,
          validationErrors: record.draft.validationIssues.filter(
            (issue) => issue.severity === "ERROR",
          ).length,
          clarificationQuestions: record.draft.clarificationQuestions.length,
          updatedAt: record.updatedAt,
        })),
        null,
        2,
      )}\n`,
    );
    return;
  }

  const draftId = requireOption(options.draftId, "--draft");

  if (options.command === "show") {
    process.stdout.write(`${JSON.stringify(await store.get(draftId), null, 2)}\n`);
    return;
  }

  if (options.command === "edit") {
    const file = requireOption(options.file, "--file");
    const content = await readFile(path.resolve(file), "utf8");
    const replacement = dailyReportDraftV1Schema.parse(JSON.parse(content));
    const record = await store.replaceDraft(draftId, replacement);
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }

  if (options.command === "approve") {
    const reviewer = requireOption(options.reviewer, "--reviewer");
    const record = await store.approve(draftId, reviewer, options.note ?? null);
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }

  if (options.command === "reject") {
    const reviewer = requireOption(options.reviewer, "--reviewer");
    const reason = requireOption(options.reason, "--reason");
    const record = await store.reject(draftId, reviewer, reason);
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }

  const record = await store.get(draftId);

  if (record.approvedCommand === null) {
    throw new Error("Draft must be approved before simulation apply");
  }

  const snapshot = await loadSnapshot(options.snapshotPath);
  const simulationCommand =
    options.simulationAsOf === undefined
      ? record.approvedCommand
      : approvedDailyReportCommandV1Schema.parse({
          ...record.approvedCommand,
          reviewedAt: options.simulationAsOf,
        });
  const result = applyApprovedDailyReportToSnapshot(snapshot, simulationCommand);
  const outputPath = path.resolve(
    options.outputPath ?? path.join(options.storeDirectory, `${draftId}-applied-snapshot.json`),
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result.snapshot, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify(
      {
        applied: result.applied,
        dailyReportId: result.dailyReportId,
        snapshotId: result.snapshot.snapshotId,
        output: outputPath,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`A1 review command failed: ${message}\n`);
  process.exitCode = 1;
});
