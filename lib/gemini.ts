/**
 * lib/gemini.ts — the model provider, the key check, the system prompt.
 * Deviation from `spec.md` (recorded in devpost/checklist.md): the provider is
 * Google's Gemini API free tier instead of Anthropic — the learner's choice at
 * the slice-4 checkpoint. The agent loop, MCP tools, and validator are
 * provider-independent, so this file is the only thing that changed shape.
 *
 * Model chain — verified against THIS key with live calls (Oct 2026).
 * `gemini-3.8-flash` is listed but hangs with zero bytes; `gemini-2.5-flash` is
 * gone for new users; `gemini-3.6-flash` returns 503 "high demand" at the
 * time of writing. The free tier congests, so the provider layer walks this
 * chain and retries — a 503 on one model is a normal Tuesday, not an error.
 * `gemini-3.5-flash` answered in ~7s and called the tools correctly;
 * `gemini-3.1-flash-lite` (~4s) is the fast fallback.
 */
import type { Pool, PlacedBrick } from "@/lib/types";
import type { AnthropicTool } from "@/mcp/tools";

export const MODEL_CHAIN = ["gemini-3.5-flash", "gemini-3.1-flash-lite"] as const;

/** The model in use — the head of the chain. */
export const MODEL = MODEL_CHAIN[0];

/** One design conversation stays well inside one turn's budget. */
export const MAX_TOKENS = 8192;

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
 * `POST …/{model}:streamGenerateContent?alt=sse`.
 *
 * Walks the model chain and retries: 503 (demand) and 429 (free-tier limit)
 * mean "try the next model", anything else is a real error and is thrown with
 * the provider's own message. A hung provider must become an error line in the
 * chat, never a spinner forever (`spec.md > Important Failure Modes`).
 */
export async function streamGenerateContent(body: unknown): Promise<Response> {
  const key = geminiKey();
  let lastDetail = "";

  for (let round = 0; round < 2; round++) {
    for (const model of MODEL_CHAIN) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      try {
        const res = await fetch(`${BASE}/models/${model}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (res.ok) return res;

        const detail = await res.text().catch(() => "");
        lastDetail = detail.slice(0, 200);

        if (res.status === 429 || res.status === 503) {
          // Free-tier congestion: try the next model immediately.
          continue;
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          // The key itself is wrong — retrying another model won't help.
          throw new Error(
            "The model key was rejected. Check GEMINI_API_KEY in .env.local and reload.",
          );
        }
        throw new Error(`The model request failed (${res.status}). ${lastDetail}`);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error("The model took too long to respond. Try again.");
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    await sleep(1500 * (round + 1));
  }

  throw new Error(
    "The model is busy right now (free-tier demand). Try again in a minute.",
  );
}

// ---------------------------------------------------------------------------
// Tool schemas → Gemini function declarations
//
// Gemini's function `parameters` accept an OpenAPI subset. MCP's
// zod→JSON-schema output carries extras Gemini rejects, so this strips the
// fields outside that subset: additionalProperties, $schema, minimum/maximum,
// exclusive*, default.
// ---------------------------------------------------------------------------

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
 * Rows shown from the inventory. A five-set pool can reach ~400 rows; the cap
 * keeps the prompt bounded and says so when it trims.
 */
const MAX_INVENTORY_ROWS = 200;

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
- Coordinates: x and z in studs, y in plates. A brick is 3 plates tall; a plate or tile is 1.
- x counts studs rightward, z counts studs away from the viewer. rot is 0/90/180/270 and swaps w/d at 90 and 270.
- Slopes occupy their full bounding box but support nothing — never rest a brick on one.
- Call list_my_parts before answering anything about what the user owns.
- TWO DIFFERENT JOBS, do not mix them up:
  - The user asks WHAT they could build ("what can I build?", "what should we make?") → call propose_ideas with EXACTLY three ideas grounded in this inventory — houses if there are house parts, cars if there are car parts. If the collection can't support something good, say so plainly and offer what IS possible.
  - The user asks for a SPECIFIC build ("build a coffee shop", "make the treehouse", or they picked one of your ideas) → DO NOT propose more ideas. Design it now: call validate_build with the bricks, fix what it reports, then call save_build.
- After propose_ideas, do NOT repeat the three ideas in your text — one short line asking which to build is enough.
- Call validate_build before returning any design. Fix what it reports and call again.
- DESIGNING (when the user asks for a specific build):
  - Each brick is one entry: { partNum, colorId, colorName, x, y, z, rot }. x and z are stud positions, y is the height in PLATES, rot is 0/90/180/270.
  - The part's w×d×h comes from the inventory row — do not send w, d or h.
  - Place bricks bottom-up: a brick's y is the sum of the plate-heights of everything under it (a brick is 3 plates, a plate or tile is 1).
  - Keep the whole build inside 48×48 studs and under 64 plates tall.
  - Stay inside the quantities you own — a part can be used at most as many times as its qty.
  - Then call save_build with a short name for the build (e.g. "Cozy Coffee Shop Lounge") and the same brick list.
  - If validate_build reports problems, fix exactly those bricks and call it again.
- Reply in the user's language, short and warm. No emoji.
- Aim for roughly 30-60 bricks per design while this pool is small.`;
}
