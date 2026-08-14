import { z } from "zod";
import type { AgentFailureCategory } from "./contracts.js";

export const agentRuntimeBudgetConfigSchema = z
  .object({
    maxInputTokens: z.number().int().positive().max(10_000_000),
    maxOutputTokens: z.number().int().positive().max(1_000_000),
    maxRunCostMicroUsd: z.number().int().positive(),
    maxTenantMonthlyCostMicroUsd: z.number().int().positive(),
    inputCostMicroUsdPerMillionTokens: z.number().int().nonnegative(),
    outputCostMicroUsdPerMillionTokens: z.number().int().nonnegative(),
    timeoutMs: z.number().int().min(100).max(600_000),
    maxRetries: z.number().int().min(0).max(5),
    initialRetryDelayMs: z.number().int().min(0).max(60_000),
    circuitFailureThreshold: z.number().int().min(1).max(100),
    circuitCooldownMs: z.number().int().min(100).max(3_600_000),
  })
  .strict();

export type AgentRuntimeBudgetConfig = z.infer<typeof agentRuntimeBudgetConfigSchema>;

export const DEFAULT_AGENT_RUNTIME_BUDGET: AgentRuntimeBudgetConfig =
  agentRuntimeBudgetConfigSchema.parse({
    maxInputTokens: 100_000,
    maxOutputTokens: 16_000,
    maxRunCostMicroUsd: 2_000_000,
    maxTenantMonthlyCostMicroUsd: 50_000_000,
    inputCostMicroUsdPerMillionTokens: 0,
    outputCostMicroUsdPerMillionTokens: 0,
    timeoutMs: 90_000,
    maxRetries: 2,
    initialRetryDelayMs: 500,
    circuitFailureThreshold: 3,
    circuitCooldownMs: 60_000,
  });

export function resolveAgentRuntimeBudgetConfig(environment: NodeJS.ProcessEnv = process.env) {
  return agentRuntimeBudgetConfigSchema.parse({
    maxInputTokens: Number(
      environment.AGENT_MAX_INPUT_TOKENS ?? DEFAULT_AGENT_RUNTIME_BUDGET.maxInputTokens,
    ),
    maxOutputTokens: Number(
      environment.AGENT_MAX_OUTPUT_TOKENS ?? DEFAULT_AGENT_RUNTIME_BUDGET.maxOutputTokens,
    ),
    maxRunCostMicroUsd: Number(
      environment.AGENT_MAX_RUN_COST_MICRO_USD ?? DEFAULT_AGENT_RUNTIME_BUDGET.maxRunCostMicroUsd,
    ),
    maxTenantMonthlyCostMicroUsd: Number(
      environment.AGENT_MAX_TENANT_MONTHLY_COST_MICRO_USD ??
        DEFAULT_AGENT_RUNTIME_BUDGET.maxTenantMonthlyCostMicroUsd,
    ),
    inputCostMicroUsdPerMillionTokens: Number(
      environment.AGENT_INPUT_COST_MICRO_USD_PER_MILLION_TOKENS ??
        DEFAULT_AGENT_RUNTIME_BUDGET.inputCostMicroUsdPerMillionTokens,
    ),
    outputCostMicroUsdPerMillionTokens: Number(
      environment.AGENT_OUTPUT_COST_MICRO_USD_PER_MILLION_TOKENS ??
        DEFAULT_AGENT_RUNTIME_BUDGET.outputCostMicroUsdPerMillionTokens,
    ),
    timeoutMs: Number(environment.AGENT_MODEL_TIMEOUT_MS ?? DEFAULT_AGENT_RUNTIME_BUDGET.timeoutMs),
    maxRetries: Number(
      environment.AGENT_MODEL_MAX_RETRIES ?? DEFAULT_AGENT_RUNTIME_BUDGET.maxRetries,
    ),
    initialRetryDelayMs: Number(
      environment.AGENT_MODEL_INITIAL_RETRY_DELAY_MS ??
        DEFAULT_AGENT_RUNTIME_BUDGET.initialRetryDelayMs,
    ),
    circuitFailureThreshold: Number(
      environment.AGENT_CIRCUIT_FAILURE_THRESHOLD ??
        DEFAULT_AGENT_RUNTIME_BUDGET.circuitFailureThreshold,
    ),
    circuitCooldownMs: Number(
      environment.AGENT_CIRCUIT_COOLDOWN_MS ?? DEFAULT_AGENT_RUNTIME_BUDGET.circuitCooldownMs,
    ),
  });
}

