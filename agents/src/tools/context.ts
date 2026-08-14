import { z } from "zod";

export const toolContextSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    projectIds: z.array(z.string().trim().min(1)).min(1).max(100),
  })
  .strict();

export type ToolContext = z.infer<typeof toolContextSchema>;

export class ToolAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolAccessError";
  }
}

export function resolveProjectScope(context: ToolContext, requestedProjectIds?: string[]) {
  const parsedContext = toolContextSchema.parse(context);
  const allowedProjectIds = [...new Set(parsedContext.projectIds)];
  const projectIds = requestedProjectIds ? [...new Set(requestedProjectIds)] : allowedProjectIds;
  const allowedProjects = new Set(allowedProjectIds);
  const unauthorizedProjectIds = projectIds.filter((projectId) => !allowedProjects.has(projectId));

  if (unauthorizedProjectIds.length > 0) {
    throw new ToolAccessError(`Project access denied: ${unauthorizedProjectIds.join(", ")}`);
  }

  return {
    tenantId: parsedContext.tenantId,
    projectIds,
  };
}
