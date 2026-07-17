import type {
  ExtensionAPI,
  ProviderConfig,
} from "@earendil-works/pi-coding-agent";

import {
  fetchModels,
  POOLSIDE_MODELS_CACHE,
  type PoolsideModelConfig,
} from "./models";

const PROVIDER_ID = "poolside";
const PROVIDER_NAME = "Poolside";
const BASE_URL = "https://inference.poolside.ai/v1";
const API_KEY_ENV = "POOLSIDE_API_KEY";

function buildModelsPayload(models: PoolsideModelConfig[]) {
  return models.map((model) => ({
    ...model,
    compat: {
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens" as const,
      ...model.compat,
    },
  }));
}

function createRefreshModels(
  staticModels: PoolsideModelConfig[],
): NonNullable<ProviderConfig["refreshModels"]> {
  return async (context) => {
    const stored = await context.store.read();
    const cachedModels = stored?.models as PoolsideModelConfig[] | undefined;
    const fallbackModels = cachedModels?.length
      ? buildModelsPayload(cachedModels)
      : buildModelsPayload(staticModels);

    if (!context.allowNetwork || context.signal?.aborted) {
      return fallbackModels;
    }

    const apiKey =
      context.credential?.type === "api_key"
        ? context.credential.key
        : undefined;
    if (!apiKey) return fallbackModels;

    const result = await fetchModels(apiKey, context.signal);
    if (!result.success || result.models.length === 0) return fallbackModels;

    const models = buildModelsPayload(result.models);
    await context.store.write({
      models: models as never,
      checkedAt: Date.now(),
    });
    return models;
  };
}

function registerPoolsideProvider(pi: ExtensionAPI): void {
  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_NAME,
    baseUrl: BASE_URL,
    apiKey: `$${API_KEY_ENV}`,
    api: "openai-completions",
    authHeader: true,
    headers: {
      Referer: "https://github.com/aliou/pi-poolside",
      "X-Title": "npm:@aliou/pi-poolside",
    },
    models: buildModelsPayload(POOLSIDE_MODELS_CACHE),
    refreshModels: createRefreshModels(POOLSIDE_MODELS_CACHE),
  });
}

export default async function (pi: ExtensionAPI) {
  registerPoolsideProvider(pi);
}
