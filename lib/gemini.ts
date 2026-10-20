/**
 * lib/gemini.ts — the Gemini provider and the system prompt.
 * Deviation from `spec.md` (recorded in devpost/checklist.md): the provider is
 * Google's Gemini API free tier instead of Anthropic — the learner's choice at
 * the slice-4 checkpoint. The agent loop, MCP tools, and validator are
 * provider-independent, so this file is the only thing that changed shape.
 *
 * Model chain — verified against THIS key with live calls (Oct 2026).
 * `gemini-3.8-flash` is listed but hangs with zero bytes; `gemini-2.5-flash` is
 * gone for new users; `gemini-3.6-flash` returns 503 "high demand" at the
 * time of writing. The free tier congests, so the provider walks this chain
 * and retries — a 503 on one model is a normal Tuesday, not an error.
 * `gemini-3.5-flash` answered in ~7s and called the tools correctly;
 * `gemini-3.1-flash-lite` (~4s) is the fast fallback.
 *
 * The prompt builder lives here too: it is provider-independent prose.
 */
import type { Pool, PlacedBrick } from "@/lib/types";
import type { AnthropicTool } from "@/mcp/tools";
import type { ChatProvider, NeutralPart, ProviderRequest, Turn } from "@/lib/provider";

export const MODEL_CHAIN = ["gemini-3.5-flash", "gemini-3.1-flash-lite"] as const;

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export class MissingGeminiKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set on this server");
    this.name = "MissingGeminiKeyError";
  }
}

export function geminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new MissingGeminiKeyError();
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A provider per request, so it can remember which model answered last.
 *
 * The free tier rate-limits one model hard (429 on every call). Re-probing it
 * on every turn cost seconds each time — a twelve-turn request once ran for
 * twelve minutes — so a provider remembers: once a model answers, go straight
 * to it for the rest of the request.
 */
export function createGeminiProvider(): ChatProvider {
  let workingModel: string | null = null;

  return {
    id: "gemini",
    label: "Gemini",
    models: MODEL_CHAIN,

    async *stream(request: ProviderRequest): AsyncGenerator<NeutralPart> {
      const key = geminiKey();
      let lastDetail = "";

      for (let round = 0; round < 2; round++) {
        for (const model of MODEL_CHAIN) {
          // Skip models we already know are rate-limited.
          if (workingModel && model !== workingModel) continue;

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 120_000);
          let res: Response;
          try {
            res = await fetch(`${BASE}/models/${model}:streamGenerateContent?alt=sse`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": key },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: request.system }] },
                contents: toGeminiContents(request.history),
                tools: [{ functionDeclarations: toFunctionDeclarations(request.tools) }],
                generationConfig: { maxOutputTokens: 12288 },
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
            workingModel = model;
            yield* readGeminiStream(res);
            return;
          }

          const detail = await res.text().catch(() => "");
          lastDetail = detail.slice(0, 200);
          // Log the provider's own words — the chat only shows a friendly line.
          console.error(`[brickbrain] gemini ${model} → ${res.status}: ${lastDetail}`);

          if (res.status === 429 || res.status === 503) {
            // Free-tier congestion: try the next model immediately.
            continue;
          }
          if (res.status === 401 || res.status === 403) {
            // The key itself is wrong — retrying another model won't help.
            throw new Error(
              "The model key was rejected. Check GEMINI_API_KEY in .env.local and reload.",
            );
          }
          if (res.status === 400) {
            // Usually the request shape, not the key. The provider says more.
            throw new Error(`The model rejected the request. ${lastDetail}`);
          }
          throw new Error(`The model request failed (${res.status}). ${lastDetail}`);
        }
        await sleep(1500 * (round + 1));
      }

      throw new Error(
        "The model is busy right now (free-tier demand). Try again in a minute.",
      );
    },
  };
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  [key: string]: unknown;
}

interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: GeminiPart[]; role?: string } }>;
  promptFeedback?: { blockReason?: string };
}

