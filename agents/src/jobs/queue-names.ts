export const A1_INTAKE_QUEUE = "a1-register-project-update";
export const A2_OBSERVATION_QUEUE = "a2-observe-project";
export const A3_DOCUMENT_QUEUE = "a3-generate-documents";
export const A5_DAILY_PLAN_QUEUE = "a5-generate-daily-plan";
export const PROJECT_ANALYSIS_QUEUE = "analyze-project";

export const A0_DESIGN_PARSE_QUEUE = "a0-parse-extract-design";
export const QUANTITY_RECALCULATION_QUEUE = "recalculate-quantity";
export const EVENING_REMINDER_QUEUE = "send-evening-reminder";
export const PROGRESS_VERIFICATION_QUEUE = "verify-progress";
export const ROLLING_FORECAST_QUEUE = "calculate-rolling-forecast";

export const PHASE9_A0_DESIGN_PARSE_QUEUE = "buildwatch-v22-phase9-a0-parse-extract-design";
export const PHASE9_QUANTITY_RECALCULATION_QUEUE = "buildwatch-v22-phase9-recalculate-quantity";
export const PHASE9_A5_DAILY_PLAN_QUEUE = "buildwatch-v22-phase9-a5-generate-daily-plan";
export const PHASE9_EVENING_REMINDER_QUEUE = "buildwatch-v22-phase9-send-evening-reminder";
export const PHASE9_PROGRESS_VERIFICATION_QUEUE = "buildwatch-v22-phase9-verify-progress";
export const PHASE9_ROLLING_FORECAST_QUEUE = "buildwatch-v22-phase9-calculate-rolling-forecast";
export const PHASE9_A2_OBSERVATION_QUEUE = "buildwatch-v22-phase9-a2-observe-project";
export const PHASE9_A3_DOCUMENT_QUEUE = "buildwatch-v22-phase9-a3-generate-documents";

export const PHASE9_JOB_QUEUE_NAMES = [
  PHASE9_A0_DESIGN_PARSE_QUEUE,
  PHASE9_QUANTITY_RECALCULATION_QUEUE,
  PHASE9_A5_DAILY_PLAN_QUEUE,
  PHASE9_EVENING_REMINDER_QUEUE,
  PHASE9_PROGRESS_VERIFICATION_QUEUE,
  PHASE9_ROLLING_FORECAST_QUEUE,
  PHASE9_A2_OBSERVATION_QUEUE,
  PHASE9_A3_DOCUMENT_QUEUE,
] as const;

export const AGENT_QUEUE_NAMES = [
  A1_INTAKE_QUEUE,
  A2_OBSERVATION_QUEUE,
  A3_DOCUMENT_QUEUE,
  A5_DAILY_PLAN_QUEUE,
  PROJECT_ANALYSIS_QUEUE,
] as const;
