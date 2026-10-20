/**
 * lib/openrouter.ts — the second provider: OpenRouter.
 *
 * One key, many models, and an OpenAI-compatible API. It is a FALLBACK: the
 * loop tries Gemini first and only comes here when Gemini's whole model chain
 * is exhausted (the free tier returns 503 under demand, which it did all
 * through the build). With no OPENROUTER_API_KEY set, this provider is never
 * even created — the app behaves exactly as it did.
 *
 * The models below are free (:free) and support tool calling, which is the
 * only capability this app needs from a model.
 */
import type { AnthropicTool } from "@/mcp/tools";
import type { ChatProvider, NeutralPart, ProviderRequest, Turn } from "@/lib/provider";

/** Free OpenRouter models that support tool calling, fastest first. */
export const OPENROUTER_MODEL_CHAIN = [
  "minimax/minimax-m3.1-flash:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3.5-lightning:free",
] as const;

const BASE = "https://openrouter.ai/api/v1";

export class MissingOpenRouterKeyError extends Error {
  constructor() {
    super("OPENROUTER_API_KEY is not set on this server");
    this.name = "MissingOpenRouterKeyError";
  }
}

export function openRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new MissingOpenRouterKeyError();
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const openRouterProvider: ChatProvider = {
  id: "openrouter",
  label: "OpenRouter",
  models: OPENROUTER_MODEL_CHAIN,

  async *stream(request: ProviderRequest): AsyncGenerator<NeutralPart> {
    const key = openRouterKey();
    let lastDetail = "";

    for (let round = 0; round < 2; round++) {
      for (const model of OPENROUTER_MODEL_CHAIN) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120_000);
        let res: Response;
        try {
          res = await fetch(`${BASE}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
              "X-OpenRouter-Title": "Brickbrain",
            },
            body: JSON.stringify({
              model,
              stream: true,
              messages: toOpenAiMessages(request.system, request.history),
              tools: toOpenAiTools(request.tools),
              max_tokens: 8192,
            }),
            signal: controller.signal,
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            throw new Error("The model took too long to respond. Try again.");
          }
          throw err;
        } finally {
          clearTimeout(timer);
        }

        if (res.ok) {
          yield* readOpenAiStream(res);
          return;
        }

        const detail = await res.text().catch(() => "");
        lastDetail = detail.slice(0, 200);

        if (res.status === 429 || res.status >= 500) {
          // Rate limited or congested: try the next model.
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            "OpenRouter rejected the key. Check OPENROUTER_API_KEY in .env.local and reload.",
          );
        }
        if (res.status === 400) {
          throw new Error(`The model rejected the request. ${lastDetail}`);
        }
        throw new Error(`The model request failed (${res.status}). ${lastDetail}`);
      }
      await sleep(1500 * (round + 1));
    }

    throw new Error("Every model provider is busy right now. Try again in a minute.");
  },
};

interface OpenAiToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: OpenAiToolCallDelta[] };
    finish_reason?: string | null;
    error?: { message?: string };
  }>;
}

/**
 * Read OpenAI-shaped SSE into neutral parts.
 *
 * Two details matter: text arrives as `delta.content`, and a tool call's
 * arguments arrive in fragments across chunks (so they are accumulated per
 * call index and parsed once, at the end).
 */
export async function* readOpenAiStream(res: Response): AsyncGenerator<NeutralPart> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Accumulated tool calls, keyed by their index in the delta stream.
  const calls = new Map<number, { id: string; name: string; args: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    buffer = buffer.replace(/\r\n/g, "\n");

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const line = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;

      let chunk: OpenAiChunk;
      try {
        chunk = JSON.parse(data) as OpenAiChunk;
      } catch {
        continue; // torn chunk — skipped, not fatal
      }

      const choice = chunk.choices?.[0];
      if (choice?.error?.message) {
        throw new Error(`The model returned an error: ${choice.error.message}`);
      }

      const text = choice?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        yield { kind: "text", text };
      }

      for (const call of choice?.delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const existing = calls.get(index) ?? { id: "", name: "", args: "" };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.name = call.function.name;
        if (call.function?.arguments) existing.args += call.function.arguments;
        calls.set(index, existing);
      }
    }
  }

  // The tool calls are complete now — parse their arguments once.
  for (const call of calls.values()) {
    if (!call.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = call.args ? (JSON.parse(call.args) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    yield {
      kind: "toolCall",
      id: call.id || `call-${call.name}`,
      name: call.name,
      args,
    };
  }
}

/** Neutral history → OpenAI-style messages. */
export function toOpenAiMessages(system: string, history: Turn[]): unknown[] {
  const messages: unknown[] = [{ role: "system", content: system }];

  for (const turn of history) {
    const text = turn.parts
      .filter((p): p is Extract<NeutralPart, { kind: "text" }> => p.kind === "text")
      .map((p) => p.text)
      .join("");

    if (turn.role === "model") {
      const toolCalls = turn.parts.filter(
        (p): p is Extract<NeutralPart, { kind: "toolCall" }> => p.kind === "toolCall",
      );
      const message: Record<string, unknown> = { role: "assistant", content: text || null };
      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        }));
      }
      messages.push(message);
      continue;
    }

    // A user turn: either prose, or the results of tool calls.
    const results = turn.parts.filter(
      (p): p is Extract<NeutralPart, { kind: "toolResult" }> => p.kind === "toolResult",
    );
    if (results.length > 0) {
      for (const result of results) {
        messages.push({
          role: "tool",
          tool_call_id: result.id,
          content: JSON.stringify(result.response),
        });
      }
      continue;
    }
    if (text) messages.push({ role: "user", content: text });
  }

  return messages;
}

/** Tool schemas → OpenAI-style function tools. */
export function toOpenAiTools(tools: AnthropicTool[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.input_schema,
    },
  }));
}