export function agentModelPricingConfigured(config: AgentRuntimeBudgetConfig) {
  const parsed = agentRuntimeBudgetConfigSchema.parse(config);

  return (
    parsed.inputCostMicroUsdPerMillionTokens > 0 && parsed.outputCostMicroUsdPerMillionTokens > 0
  );
}

export function assertProductionModelPricingConfigured(
  environment: NodeJS.ProcessEnv,
  config: AgentRuntimeBudgetConfig,
) {
  if (
    environment.NODE_ENV?.trim().toLowerCase() === "production" &&
    !agentModelPricingConfigured(config)
  ) {
    throw new Error(
      "Production model pricing is required: configure AGENT_INPUT_COST_MICRO_USD_PER_MILLION_TOKENS and AGENT_OUTPUT_COST_MICRO_USD_PER_MILLION_TOKENS",
    );
  }

  return config;
}

export class AgentRuntimeError extends Error {
  readonly category: AgentFailureCategory;
  readonly retryable: boolean;

  constructor(message: string, category: AgentFailureCategory, retryable: boolean) {
    super(message);
    this.name = "AgentRuntimeError";
    this.category = category;
    this.retryable = retryable;
  }
}

export class AgentBudgetExceededError extends AgentRuntimeError {
  constructor(message: string) {
    super(message, "BUDGET", false);
    this.name = "AgentBudgetExceededError";
  }
}

export class AgentCircuitOpenError extends AgentRuntimeError {
  constructor() {
    super("Model circuit is open; deterministic fallback is required", "CIRCUIT_OPEN", false);
    this.name = "AgentCircuitOpenError";
  }
}

export class AgentModelTimeoutError extends AgentRuntimeError {
  constructor(timeoutMs: number) {
    super(`Model operation exceeded ${timeoutMs}ms`, "TIMEOUT", true);
    this.name = "AgentModelTimeoutError";
  }
}

export class AgentOutputValidationError extends AgentRuntimeError {
  constructor(message: string) {
    super(message, "SCHEMA", true);
    this.name = "AgentOutputValidationError";
  }
}

export interface UsageBudgetStore {
  usedMicroUsd(tenantId: string, month: string): Promise<number>;
  addMicroUsd(tenantId: string, month: string, amount: number): Promise<void>;
  reserveMicroUsd?(
    tenantId: string,
    month: string,
    amount: number,
    limit: number,
  ): Promise<boolean>;
}

export class InMemoryUsageBudgetStore implements UsageBudgetStore {
  readonly #usage = new Map<string, number>();

  async usedMicroUsd(tenantId: string, month: string) {
    return this.#usage.get(`${tenantId}:${month}`) ?? 0;
  }

  async addMicroUsd(tenantId: string, month: string, amount: number) {
    const key = `${tenantId}:${month}`;
    this.#usage.set(key, (this.#usage.get(key) ?? 0) + amount);
  }

  async reserveMicroUsd(tenantId: string, month: string, amount: number, limit: number) {
    const key = `${tenantId}:${month}`;
    const used = this.#usage.get(key) ?? 0;

    if (used + amount > limit) {
      return false;
    }

    this.#usage.set(key, used + amount);
    return true;
  }
}

type CircuitState = {
  failures: number;
  openedAt: number | null;
  halfOpenProbe: boolean;
};

export class AgentCircuitBreaker {
  readonly #states = new Map<string, CircuitState>();
  readonly #failureThreshold: number;
  readonly #cooldownMs: number;
  readonly #now: () => number;

