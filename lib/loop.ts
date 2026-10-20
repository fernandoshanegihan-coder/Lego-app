/**
 * lib/loop.ts — the agent loop, hand-rolled. `spec.md > Components > The agent loop`.
 *
 * Roughly forty lines on purpose: making the mechanism explicit is the point
 * of this project. The loop is transport-agnostic — it only ever calls
 * `mcpClient.callTool`, so swapping the in-process server for a stdio
 * subprocess is a two-line change.
 *
 * Six-turn cap: after six turns without a converged answer, stop and say so
 * rather than spin. (The three-strike drop rule arrives with the design loop
 * in slice 5.)
 *
 * Provider: Google Gemini over REST (`streamGenerateContent?alt=sse`). Two
 * protocol details handled here, both load-bearing:
 *   - text deltas arrive as separate SSE chunks and are concatenated for the
 *     conversation copy, so history sees one part where the stream saw many;
 *   - thinking models return `thought` parts and `thoughtSignature` fields —
 *     thought parts are hidden from the chat, but every part is pushed back
 *     into `contents` VERBATIM (signatures included), which is what Gemini
 *     requires for multi-turn function calling.
 */
import type { ChatEventHandler } from "@/lib/sse";
import { MAX_TOKENS, streamGenerateContent, toFunctionDeclarations } from "@/lib/gemini";import { validateBuild } from "@/validate/validateBuild";
import type { PlacedBrick, Violation } from "@/lib/types";
import type { ToolContext, AnthropicTool } from "@/mcp/tools";

export const MAX_TURNS = 6;

export interface LoopOptions {
  /** The system prompt — built from this request's pool. */
  system: string;
  /** Tool schemas from the MCP server's own listTools(). */
  tools: AnthropicTool[];
  /** Connected MCP client — never the server directly. */
  mcpClient: {
    callTool: (args: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  };
  ctx: ToolContext;
  /** History after the system prompt: the browser's message array. */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  emit: ChatEventHandler;
}

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  [key: string]: unknown;
}

