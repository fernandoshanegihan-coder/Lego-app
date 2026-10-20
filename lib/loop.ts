/**
 * lib/loop.ts — the agent loop, hand-rolled. `spec.md > Components > The agent loop`.
 *
 * Roughly forty lines on purpose: making the mechanism explicit is the point
 * of this project. The loop is transport-agnostic — it only ever calls
 * `mcpClient.callTool`, so swapping the in-process server for a stdio
 * subprocess is a two-line change.
 *
 * It is also provider-agnostic: it asks a `ChatProvider` for one turn and
 * understands only text, tool calls and tool results. The provider list is
 * tried in order — Gemini first, OpenRouter as the fallback when the free
 * tier is congested.
 *
 * Six-turn cap: after six turns without a converged answer, stop and say so
 * rather than spin. (The three-strike drop rule arrives with the design loop
 * in slice 5.)
 */
import type { ChatEventHandler } from "@/lib/sse";
import { validateBuild } from "@/validate/validateBuild";
import type { PlacedBrick, Violation } from "@/lib/types";
import type { ToolContext, AnthropicTool } from "@/mcp/tools";
import type { ChatProvider, NeutralPart, Turn } from "@/lib/provider";

/**
 * Turns per request. A big design is built in sections, and every section
 * costs a validate/fix round — at 8 turns the model ran out of room at ~30
 * bricks, so there is headroom for a real build.
 */
export const MAX_TURNS = 12;

/**
 * Wall-clock budget for one request. The turn cap alone was not enough: on a
 * rate-limited tier a single turn can take 30s+, and a twelve-turn request
 * once ran for twelve minutes. The user gets whatever is legal by then.
 */
export const MAX_DURATION_MS = 150_000;

export interface LoopOptions {
  /** The system prompt — built from this request's pool. */
  system: string;
  /** Providers, in the order they should be tried. */
  providers: ChatProvider[];
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

export async function runLoop(opts: LoopOptions): Promise<void> {
  const { system, providers, tools, mcpClient, ctx, messages, emit } = opts;

  // browser history → neutral turns: the user's message stays, the assistant
  // becomes the model's turn.
  const history: Turn[] = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ kind: "text", text: m.content }],
  }));

  const startedAt = Date.now();

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    if (Date.now() - startedAt > MAX_DURATION_MS) {
      emit({ type: "error", message: "That's as far as I got in the time available." });
      break;
    }

    // ---- one turn, trying each provider in turn ---------------------------
    let parts: NeutralPart[] = [];
    let responded = false;
    let lastError: Error | null = null;

    for (const provider of providers) {
      const collected: NeutralPart[] = [];
      try {
        for await (const part of provider.stream({ system, history, tools })) {
          if (part.kind === "text") emit({ type: "text", text: part.text });
          collected.push(part);
        }

        // A turn with neither prose nor a tool call is a dead turn — the free
        // tier does this under load. Try the next provider rather than ending
        // the conversation with nothing.
        const said = collected
          .filter((p): p is Extract<NeutralPart, { kind: "text" }> => p.kind === "text")
          .map((p) => p.text)
          .join("")
          .trim();
        const asked = collected.some((p) => p.kind === "toolCall");
        if (!said && !asked) {
          lastError = new Error("The model returned an empty response.");
          continue;
        }

        parts = collected;
        responded = true;
        console.log(`[brickbrain] turn ${turn} served by ${provider.id} (${provider.models[0]})`);
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    if (!responded) {
      // Every provider failed. The user gets one plain line; the page survives.
      emit({
        type: "error",
        message: lastError?.message ?? "The model stopped responding.",
      });
      break;
    }

    const toolCalls = parts.filter(
      (p): p is Extract<NeutralPart, { kind: "toolCall" }> => p.kind === "toolCall",
    );
    if (toolCalls.length === 0) break; // plain reply — done

    // The model's turn, verbatim (thought signatures and all).
    history.push({ role: "model", parts });

    const results: NeutralPart[] = [];
    for (const call of toolCalls) {
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

      results.push({ kind: "toolResult", id: call.id, name: call.name, response: payload });
    }
    history.push({ role: "user", parts: results });
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