  constructor(failureThreshold: number, cooldownMs: number, now = () => Date.now()) {
    this.#failureThreshold = failureThreshold;
    this.#cooldownMs = cooldownMs;
    this.#now = now;
  }

  #state(key: string) {
    const state = this.#states.get(key) ?? {
      failures: 0,
      openedAt: null,
      halfOpenProbe: false,
    };
    this.#states.set(key, state);
    return state;
  }

  assertAvailable(key: string) {
    const state = this.#state(key);

    if (state.openedAt === null) {
      return;
    }

    if (this.#now() - state.openedAt < this.#cooldownMs) {
      throw new AgentCircuitOpenError();
    }

    if (state.halfOpenProbe) {
      throw new AgentCircuitOpenError();
    }

    state.halfOpenProbe = true;
  }

  succeed(key: string) {
    this.#states.set(key, {
      failures: 0,
      openedAt: null,
      halfOpenProbe: false,
    });
  }

  fail(key: string) {
    const state = this.#state(key);
    state.failures += 1;
    state.halfOpenProbe = false;

    if (state.failures >= this.#failureThreshold) {
      state.openedAt = this.#now();
    }
  }

  state(key: string) {
    const state = this.#state(key);

    if (state.openedAt === null) {
      return "CLOSED" as const;
    }

    return this.#now() - state.openedAt >= this.#cooldownMs
      ? ("HALF_OPEN" as const)
      : ("OPEN" as const);
  }
}

function estimatedCostMicroUsd(
  inputTokens: number,
  outputTokens: number,
  config: AgentRuntimeBudgetConfig,
) {
  return Math.ceil(
    (inputTokens * config.inputCostMicroUsdPerMillionTokens +
      outputTokens * config.outputCostMicroUsdPerMillionTokens) /
      1_000_000,
  );
}

function monthKey(now: Date) {
  return now.toISOString().slice(0, 7);
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function retryableError(error: unknown) {
  if (error instanceof AgentRuntimeError) {
    return error.retryable;
  }

  if (error instanceof Error) {
    const candidate = error as Error & {
      status?: number;
      code?: string;
    };
    return (
      candidate.status === 408 ||
      candidate.status === 409 ||
      candidate.status === 429 ||
      (candidate.status !== undefined && candidate.status >= 500) ||
      ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(candidate.code ?? "")
    );
  }

  return false;
}

function classifyError(error: unknown): AgentFailureCategory {
  if (error instanceof AgentRuntimeError) {
    return error.category;
  }

  const candidate = error as {
    status?: number;
    code?: string;
  };

  if (candidate.status === 429) {
    return "RATE_LIMIT";
  }

  if (candidate.status !== undefined && candidate.status >= 500) {
    return "PROVIDER";
  }

  return "INTERNAL";
}

async function withTimeout<T>(timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new AgentModelTimeoutError(timeoutMs));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export type GuardedModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  actualCostMicroUsd?: number;
};

export class AgentRuntimeGuard {
  readonly #config: AgentRuntimeBudgetConfig;
  readonly #usageStore: UsageBudgetStore;
  readonly #circuit: AgentCircuitBreaker;
  readonly #now: () => Date;

  constructor(
    config: AgentRuntimeBudgetConfig,
    usageStore: UsageBudgetStore,
    options: {
      now?: () => Date;
      circuitBreaker?: AgentCircuitBreaker;
    } = {},
  ) {
    this.#config = agentRuntimeBudgetConfigSchema.parse(config);
    this.#usageStore = usageStore;
    this.#now = options.now ?? (() => new Date());
    this.#circuit =
      options.circuitBreaker ??
      new AgentCircuitBreaker(
        this.#config.circuitFailureThreshold,
        this.#config.circuitCooldownMs,
        () => this.#now().getTime(),
      );
  }

