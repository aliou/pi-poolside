// Models from Poolside API
// Source: https://inference.poolside.ai/v1/models
// Pricing is $0 during beta.

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export interface PoolsideModelConfig extends ProviderModelConfig {}

const POOLSIDE_THINKING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: "medium",
  high: null,
  xhigh: null,
} as const;

/** Hardcoded model cache. Used on startup before live models are fetched. */
export const POOLSIDE_MODELS_CACHE: PoolsideModelConfig[] = [
  {
    id: "poolside/laguna-m.1",
    name: "Laguna M.1",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 131072,
    maxTokens: 8192,
    thinkingLevelMap: POOLSIDE_THINKING_LEVEL_MAP,
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    },
  },
  {
    id: "poolside/laguna-xs.2",
    name: "Laguna XS.2",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 131072,
    maxTokens: 8192,
    thinkingLevelMap: POOLSIDE_THINKING_LEVEL_MAP,
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    },
  },
];

/** Response shape from the /v1/models endpoint. */
interface PoolsideModelsResponse {
  data: Array<{
    id: string;
    created: number;
    object: string;
    owned_by: string;
    name: string;
    description: string;
    context_length: number;
    max_completion_tokens: number;
    quantization: string;
    pricing: {
      prompt: string;
      completion: string;
      image: string;
      request: string;
    };
    supported_sampling_parameters: string[];
    supported_features: string[];
    input_modalities: string[];
    output_modalities: string[];
    hugging_face_id?: string;
  }>;
}

function parseCost(pricing: PoolsideModelsResponse["data"][number]["pricing"]) {
  return {
    input: Number.parseFloat(pricing.prompt) || 0,
    output: Number.parseFloat(pricing.completion) || 0,
    cacheRead: Number.parseFloat(pricing.prompt) || 0,
    cacheWrite: 0,
  };
}

function parseInputModalities(modalities: string[]): ("text" | "image")[] {
  const result: ("text" | "image")[] = [];
  if (modalities.includes("text")) result.push("text");
  if (modalities.includes("image")) result.push("image");
  if (result.length === 0) result.push("text");
  return result;
}

export function parseModelsResponse(
  response: PoolsideModelsResponse,
): PoolsideModelConfig[] {
  return response.data.map((model) => ({
    id: model.id,
    name: model.name,
    reasoning: model.supported_features.includes("reasoning"),
    input: parseInputModalities(model.input_modalities),
    cost: parseCost(model.pricing),
    contextWindow: model.context_length,
    maxTokens: model.max_completion_tokens,
    thinkingLevelMap: model.supported_features.includes("reasoning")
      ? POOLSIDE_THINKING_LEVEL_MAP
      : undefined,
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens" as const,
    },
  }));
}

export type FetchModelsResult =
  | { success: true; models: PoolsideModelConfig[] }
  | { success: false; error: string };

export async function fetchModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<FetchModelsResult> {
  try {
    const timeoutSignal = AbortSignal.timeout(10_000);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    const response = await fetch("https://inference.poolside.ai/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: requestSignal,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const json = await response.json();
    const data = json as PoolsideModelsResponse;
    return { success: true, models: parseModelsResponse(data) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
