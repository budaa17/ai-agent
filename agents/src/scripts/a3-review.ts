import "dotenv/config";

import { DEFAULT_ANALYSIS_TENANT_ID } from "../analysis/index.js";
import { prisma } from "../prisma.js";
import { reviewA3DocumentDraft } from "../reporting/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd a3:review -- --draft <id> --approve --reviewer <name>
  pnpm.cmd a3:review -- --draft <id> --reject --reviewer <name> [--note <text>]

Options:
  --tenant <id>                     Tenant ID
  --draft <id>                      A3 document draft ID
  --approve                         Approve the draft
  --reject                          Reject the draft
  --reviewer <name>                 Human reviewer
  --note <text>                     Optional review note
  --help                            Show this help
`.trim();

interface Arguments {
  help: boolean;
  approve: boolean;
  reject: boolean;
  tenantId?: string;
  draftId?: string;
  reviewer?: string;
  note?: string;
}

function parseArguments(argv: string[]) {
  const parsed: Arguments = {
    help: false,
    approve: false,
    reject: false,
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

    if (token === "--approve" || token === "--reject") {
      parsed[token === "--approve" ? "approve" : "reject"] = true;
      continue;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }

    index += 1;

    if (token === "--tenant") {
      parsed.tenantId = value;
    } else if (token === "--draft") {
      parsed.draftId = value;
    } else if (token === "--reviewer") {
      parsed.reviewer = value;
    } else if (token === "--note") {
      parsed.note = value;
    } else {
      throw new Error(`Unknown A3 review argument: ${token}`);
    }
  }

  if (!parsed.help) {
    if (!parsed.draftId || !parsed.reviewer) {
      throw new Error("--draft and --reviewer are required");
    }

    if (parsed.approve === parsed.reject) {
      throw new Error("Use exactly one of --approve or --reject");
    }
  }

  return parsed;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const result = await reviewA3DocumentDraft({
    tenantId: arguments_.tenantId ?? process.env.A3_TENANT_ID?.trim() ?? DEFAULT_ANALYSIS_TENANT_ID,
    draftId: arguments_.draftId!,
    decision: arguments_.approve ? "APPROVE" : "REJECT",
    reviewedBy: arguments_.reviewer!,
    note: arguments_.note,
  });

  console.log(
    `A3 draft reviewed: draft=${result.draftId} status=${result.status} reused=${result.reused}`,
  );
}

void main()
  .catch((error) => {
    console.error(`A3 review failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
