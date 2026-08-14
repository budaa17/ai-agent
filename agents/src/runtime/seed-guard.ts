export const PRODUCTION_SEED_ACKNOWLEDGEMENT = "I_UNDERSTAND_THIS_REPLACES_DEMO_DATA";

export function assertProductionSeedAllowed(environment: NodeJS.ProcessEnv = process.env) {
  const production =
    environment.NODE_ENV?.trim().toLowerCase() === "production" ||
    environment.APP_ENV?.trim().toLowerCase() === "production" ||
    environment.PRODUCTION_DATABASE?.trim().toLowerCase() === "true";

  if (production && environment.ALLOW_PRODUCTION_SEED !== PRODUCTION_SEED_ACKNOWLEDGEMENT) {
    throw new Error(
      "Production seed is blocked. Use migrations for production data. " +
        `To explicitly load demo data, set ALLOW_PRODUCTION_SEED=${PRODUCTION_SEED_ACKNOWLEDGEMENT}.`,
    );
  }
}
