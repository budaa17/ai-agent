import type { LanguageModelUsage } from "ai";
import type { GuardedModelUsage } from "./guard.js";

function token(value: number | undefined) {
  return Number.isInteger(value) && value! >= 0 ? value! : 0;
}

export function normalizeLanguageModelUsage(
  usage: LanguageModelUsage,
): GuardedModelUsage & { reasoningTokens: number } {
  return {
    inputTokens: token(usage.inputTokens),
    outputTokens: token(usage.outputTokens),
    cachedInputTokens: token(usage.inputTokenDetails.cacheReadTokens),
    reasoningTokens: token(usage.outputTokenDetails.reasoningTokens),
  };
}

export function estimateModelInputTokens(input: { textCharacters: number; imageBytes?: number }) {
  if (
    !Number.isInteger(input.textCharacters) ||
    input.textCharacters < 0 ||
    !Number.isInteger(input.imageBytes ?? 0) ||
    (input.imageBytes ?? 0) < 0
  ) {
    throw new Error("Model input size must be a non-negative integer");
  }

  return Math.max(
    1,
    Math.ceil(input.textCharacters / 3) + Math.ceil((input.imageBytes ?? 0) / 750),
  );
}
