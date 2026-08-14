import "dotenv/config";

import { DEFAULT_ANALYSIS_PROJECT_REF, DEFAULT_ANALYSIS_TENANT_ID } from "../analysis/index.js";
import { prisma } from "../prisma.js";
import { inspectA3ApprovalDraftsCore } from "../reporting/index.js";

async function main() {
  const tenantId = process.env.A3_TENANT_ID?.trim() ?? DEFAULT_ANALYSIS_TENANT_ID;
  const projectRef = process.env.A3_PROJECT?.trim() ?? DEFAULT_ANALYSIS_PROJECT_REF;
  const project = await prisma.project.findFirst({
    where: {
      tenantId,
      OR: [{ id: projectRef }, { code: projectRef }],
    },
    select: { id: true },
  });

  if (!project) {
    throw new Error("A3 project was not found in tenant scope");
  }

  const result = await inspectA3ApprovalDraftsCore(
    {
      tenantId,
      projectIds: [project.id],
    },
    {
      projectIds: [project.id],
      statuses: ["PENDING_APPROVAL"],
      limit: 100,
    },
  );

  console.log(JSON.stringify(result, null, 2));
}

void main()
  .catch((error) => {
    console.error(`A3 drafts failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
