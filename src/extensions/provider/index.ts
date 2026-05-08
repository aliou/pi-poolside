import { appendFileSync } from "node:fs";
import type {
  BeforeProviderRequestEvent,
  ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

import { getPoolsideApiKey } from "../../lib/env";
import {
  fetchModels,
  POOLSIDE_MODELS_CACHE,
  type PoolsideModelConfig,
} from "./models";

const DEBUG_LOG_FILE = "/tmp/pi-poolside-debug.log";

function debugLog(message: string, data?: unknown): void {
  appendFileSync(
    DEBUG_LOG_FILE,
    `${new Date().toISOString()} [poolside] ${message}${data === undefined ? "" : ` ${JSON.stringify(data)}`}\n`,
    "utf8",
  );
}

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

  // Log the full request payload Pi sends to Poolside
  pi.on("before_provider_request", (event: BeforeProviderRequestEvent) => {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) return;
    debugLog("REQUEST", {
      model: payload.model,
      tool_choice: payload.tool_choice,
      parallel_tool_calls: payload.parallel_tool_calls,
      messages: payload.messages,
    });
  });

  // Log response status/headers
  pi.on("after_provider_response", (event, ctx) => {
    if (ctx.model?.provider !== "poolside") return;
    debugLog("RESPONSE", {
      status: event.status,
      headers: event.headers,
    });
  });

  // Log parsed stream events for tool calls
  pi.on("message_update", (event) => {
    const msg = event.message;
    if (msg.role !== "assistant") return;
    const apiEvent = event.assistantMessageEvent;
    if (
      apiEvent.type === "toolcall_start" ||
      apiEvent.type === "toolcall_delta" ||
      apiEvent.type === "toolcall_end"
    ) {
      debugLog(`STREAM:${apiEvent.type}`, {
        contentIndex: apiEvent.contentIndex,
        ...(apiEvent.type === "toolcall_start"
          ? {
              partial: (
                apiEvent.partial.content as Array<{
                  type: string;
                  id?: string;
                  name?: string;
                  streamIndex?: number;
                }>
              )
                .filter((b) => b.type === "toolCall")
                .map((b) => ({
                  id: b.id,
                  name: b.name,
                  streamIndex: b.streamIndex,
                })),
            }
          : {}),
        ...(apiEvent.type === "toolcall_delta"
          ? { delta: apiEvent.delta }
          : {}),
        ...(apiEvent.type === "toolcall_end"
          ? { toolCall: apiEvent.toolCall }
          : {}),
      });
    }
  });

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