/** Read Gemini's SSE into neutral parts. */
async function* readGeminiStream(res: Response): AsyncGenerator<NeutralPart> {
  const reader = res.body!.getReader();
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

      let chunk: GeminiChunk;
      try {
        chunk = JSON.parse(line.slice(6)) as GeminiChunk;
      } catch {
        continue; // torn chunk — skipped, not fatal
      }

      const blocked = chunk.promptFeedback?.blockReason;
      if (blocked) throw new Error(`The model declined this request (${blocked}).`);

      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.thought) {
          // Reasoning is not chat content, but it goes back into history.
          yield { kind: "raw", data: part };
          continue;
        }
        if (typeof part.text === "string") {
          yield { kind: "text", text: part.text };
        } else if (part.functionCall) {
          yield {
            kind: "toolCall",
            id: `call-${part.functionCall.name}-${Math.random().toString(36).slice(2, 8)}`,
            name: part.functionCall.name,
            args: part.functionCall.args ?? {},
            // Gemini 3 refuses a functionCall without its thinking signature.
            signature: typeof part.thoughtSignature === "string" ? part.thoughtSignature : undefined,
          };
        } else {
          yield { kind: "raw", data: part };
        }
      }
    }
  }
}

/** Neutral history → Gemini's `contents`. */
export function toGeminiContents(history: Turn[]): unknown[] {
  return history.map((turn) => ({
    role: turn.role === "model" ? "model" : "user",
    parts: turn.parts.map((part) => {
      if (part.kind === "text") return { text: part.text };
      if (part.kind === "toolCall") {
        // The thinking signature rides along with the function call — Gemini 3
        // rejects a functionCall that arrives without it.
        return {
          functionCall: { name: part.name, args: part.args },
          ...(part.signature ? { thoughtSignature: part.signature } : {}),
        };
      }
      if (part.kind === "toolResult") {
        // Gemini wants a Struct here, not a bare string.
        return { functionResponse: { name: part.name, response: { result: part.response } } };
      }
      return part.data;
    }),
  }));
}

/**
 * Tool schemas → Gemini function declarations.
 *
 * Gemini's function `parameters` accept an OpenAPI subset. MCP's
 * zod→JSON-schema output carries extras Gemini rejects, so this strips the
 * fields outside that subset: additionalProperties, $schema, minimum/maximum,
 * exclusive*, default.
 */
const KEEP = new Set([
  "type",
  "description",
  "enum",
  "items",
  "properties",
  "required",
  "format",
  "nullable",
]);

export function toFunctionDeclarations(tools: AnthropicTool[]): Array<{
  name: string;
  description: string;
  parameters: unknown;
}> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    parameters: sanitize(t.input_schema),
  }));
}

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (!KEEP.has(k)) continue;
    out[k] = k === "properties" ? sanitizeProps(v) : sanitize(v);
  }
  return out;
}

