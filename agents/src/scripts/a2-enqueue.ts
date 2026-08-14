import "dotenv/config";

import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import { DEFAULT_ANALYSIS_PROJECT_REF, DEFAULT_ANALYSIS_TENANT_ID } from "../analysis/index.js";
import { enqueueA2Observation } from "../recommendations/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd a2:enqueue -- --event-type <type> [options]

Options:
  --event-type <type>               Event name (default: PROJECT_UPDATED)
  --event-id <id>                   Stable event ID (default: generated UUID)
  --tenant <id>                     Tenant ID
  --project <id-or-code>            Project ID or code
  --as-of <ISO-or-date>             Analysis cutoff (default: current time)
  --max-steps <2-15>                Research tool-loop limit
  --help                            Show this help
`.trim();

interface A2EventArguments {
  help: boolean;
  tenantId?: string;
  projectRef?: string;
  asOf?: string;
  eventType?: string;
  eventId?: string;
  maxSteps?: number;
}

function requiredValue(token: string, argv: string[], index: number) {
  const separator = token.indexOf("=");
  const name = separator >= 0 ? token.slice(0, separator) : token;
  const inline = separator >= 0 ? token.slice(separator + 1) : undefined;
  const value = inline ?? argv[index + 1];

  if (!value || (!inline && value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }

  return {
    name,
    value,
    consumedNext: inline === undefined,
  };
}

function parseArguments(argv: string[]) {
  const parsed: A2EventArguments = { help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--") {
      continue;
    }

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    const argument = requiredValue(token, argv, index);
    index += argument.consumedNext ? 1 : 0;

    if (argument.name === "--tenant") {
      parsed.tenantId = argument.value;
    } else if (argument.name === "--project") {
      parsed.projectRef = argument.value;
    } else if (argument.name === "--as-of") {
      parsed.asOf = argument.value;
    } else if (argument.name === "--event-type") {
      parsed.eventType = argument.value;
    } else if (argument.name === "--event-id") {
      parsed.eventId = argument.value;
    } else if (argument.name === "--max-steps") {
      parsed.maxSteps = z.coerce.number().int().min(2).max(15).parse(argument.value);
    } else {
      throw new Error(`Unknown A2 enqueue argument: ${argument.name}`);
    }
  }

  return parsed;
}

function normalizeAsOf(value: string | undefined) {
  const candidate = value ?? new Date().toISOString();

  return z
    .string()
    .datetime()
    .parse(/^\d{4}-\d{2}-\d{2}$/.test(candidate) ? `${candidate}T00:00:00.000Z` : candidate);
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to enqueue an A2 event");
  }

  const eventId = arguments_.eventId ?? randomUUID();
  const payload = {
    tenantId: arguments_.tenantId ?? process.env.A2_TENANT_ID?.trim() ?? DEFAULT_ANALYSIS_TENANT_ID,
    projectRef:
      arguments_.projectRef ?? process.env.A2_PROJECT?.trim() ?? DEFAULT_ANALYSIS_PROJECT_REF,
    trigger: "EVENT" as const,
    asOf: normalizeAsOf(arguments_.asOf),
    requestId: eventId,
    eventType: arguments_.eventType ?? "PROJECT_UPDATED",
    eventId,
    maxSteps: arguments_.maxSteps ?? Number(process.env.A2_MAX_STEPS?.trim() || "8"),
  };
  const boss = new PgBoss(connectionString);

  boss.on("error", (error) => {
    console.error(`A2 enqueue pg-boss error: ${error.message}`);
  });
  await boss.start();

  try {
    const jobId = await enqueueA2Observation(boss, payload);
    console.log(`A2 event queued: job=${jobId} event=${payload.eventType}:${payload.eventId}`);
  } finally {
    await boss.stop({ graceful: true, timeout: 30_000 });
  }
}

void main().catch((error) => {
  console.error(`A2 enqueue failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
