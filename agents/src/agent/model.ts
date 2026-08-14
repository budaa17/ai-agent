import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";
export const chatProviderSchema = z.literal("openai");

export const openAIModelConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1, "OPENAI_API_KEY is required"),
    modelId: z.string().trim().min(1).default(DEFAULT_OPENAI_MODEL),
  })
  .strict();

export type OpenAIModelConfig = z.input<typeof openAIModelConfigSchema>;

export function createOpenAIChatModel(config: OpenAIModelConfig) {
  const parsedConfig = openAIModelConfigSchema.parse(config);
  const provider = createOpenAI({ apiKey: parsedConfig.apiKey });

  return provider.responses(parsedConfig.modelId);
}

export function createChatModel(config: { apiKey: string; modelId: string }) {
  return createOpenAIChatModel({
    apiKey: config.apiKey,
    modelId: config.modelId,
  });
}