  async execute<T>(input: {
    tenantId: string;
    provider: string;
    modelId: string;
    estimatedInputTokens: number;
    requestedOutputTokens: number;
    operation: (
      signal: AbortSignal,
      attempt: number,
    ) => Promise<{ value: T; usage: GuardedModelUsage }>;
  }) {
    if (
      !Number.isInteger(input.estimatedInputTokens) ||
      input.estimatedInputTokens < 0 ||
      input.estimatedInputTokens > this.#config.maxInputTokens
    ) {
      throw new AgentBudgetExceededError("Estimated input token count exceeds the run limit");
    }

    if (
      !Number.isInteger(input.requestedOutputTokens) ||
      input.requestedOutputTokens < 1 ||
      input.requestedOutputTokens > this.#config.maxOutputTokens
    ) {
      throw new AgentBudgetExceededError("Requested output token count exceeds the run limit");
    }

    const estimate = estimatedCostMicroUsd(
      input.estimatedInputTokens,
      input.requestedOutputTokens,
      this.#config,
    );

    if (estimate > this.#config.maxRunCostMicroUsd) {
      throw new AgentBudgetExceededError("Estimated model cost exceeds the per-run budget");
    }

    const circuitKey = `${input.provider}:${input.modelId}`;
    this.#circuit.assertAvailable(circuitKey);
    const now = this.#now();
    const month = monthKey(now);
    const reserved = this.#usageStore.reserveMicroUsd
      ? await this.#usageStore.reserveMicroUsd(
          input.tenantId,
          month,
          estimate,
          this.#config.maxTenantMonthlyCostMicroUsd,
        )
      : false;

    if (!this.#usageStore.reserveMicroUsd) {
      const used = await this.#usageStore.usedMicroUsd(input.tenantId, month);

      if (used + estimate > this.#config.maxTenantMonthlyCostMicroUsd) {
        throw new AgentBudgetExceededError("Tenant monthly model budget is exhausted");
      }
    } else if (!reserved) {
      throw new AgentBudgetExceededError("Tenant monthly model budget is exhausted");
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#config.maxRetries; attempt += 1) {
      try {
        const result = await withTimeout(this.#config.timeoutMs, (signal) =>
          input.operation(signal, attempt + 1),
        );

        if (
          result.usage.inputTokens > this.#config.maxInputTokens ||
          result.usage.outputTokens > this.#config.maxOutputTokens
        ) {
          throw new AgentBudgetExceededError("Provider usage exceeded the configured token limit");
        }

        const actualCost =
          result.usage.actualCostMicroUsd ??
          estimatedCostMicroUsd(result.usage.inputTokens, result.usage.outputTokens, this.#config);

        if (actualCost > this.#config.maxRunCostMicroUsd) {
          throw new AgentBudgetExceededError("Actual model cost exceeded the per-run budget");
        }

        await this.#usageStore.addMicroUsd(
          input.tenantId,
          month,
          actualCost - (reserved ? estimate : 0),
        );
        this.#circuit.succeed(circuitKey);
        return {
          value: result.value,
          attempts: attempt + 1,
          retryCount: attempt,
          estimatedCostMicroUsd: estimate,
          actualCostMicroUsd: actualCost,
          usage: {
            ...result.usage,
            cachedInputTokens: result.usage.cachedInputTokens ?? 0,
          },
        };
      } catch (error) {
        lastError = error;

        if (!retryableError(error) || attempt >= this.#config.maxRetries) {
          this.#circuit.fail(circuitKey);
          if (reserved) {
            await this.#usageStore.addMicroUsd(input.tenantId, month, -estimate);
          }
          throw error;
        }

        await sleep(this.#config.initialRetryDelayMs * 2 ** attempt);
      }
    }

    if (reserved) {
      await this.#usageStore.addMicroUsd(input.tenantId, month, -estimate);
    }
    this.#circuit.fail(circuitKey);
    throw lastError;
  }

  circuitState(provider: string, modelId: string) {
    return this.#circuit.state(`${provider}:${modelId}`);
  }
}

export function createLocalAgentRuntimeGuard(environment: NodeJS.ProcessEnv = process.env) {
  return new AgentRuntimeGuard(
    resolveAgentRuntimeBudgetConfig(environment),
    new InMemoryUsageBudgetStore(),
  );
}

export function agentFailureCategory(error: unknown) {
  return classifyError(error);
}
