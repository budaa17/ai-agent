import { authorizationContextSchema, type AuthorizationContext } from "./contracts.js";

export class ProductionToolAccessError extends Error {
  constructor(message = "Project is not available in the authorized scope") {
    super(message);
    this.name = "ProductionToolAccessError";
  }
}

export class ProductionToolNotFoundError extends Error {
  constructor() {
    super("Project is not available in the authorized scope");
    this.name = "ProductionToolNotFoundError";
  }
}

export function authorizeProject(
  context: AuthorizationContext,
  projectId: string,
): AuthorizationContext {
  const parsed = authorizationContextSchema.parse(context);

  if (!parsed.permissions.includes("AGENT_READ")) {
    throw new ProductionToolAccessError();
  }

  if (!new Set(parsed.allowedProjectIds).has(projectId)) {
    throw new ProductionToolAccessError();
  }

  return parsed;
}

export function requireProductionPermission(
  context: AuthorizationContext,
  permission: AuthorizationContext["permissions"][number],
): void {
  if (!context.permissions.includes(permission)) {
    throw new ProductionToolAccessError();
  }
}
