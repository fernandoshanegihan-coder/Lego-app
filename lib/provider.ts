/**
 * lib/provider.ts — the provider contract.
 *
 * The kernel, the tools and the agent loop are provider-independent: they
 * only know about "parts" (text, tool calls, tool results). A provider
 * translates those parts to its own wire format and back.
 *
 * Two providers ship:
 *   - lib/gemini.ts       Google's Gemini API, free tier
 *   - lib/openrouter.ts   OpenRouter (one key, many models, OpenAI-compatible)
 *
 * A provider is asked for ONE turn. It walks its own model chain and throws
 * if it cannot serve the turn; the loop then tries the next provider.
 */
import type { AnthropicTool } from "@/mcp/tools";

/** A piece of a conversation, in provider-neutral terms. */
export type NeutralPart =
  /** Prose for the chat. */
  | { kind: "text"; text: string }
  /** The model asking for a tool. `signature` carries the provider's own
   *  thinking signature (Gemini 3 requires it back on the next turn). */
  | { kind: "toolCall"; id: string; name: string; args: Record<string, unknown>; signature?: string }
  /** The result of a tool, going back to the model. */
  | { kind: "toolResult"; id: string; name: string; response: unknown }
  /** Provider-specific data that must survive the round trip (e.g. Gemini's
   *  thought signatures, which its API requires back in the history). */
  | { kind: "raw"; data: unknown };

/** One turn of the conversation. */
export interface Turn {
  role: "user" | "model";
  parts: NeutralPart[];
}

export interface ProviderRequest {
  /** The system prompt. */
  system: string;
  /** The conversation so far, including any tool results. */
  history: Turn[];
  /** The tools the model may call. */
  tools: AnthropicTool[];
}

export interface ChatProvider {
  id: string;
  /** Shown in the chat when a provider takes over. */
  label: string;
  /** The models this provider tries, in order. */
  models: readonly string[];
  /** One turn, streamed. Throws when the provider cannot serve it. */
  stream(request: ProviderRequest): AsyncGenerator<NeutralPart>;
}

/** Split a turn's parts by kind — the shape every provider needs. */
export function textsOf(turn: Turn): string {
  return turn.parts
    .filter((p): p is Extract<NeutralPart, { kind: "text" }> => p.kind === "text")
    .map((p) => p.text)
    .join("");
}
