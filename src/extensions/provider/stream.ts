import { appendFileSync } from "node:fs";

import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Message,
  type Model,
  parseStreamingJson,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
} from "@mariozechner/pi-ai";

const DEBUG_LOG_FILE = "/tmp/pi-poolside-debug.log";

function debugLog(message: string, data?: unknown): void {
  appendFileSync(
    DEBUG_LOG_FILE,
    `${new Date().toISOString()} [poolside] ${message}${data === undefined ? "" : ` ${JSON.stringify(data)}`}\n`,
    "utf8",
  );
}

type OpenAIMessage = Record<string, unknown>;
type StreamingToolCallBlock = ToolCall & {
  partialArgs?: string;
  streamIndex?: number;
};

type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ChatChunk = {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string;
      reasoning?: string;
      reasoning_text?: string;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

function initialUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function mapMessage(message: Message): OpenAIMessage {
  if (message.role === "user") {
    return { role: "user", content: contentToText(message.content) };
  }

  if (message.role === "toolResult") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      name: message.toolName,
      content: contentToText(message.content),
    };
  }

  const toolCalls = message.content.filter(
    (block) => block.type === "toolCall",
  );
  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return {
    role: "assistant",
    content: text || null,
    ...(toolCalls.length > 0
      ? {
          tool_calls: toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments),
            },
          })),
        }
      : {}),
  };
}

