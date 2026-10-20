/**
 * lib/gemini.ts — the model provider, the key check, the system prompt.
 * Deviation from `spec.md` (recorded in devpost/checklist.md): the provider is
 * Google's Gemini API free tier instead of Anthropic — the learner's choice at
 * the slice-4 checkpoint. The agent loop, MCP tools, and validator are
 * provider-independent, so this file is the only thing that changed shape.
 *
 * Model constant — verified against THIS key with live calls (Oct 2026):
 * `gemini-3.8-flash` is listed but hangs with zero bytes, and `gemini-2.5-flash`
 * is gone for new users. `gemini-3.6-flash` answered in ~3.5s. Tested fallback:
 * `gemini-3.1-flash-lite` — same REST shape, one line.
 */
import type { Pool } from "@/lib/types";
import type { AnthropicTool } from "@/mcp/tools";

export const MODEL = "gemini-3.6-flash";

/** One design conversation stays well inside one turn's budget. */
export const MAX_TOKENS = 4096;

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

/** `POST …/{model}:streamGenerateContent?alt=sse` — returns the raw Response. */
export async function streamGenerateContent(model: string, body: unknown): Promise<Response> {
  // A hung provider must become an error line in the chat, never a spinner
  // forever: `spec.md > Important Failure Modes`.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${BASE}/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 429) {
      throw new Error(
        "Gemini's free-tier limit was hit. Wait a minute, then try again.",
      );
    }
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("The model took too long to respond. Try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

export function systemPrompt(pool: Pool): string {
  const entries = [...pool.values()].sort((a, b) => b.quantity - a.quantity);
  const totalBuildable = entries.reduce((sum, p) => sum + p.quantity, 0);

  const rows = entries.slice(0, MAX_INVENTORY_ROWS).map(
    (p) =>
      `${p.partNum} | ${p.name} | ${p.w}×${p.d}×${p.h} | ${p.colorName}${p.isTrans ? " (trans)" : ""} | ${p.quantity}`,
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
- Coordinates: x and z in studs, y in plates. A brick is 3 plates tall; a plate or tile is 1.
- x counts studs rightward, z counts studs away from the viewer. rot is 0/90/180/270 and swaps w/d at 90 and 270.
- Slopes occupy their full bounding box but support nothing — never rest a brick on one.
- Call list_my_parts before answering anything about what the user owns.
- When the user asks what they can build, call propose_ideas with EXACTLY three ideas grounded in this inventory — houses if there are house parts, cars if there are car parts. If the collection can't support something good, say so plainly and offer what IS possible.
- After propose_ideas, do NOT repeat the three ideas in your text — one short line asking which to build is enough.
- Call validate_build before returning any design. Fix what it reports and call again.
- Reply in the user's language, short and warm. No emoji.
- Aim for roughly 30-60 bricks per design while this pool is small.`;
}