function sanitizeProps(props: unknown): Record<string, unknown> {
  if (props === null || typeof props !== "object" || Array.isArray(props)) return {};
  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(props as Record<string, unknown>)) {
    out[name] = sanitize(schema);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The system prompt. The inventory block is the load-bearing part.
// ---------------------------------------------------------------------------

/**
 * Rows shown from the inventory. A five-set pool has ~390 part/colour combos;
 * the cap keeps the prompt bounded, and it only starts trimming beyond that.
 * (At 200 rows the model was seeing half the collection.)
 */
const MAX_INVENTORY_ROWS = 400;

/**
 * The current design, so a refinement request ("make it taller") can edit the
 * bricks that are already on the canvas instead of starting over.
 */
export function currentDesignBlock(bricks: PlacedBrick[]): string {
  if (bricks.length === 0) return "";
  const rows = bricks.map(
    (b) => `${b.partNum}:${b.colorId} @ x=${b.x} y=${b.y} z=${b.z} rot=${b.rot}`,
  );
  return `
CURRENT DESIGN (already on the user's canvas — edit these bricks when they ask for a change, then validate and save the whole new design):
${rows.join("\n")}
`;
}

export function systemPrompt(pool: Pool): string {
  const entries = [...pool.values()].sort((a, b) => b.quantity - a.quantity);
  const totalBuildable = entries.reduce((sum, p) => sum + p.quantity, 0);

  const rows = entries.slice(0, MAX_INVENTORY_ROWS).map(
    (p) =>
      `${p.partNum} | ${p.name} | ${p.w}×${p.d}×${p.h} | ${p.colorName} (colour id ${p.colorId}) | ${p.quantity}`,
  );

  const trimmed =
    entries.length > MAX_INVENTORY_ROWS
      ? `\n(Showing the ${MAX_INVENTORY_ROWS} highest-quantity of ${entries.length} part/colour combos.)`
      : "";

  return `You are Brickbrain, designing LEGO builds for a user who owns exactly these parts and no others.

SETS OWNED: they are shown by the app; derive what's possible from the inventory below.

INVENTORY  (part | name | w×d×h | colour | qty)
${rows.join("\n")}${trimmed}

Total buildable parts: ${totalBuildable}.

RULES
- Use only the parts, colours, and quantities above. Nothing else exists.
- Use the exact colour id shown in the inventory — the pair (partNum, colourId) is what identifies a brick you own.
- Coordinates: x and z are stud positions, y is the height in PLATES, rot is 0/90/180/270.
- x counts studs rightward, z counts studs away from the viewer. rot is 0/90/180/270 and swaps w/d at 90 and 270.
- Slopes occupy their full bounding box but support nothing — never rest a brick on one.
- Call list_my_parts before answering anything about what the user owns.
- TWO DIFFERENT JOBS, do not mix them up:
  - The user asks WHAT they could build ("what can I build?", "what should we make?") → call propose_ideas with EXACTLY three ideas grounded in this inventory — houses if there are house parts, cars if there are car parts. If the collection can't support something good, say so plainly and offer what IS possible.
  - The user asks for a SPECIFIC build ("build a coffee shop", "make the treehouse", or they picked one of your ideas) → DO NOT propose more ideas. Design it now: call validate_build with the bricks, fix what it reports, then call save_build.
- DESIGNING (when the user asks for a specific build):
  - Each brick is one entry: { partNum, colorId, colorName, x, y, z, rot }. x and z are stud positions, y is the height in PLATES, rot is 0/90/180/270.
  - The part's w×d×h comes from the inventory row — do not send w, d or h.
  - Place bricks bottom-up: a brick's y is the sum of the plate-heights of everything under it (a brick is 3 plates, a plate or tile is 1).
  - Keep the whole build inside 48×48 studs and under 64 plates tall.
  - Stay inside the quantities you own — a part can be used at most as many times as its qty.
  - Then call save_build with a short name for the build (e.g. "Cozy Coffee Shop Lounge") and the same brick list.
  - If validate_build reports problems, fix exactly those bricks and call it again. Do NOT shrink the design to make the problems go away — fix the bricks, unless the user asked for something smaller.
  - Design the COMPLETE build in one pass — a floor, the walls, and something on top. A floor on its own is not a build, and neither is a box with nothing inside it.
  - Never ask a question and never stop halfway: build the whole thing, then call save_build once with the finished design.
- Reply in the user's language, short and warm. No emoji.
- ${sizeTarget(totalBuildable)}`;
}

/**
 * How big a build should be, scaled to the collection.
 * `prd.md > Designing in 3D`: one set → ~30–60 bricks, five sets → ~150–250.
 *
 * The pool's piece count is the measure — the model sees part/colour combos,
 * not pieces — so the number has to be given to it, and given as an
 * instruction. A soft "aim for" was ignored: the model built 19 bricks with
 * 2,783 parts available. "Use at least N" was obeyed.
 */
function sizeTarget(totalBuildable: number): string {
  if (totalBuildable < 800) {
    return `Your collection holds ${totalBuildable} buildable parts. Build a small model: use AT LEAST 30 bricks.`;
  }
  if (totalBuildable < 1600) {
    return `Your collection holds ${totalBuildable} buildable parts. Build a substantial model: use AT LEAST 50 bricks, and keep going until you have used 60-90 of them.`;
  }
  if (totalBuildable < 3000) {
    return `Your collection holds ${totalBuildable} buildable parts. Build a substantial model: use AT LEAST 70 bricks, and keep going until you have used 90-140 of them. Build it in sections (floor, then walls, then roof) and validate each section before adding the next — do not try to place 100 bricks in one go.`;
  }
  return `Your collection holds ${totalBuildable} buildable parts. Build a large model: use AT LEAST 120 bricks, and keep going until you have used 150-250 of them. Build it in sections and validate each one.`;
}