function contentToText(
  content: Message extends { content: infer T } ? T : never,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function buildPayload(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): Record<string, unknown> {
  const messages: OpenAIMessage[] = [];
  if (context.systemPrompt)
    messages.push({ role: "system", content: context.systemPrompt });
  messages.push(...context.messages.map(mapMessage));

  const payload: Record<string, unknown> = {
    model: model.id,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (options?.maxTokens) payload.max_tokens = options.maxTokens;
  if (options?.temperature !== undefined)
    payload.temperature = options.temperature;
  if (options?.reasoning) payload.reasoning_effort = options.reasoning;
  if (context.tools && context.tools.length > 0) {
    payload.tools = context.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    payload.parallel_tool_calls = true;
  }

  return payload;
}

function mapStopReason(
  reason: string | undefined,
): AssistantMessage["stopReason"] {
  if (reason === "tool_calls") return "toolUse";
  if (reason === "length") return "length";
  return "stop";
}

function parseUsage(
  chunk: ChatChunk,
  model: Model<Api>,
): AssistantMessage["usage"] | undefined {
  if (!chunk.usage) return undefined;
  const input = chunk.usage.prompt_tokens ?? 0;
  const output = chunk.usage.completion_tokens ?? 0;
  const cacheRead = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    totalTokens: chunk.usage.total_tokens ?? input + output,
    cost: {
      input: (input / 1_000_000) * model.cost.input,
      output: (output / 1_000_000) * model.cost.output,
      cacheRead: (cacheRead / 1_000_000) * model.cost.cacheRead,
      cacheWrite: 0,
      total:
        (input / 1_000_000) * model.cost.input +
        (output / 1_000_000) * model.cost.output,
    },
  };
}

async function* readSse(response: Response): AsyncGenerator<ChatChunk> {
  if (!response.body) throw new Error("Poolside response body missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const chunk = JSON.parse(data) as ChatChunk;
        const toolCalls = chunk.choices?.[0]?.delta?.tool_calls;
        if (toolCalls) {
          debugLog("RAW_TOOL_CALLS", {
            id: chunk.id,
            model: chunk.model,
            finish_reason: chunk.choices?.[0]?.finish_reason,
            tool_calls: toolCalls,
          });
        }
        yield chunk;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export function streamSimplePoolside(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: initialUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      if (!options?.apiKey)
        throw new Error(`No API key for provider: ${model.provider}`);
      let payload = buildPayload(model, context, options);
      const nextPayload = await options.onPayload?.(payload, model);
      if (nextPayload !== undefined)
        payload = nextPayload as Record<string, unknown>;

      const response = await fetch(`${model.baseUrl}/chat/completions`, {
        method: "POST",
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          ...model.headers,
          ...options.headers,
        },
        body: JSON.stringify(payload),
      });

      await options.onResponse?.(
        {
          status: response.status,
          headers: Object.fromEntries(response.headers),
        },
        model,
      );

      if (!response.ok)
        throw new Error(
          `Poolside HTTP ${response.status}: ${await response.text()}`,
        );

      stream.push({ type: "start", partial: output });

      let currentBlock: TextContent | ThinkingContent | null = null;
      const toolBlocksByKey = new Map<string, number>();
      const blockIndex = () =>
        currentBlock ? output.content.indexOf(currentBlock) : -1;

      const finishCurrentBlock = () => {
        if (!currentBlock) return;
        const contentIndex = blockIndex();
        if (contentIndex === -1) return;
        if (currentBlock.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex,
            content: currentBlock.text,
            partial: output,
          });
        } else {
          stream.push({
            type: "thinking_end",
            contentIndex,
            content: currentBlock.thinking,
            partial: output,
          });
        }
        currentBlock = null;
      };

      for await (const chunk of readSse(response)) {
        output.responseId ||= chunk.id;
        if (chunk.model && chunk.model !== model.id)
          output.responseModel ||= chunk.model;
        const usage = parseUsage(chunk, model);
        if (usage) output.usage = usage;

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason)
          output.stopReason = mapStopReason(choice.finish_reason);
        const delta = choice.delta;
        if (!delta) continue;

        if (delta.content) {
          if (!currentBlock || currentBlock.type !== "text") {
            finishCurrentBlock();
            currentBlock = { type: "text", text: "" };
            output.content.push(currentBlock);
            stream.push({
              type: "text_start",
              contentIndex: blockIndex(),
              partial: output,
            });
          }
          currentBlock.text += delta.content;
          stream.push({
            type: "text_delta",
            contentIndex: blockIndex(),
            delta: delta.content,
            partial: output,
          });
        }

        const thinkingDelta =
          delta.reasoning_content ?? delta.reasoning ?? delta.reasoning_text;
        if (thinkingDelta) {
          if (!currentBlock || currentBlock.type !== "thinking") {
            finishCurrentBlock();
            currentBlock = {
              type: "thinking",
              thinking: "",
              thinkingSignature: "reasoning_content",
            };
            output.content.push(currentBlock);
            stream.push({
              type: "thinking_start",
              contentIndex: blockIndex(),
              partial: output,
            });
          }
          currentBlock.thinking += thinkingDelta;
          stream.push({
            type: "thinking_delta",
            contentIndex: blockIndex(),
            delta: thinkingDelta,
            partial: output,
          });
        }

        for (const toolCall of delta.tool_calls ?? []) {
          finishCurrentBlock();
          // Poolside can stream the tool name and arguments with different ids for
          // the same logical tool call. The OpenAI stream index is the stable key.
          const key =
            toolCall.index !== undefined
              ? `index:${toolCall.index}`
              : `id:${toolCall.id ?? toolBlocksByKey.size}`;
          let index = toolBlocksByKey.get(key);
          let block = index === undefined ? undefined : output.content[index];

          if (!block || block.type !== "toolCall") {
            block = {
              type: "toolCall",
              id:
                toolCall.id ??
                `poolside-tool-${toolCall.index ?? toolBlocksByKey.size}`,
              name: toolCall.function?.name ?? "",
              arguments: {},
              partialArgs: "",
              streamIndex: toolCall.index,
            } as StreamingToolCallBlock;
            output.content.push(block);
            index = output.content.length - 1;
            toolBlocksByKey.set(key, index);
            stream.push({
              type: "toolcall_start",
              contentIndex: index,
              partial: output,
            });
          }

          const toolBlock = block as StreamingToolCallBlock;
          if (!toolBlock.name && toolCall.function?.name)
            toolBlock.name = toolCall.function.name;
          if (!toolBlock.id && toolCall.id) toolBlock.id = toolCall.id;
          const argsDelta = toolCall.function?.arguments ?? "";
          toolBlock.partialArgs = `${toolBlock.partialArgs ?? ""}${argsDelta}`;
          toolBlock.arguments = parseStreamingJson(toolBlock.partialArgs);
          if (index === undefined) continue;
          stream.push({
            type: "toolcall_delta",
            contentIndex: index,
            delta: argsDelta,
            partial: output,
          });
        }
      }

      finishCurrentBlock();
      for (const index of toolBlocksByKey.values()) {
        const block = output.content[index];
        if (block?.type !== "toolCall") continue;
        const toolBlock = block as StreamingToolCallBlock;
        toolBlock.arguments = parseStreamingJson(toolBlock.partialArgs ?? "");
        delete toolBlock.partialArgs;
        delete toolBlock.streamIndex;
        stream.push({
          type: "toolcall_end",
          contentIndex: index,
          toolCall: toolBlock,
          partial: output,
        });
      }

      stream.push({
        type: "done",
        reason:
          output.stopReason === "toolUse"
            ? "toolUse"
            : output.stopReason === "length"
              ? "length"
              : "stop",
        message: output,
      });
      stream.end(output);
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage =
        error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end(output);
    }
  })();

  return stream;
}
