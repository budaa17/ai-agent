import "dotenv/config";

import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import {
  DEFAULT_ANALYSIS_AS_OF,
  DEFAULT_ANALYSIS_PROJECT_REF,
  DEFAULT_ANALYSIS_TENANT_ID,
} from "../analysis/index.js";
import { enqueueA3DocumentRequest } from "../reporting/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd a3:enqueue -- [options]

Options:
  --tenant <id>                     Tenant ID
  --project <id-or-code>            Project ID or code
  --as-of <ISO-or-date>             Report cutoff
  --request-id <id>                 Stable idempotency ID
  --analysis-only                   Do not load the latest A2 run
  --no-pdf                          Skip PDF generation
  --help                            Show this help
`.trim();

interface Arguments {
  help: boolean;
  noPdf: boolean;
  analysisOnly: boolean;
  tenantId?: string;
  projectRef?: string;
  asOf?: string;
  requestId?: string;
}

function requiredValue(token: string, argv: string[], index: number) {
  const separator = token.indexOf("=");
  const name = separator >= 0 ? token.slice(0, separator) : token;
  const inline = separator >= 0 ? token.slice(separator + 1) : undefined;
  const value = inline ?? argv[index + 1];

  if (!value || (!inline && value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }

  return { name, value, consumedNext: inline === undefined };
}

function parseArguments(argv: string[]) {
  const parsed: Arguments = {
    help: false,
    noPdf: false,
    analysisOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--") {
      continue;
    }

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    if (token === "--no-pdf") {
      parsed.noPdf = true;
      continue;
    }

    if (token === "--analysis-only") {
      parsed.analysisOnly = true;
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
    } else if (argument.name === "--request-id") {
      parsed.requestId = argument.value;
    } else {
      throw new Error(`Unknown A3 enqueue argument: ${argument.name}`);
    }
  }

  return parsed;
}

function normalizeAsOf(value: string) {
  return z
    .string()
    .datetime()
    .parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to enqueue A3 documents");
  }

  const payload = {
    tenantId: arguments_.tenantId ?? process.env.A3_TENANT_ID?.trim() ?? DEFAULT_ANALYSIS_TENANT_ID,
    projectRef:
      arguments_.projectRef ?? process.env.A3_PROJECT?.trim() ?? DEFAULT_ANALYSIS_PROJECT_REF,
    trigger: "REQUEST" as const,
    asOf: normalizeAsOf(arguments_.asOf ?? process.env.A3_AS_OF?.trim() ?? DEFAULT_ANALYSIS_AS_OF),
    requestId: arguments_.requestId ?? randomUUID(),
    noPdf: arguments_.noPdf,
    analysisOnly: arguments_.analysisOnly,
  };
  const boss = new PgBoss(connectionString);

  boss.on("error", (error) => {
    console.error(`A3 enqueue pg-boss error: ${error.message}`);
  });
  await boss.start();

  try {
    const jobId = await enqueueA3DocumentRequest(boss, payload);
    console.log(`A3 documents queued: job=${jobId} request=${payload.requestId}`);
  } finally {
    await boss.stop({ graceful: true, timeout: 30_000 });
  }
}

void main().catch((error) => {
  console.error(`A3 enqueue failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