interface GenerateChunk {
  candidates?: Array<{
    content?: { parts?: Part[]; role?: string };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

export async function runLoop(opts: LoopOptions): Promise<void> {
  const { system, tools, mcpClient, ctx, messages, emit } = opts;

  // browser history → Gemini turns: user stays, assistant is "model"
  const conversation: Array<{ role: "user" | "model"; parts: Part[] }> = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const functionDeclarations = toFunctionDeclarations(tools);

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const res = await streamGenerateContent({
      systemInstruction: { parts: [{ text: system }] },
      contents: conversation,
      tools: [{ functionDeclarations }],
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`The model request failed (${res.status}). ${detail.slice(0, 300)}`);
    }

    // One upstream SSE stream → accumulated parts + UI text deltas.
    const accumulated: Part[] = [];
    const calls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Normalise CRLF so event boundaries are always "\n\n".
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      buffer = buffer.replace(/\r\n/g, "\n");

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const line = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (!line.startsWith("data: ")) continue;

        let chunk: GenerateChunk;
        try {
          chunk = JSON.parse(line.slice(6)) as GenerateChunk;
        } catch {
          continue; // torn chunk — skipped, not fatal
        }

        const blocked = chunk.promptFeedback?.blockReason;
        if (blocked) throw new Error(`The model declined this request (${blocked}).`);

        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.thought) {
            // Reasoning is not chat content, but it goes back into history.
            accumulated.push(part);
            continue;
          }
          if (typeof part.text === "string") {
            // Collapse the stream's text fragments where history expects one part.
            const prev = accumulated[accumulated.length - 1];
            if (prev && typeof prev.text === "string" && !prev.thought) {
              prev.text += part.text;
            } else {
              accumulated.push({ text: part.text });
            }
            emit({ type: "text", text: part.text });
          } else if (part.functionCall) {
            accumulated.push(part);
            calls.push({ name: part.functionCall.name, args: part.functionCall.args });
          } else {
            accumulated.push(part);
          }
        }
      }
    }

    if (calls.length === 0) break; // plain reply — conversation done

    // Model turn verbatim (signatures preserved), then one user turn with
    // every function response — Gemini's multi-turn function-calling shape.
    conversation.push({ role: "model", parts: accumulated });

    const responses: Part[] = [];
    for (const call of calls) {
      let payload: unknown;
      try {
        const raw = await mcpClient.callTool({
          name: call.name,
          arguments: call.args as Record<string, unknown> | undefined,
        });
        const mcp = raw as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
        const text = (mcp.content ?? [])
          .map((c) => (typeof c.text === "string" ? c.text : ""))
          .join("\n");
        payload = mcp.isError ? { error: text } : text;
      } catch (err) {
        // Tool-level failure — returned as a result, not thrown: the model
        // reads the message and fixes its next call.
        payload = { error: err instanceof Error ? err.message : String(err) };
      }

      // Every tool call has a UI consequence — decided here, once.
      emitToolEvents(call.name, ctx, emit);

      responses.push({ functionResponse: { name: call.name, response: { result: payload } } });
    }
    conversation.push({ role: "user", parts: responses });
  }

  // ---- The three-strike rule ---------------------------------------------
  // If the model never converged, the guarantee still holds: drop the
  // offending bricks and render what remains. `spec.md > The agent loop`.
  if (!ctx.savedBuild && ctx.lastBricks?.length) {
    const outcome = applyDropRule(ctx.lastBricks, ctx.pool);
    const result = validateBuild(outcome.bricks, ctx.pool);
    emit({
      type: "kernel",
      ok: result.ok,
      used: result.used,
      available: result.available,
      violations: result.ok ? undefined : outcome.violations,
      dropped: outcome.dropped,
    });
    if (result.ok && result.used > 0) {
      emit({
        type: "build",
        name: "Your build",
        bricks: outcome.bricks,
        used: result.used,
        available: result.available,
      });
    }
  }
}

interface DropOutcome {
  bricks: PlacedBrick[];
  dropped: number;
  violations: Violation[];
}

/**
 * Three passes: each one removes the bricks the kernel rejects, then
 * re-validates what is left (removing a support brick can orphan the one
 * above it). What survives is legal by construction.
 *
 * Exported so the backstop can be tested directly — this is the layer that
 * makes the guarantee hold even when the model never converges.
 */
export function applyDropRule(
  bricks: PlacedBrick[],
  pool: ToolContext["pool"],
): DropOutcome {
  let kept = bricks;
  let dropped = 0;
  let violations: Violation[] = [];

  for (let strike = 0; strike < 3; strike++) {
    const result = validateBuild(kept, pool);
    if (result.ok) return { bricks: kept, dropped, violations: [] };
    violations = result.violations;
    const bad = new Set(result.violations.map((v) => v.brickIndex));
    kept = kept.filter((_, index) => !bad.has(index));
    dropped += bad.size;
  }

  const final = validateBuild(kept, pool);
  return {
    bricks: final.ok ? kept : [],
    dropped,
    violations: final.ok ? [] : final.violations,
  };
}

/** After each tool call, mirror the request-scoped outcomes to the browser. */
function emitToolEvents(name: string, ctx: ToolContext, emit: ChatEventHandler): void {
  if (name === "propose_ideas" && ctx.ideas) {
    emit({ type: "ideas", ideas: ctx.ideas });
    return;
  }
  if (name === "validate_build" && ctx.kernelResult) {
    const { ok, used, available, violations } = ctx.kernelResult;
    emit({ type: "kernel", ok, used, available, violations });
    return;
  }
  if (name === "save_build" && ctx.savedBuild) {
    emit({
      type: "build",
      name: ctx.savedBuild.name,
      bricks: ctx.savedBuild.bricks,
      used: ctx.savedBuild.used,
      available: ctx.savedBuild.available,
    });
  }
}
