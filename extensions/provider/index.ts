import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderConfig,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

import { fetchModels, POOLSIDE_MODELS_CACHE } from "./models";
import { persistModels, readStoredModels } from "./refresh-store-compat";

const PROVIDER_ID = "poolside";
const PROVIDER_NAME = "Poolside";
const BASE_URL = "https://inference.poolside.ai/v1";
const API_KEY_ENV = "POOLSIDE_API_KEY";

function buildModelsPayload(models: ProviderModelConfig[]) {
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
  staticModels: ProviderModelConfig[],
): NonNullable<ProviderConfig["refreshModels"]> {
  return async (context) => {
    const stored = await readStoredModels(context);
    const cachedModels = stored?.models as ProviderModelConfig[] | undefined;
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

    context.signal?.throwIfAborted();

    const models = buildModelsPayload(result.models);
    await persistModels(context, {
      models: models as unknown as Model<Api>[],
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
