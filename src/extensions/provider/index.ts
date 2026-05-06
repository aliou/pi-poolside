import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getPoolsideApiKey } from "../../lib/env";
import {
  fetchModels,
  POOLSIDE_MODELS_CACHE,
  type PoolsideModelConfig,
} from "./models";

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

function registerPoolsideProvider(
  pi: ExtensionAPI,
  models: PoolsideModelConfig[],
): void {
  pi.registerProvider("poolside", {
    baseUrl: "https://inference.poolside.ai/v1",
    apiKey: "POOLSIDE_API_KEY",
    api: "openai-completions",
    headers: {
      Referer: "https://pi.dev",
      "X-Title": "npm:@aliou/pi-poolside",
    },
    models: buildModelsPayload(models),
  });
}

export default async function (pi: ExtensionAPI) {
  // Register with hardcoded cache immediately so models are available on startup
  registerPoolsideProvider(pi, POOLSIDE_MODELS_CACHE);

  // On session start: fetch live models and re-register if they differ
  pi.on("session_start", async (_event, ctx) => {
    const apiKey = await getPoolsideApiKey(ctx.modelRegistry.authStorage);
    if (!apiKey) return;

    const result = await fetchModels(apiKey);
    if (!result.success) return;

    const cacheIds = new Set(POOLSIDE_MODELS_CACHE.map((m) => m.id));
    const liveIds = new Set(result.models.map((m) => m.id));
    const added = result.models.filter((m) => !cacheIds.has(m.id));
    const removed = POOLSIDE_MODELS_CACHE.filter((m) => !liveIds.has(m.id));

    if (added.length > 0 || removed.length > 0) {
      const parts: string[] = [];
      if (added.length > 0) parts.push(`${added.length} new`);
      if (removed.length > 0) parts.push(`${removed.length} removed`);
      ctx.ui.notify(`Poolside models updated (${parts.join(", ")})`, "info");
    }

    registerPoolsideProvider(pi, result.models);
  });
}
