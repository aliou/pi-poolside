// Models from Poolside API
// Source: https://inference.poolside.ai/v1/models
// Pricing returns $0 during free preview; hardcoded cache uses placeholder values.

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const POOLSIDE_THINKING_LEVEL_MAP = {
  minimal: null,
  low: null,
  medium: "medium",
  high: null,
  xhigh: null,
} as const;

/** Hardcoded model cache. Used on startup before live models are fetched. */
export const POOLSIDE_MODELS_CACHE: ProviderModelConfig[] = [
  {
    id: "poolside/laguna-m.1",
    name: "Laguna M.1",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0.2,
      output: 0.4,
      cacheRead: 0.1,
      cacheWrite: 0.25,
    },
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: POOLSIDE_THINKING_LEVEL_MAP,
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    },
  },
  {
    id: "poolside/laguna-xs-2.1",
    name: "Laguna XS 2.1",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0.06,
      output: 0.12,
      cacheRead: 0.03,
      cacheWrite: 0,
    },
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: POOLSIDE_THINKING_LEVEL_MAP,
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    },
  },
  {
    id: "poolside/laguna-s-2.1",
    name: "Laguna S 2.1",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0.1,
      output: 0.2,
      cacheRead: 0.05,
      cacheWrite: 0,
    },
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: POOLSIDE_THINKING_LEVEL_MAP,
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
    },
  },
];

/** Response shape from the Poolside /v1/models endpoint. */
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
      input_cache_read?: string;
    };
    supported_sampling_parameters: string[];
    supported_features: string[];
    input_modalities: string[];
    output_modalities: string[];
    hugging_face_id?: string;
  }>;
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
): ProviderModelConfig[] {
  return response.data.map((model) => {
    // API returns $0 during free preview; keep as-is
    const pricing = model.pricing;
    return {
      id: model.id,
      name: model.name,
      reasoning: model.supported_features.includes("reasoning"),
      input: parseInputModalities(model.input_modalities),
      cost: {
        input: Number.parseFloat(pricing.prompt) || 0,
        output: Number.parseFloat(pricing.completion) || 0,
        cacheRead:
          Number.parseFloat(pricing.input_cache_read ?? pricing.prompt) || 0,
        cacheWrite: 0,
      },
      contextWindow: model.context_length,
      maxTokens: model.max_completion_tokens,
      thinkingLevelMap: model.supported_features.includes("reasoning")
        ? POOLSIDE_THINKING_LEVEL_MAP
        : undefined,
      compat: {
        supportsDeveloperRole: false,
        maxTokensField: "max_tokens",
      },
    };
  });
}

export type FetchModelsResult =
  | { success: true; models: ProviderModelConfig[] }
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
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: requestSignal,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Poolside API error: HTTP ${response.status}: ${response.statusText}`,
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
