/**
 * The five tool functions. `spec.md > Components > mcp/tools.ts`.
 *
 * Transport-agnostic: no MCP imports here. Each takes `(args, ctx)` where ctx
 * carries THIS REQUEST's pool — the server holds no collection between
 * requests. Both hosts (in-process MCP server, stdio adapter) wrap these.
 *
 * Results are `{ content: [{type:"text", text}], isError? }` so a host can
 * return them unchanged. The loop also reads `ctx.ideas` / `ctx.kernelResult`
 * / `ctx.savedBuild` after a call turns into a UI event — structured output
 * for Claude, structured events for the browser, one call each.
 */
import { z } from "zod";
import type { Pool, StoredSet, PlacedBrick, ModelBrick } from "@/lib/types";
import { buildSchema } from "@/validate/buildSchema";
import { validateBuild } from "@/validate/validateBuild";
import { fetchSetNormalized } from "@/rebrickable/fetchSetNormalized";

export interface IdeaPair {
  title: string;
  description: string;
}

export interface KernelOutcome {
  ok: boolean;
  used: number;
  available: number;
  violations?: Array<{ brickIndex: number; rule: string; detail: string }>;
}

export interface ToolContext {
  /** This request's inventory, aggregated. */
  pool: Pool;
  /** The raw sets — get_set_parts uses them to answer "which sets do I have". */
  sets: StoredSet[];
  /** Outputs the loop turns into browser events. */
  ideas?: IdeaPair[];
  kernelResult?: KernelOutcome;
  savedBuild?: { name: string; bricks: PlacedBrick[]; used: number; available: number };
  /** The last brick list the model proposed — the three-strike rule needs it
   *  to drop the offending bricks when the model never converges. */
  lastBricks?: PlacedBrick[];
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  /** MCP result objects are open-ended; the host checks `content` only. */
  [key: string]: unknown;
}

/** Tool schemas as the Anthropic messages API wants them. */
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: { type: "object" } & Record<string, unknown>;
}

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const bad = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

// ---------------------------------------------------------------------------
// Input schemas — the shapes Claude must send. The double duty: these same
// objects are registered with the MCP server so `listTools()` returns them,
// so there is exactly one description of each tool in the codebase.
// ---------------------------------------------------------------------------

export const getSetPartsShape = { setNum: z.string().min(3) } as const;
export const listMyPartsShape = {} as const;
export const validateBuildShape = { bricks: buildSchema.shape.bricks } as const;
export const saveBuildShape = {
  name: z.string().min(1).max(80),
  bricks: buildSchema.shape.bricks,
} as const;
export const proposeIdeasShape = {
  ideas: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        description: z.string().min(1).max(300),
      }),
    )
    .length(3),
} as const;

// ---------------------------------------------------------------------------
// The five functions
// ---------------------------------------------------------------------------

export async function getSetParts(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
  const { setNum } = z.object(getSetPartsShape).parse(args);
  try {
    const { set } = await fetchSetNormalized(setNum);
    const rows = set.parts
      .slice(0, 40)
      .map((p) => `${p.partNum} | ${p.name} | ${p.w}×${p.d}×${p.h} | ${p.colorName} | ${p.quantity}`);
    return ok(
      `${set.name} (${set.setNum}) — ${set.buildableParts} buildable parts in ${set.parts.length} part/colour combos, totaling ${set.totalParts} parts per the box. Highest-quantity rows:\n${rows.join("\n")}`,
    );
  } catch (err) {
    return bad(`Could not fetch ${setNum}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function listMyParts(args: unknown, ctx: ToolContext): ToolResult {
  const rows = [...ctx.pool.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .map(
      (p) =>
        `${p.partNum} | ${p.name} | ${p.w}×${p.d}×${p.h} | ${p.colorName} (colour id ${p.colorId})${p.isTrans ? " trans" : ""} | ${p.quantity}`,
    );
  const available = rows.reduce((sum, r) => sum + Number(r.match(/\| (\d+)$/)?.[1] ?? 0), 0);
  return ok(
    ctx.sets.length === 0
      ? "The collection is empty — no sets added yet."
      : `${[...new Set(ctx.sets.map((s) => s.name))].join(", ")} — ${ctx.pool.size} part/colour combos, ${available} buildable parts:\n${rows.join("\n")}`,
  );
}

export function validateBuildTool(args: unknown, ctx: ToolContext): ToolResult {
  const parsed = z.object(validateBuildShape).parse(args);
  if (parsed.bricks.length === 0) {
    // An empty list is not a build. Say so plainly so the model tries again
    // rather than treating a vacuous pass as success.
    return bad(
      "The design is empty — that is not a build. Call validate_build again with the actual bricks (at least 10), using the part numbers and colour ids from the inventory.",
    );
  }
  const bricks = enrichBricks(parsed.bricks, ctx.pool);
  const result = validateBuild(bricks, ctx.pool);
  ctx.lastBricks = bricks;
  ctx.kernelResult = {
    ok: result.ok,
    used: result.used,
    available: result.available,
    violations: result.ok ? undefined : result.violations,
  };
  // Violations are RETURNED, not thrown — the model reads them and edits itself.
  const summary = result.ok
    ? `ok: true — all ${result.used} bricks are in the user's collection.`
    : `ok: false — ${result.violations.length} problem(s):\n${result.violations
        .map((v) => `- brick ${v.brickIndex}: ${v.detail}`)
        .join("\n")}`;
  return ok(`${summary}\n\n${JSON.stringify(result, null, 2)}`);
}

export function saveBuild(args: unknown, ctx: ToolContext): ToolResult {
  const parsed = z.object(saveBuildShape).parse(args);
  if (parsed.bricks.length === 0) {
    return bad("Nothing to save — the design has no bricks.");
  }
  const bricks = enrichBricks(parsed.bricks, ctx.pool);
  const result = validateBuild(bricks, ctx.pool);
  if (!result.ok) {
    return bad(
      `Refusing to save — the build is not legal:\n${result.violations.map((v) => `- brick ${v.brickIndex}: ${v.detail}`).join("\n")}`,
    );
  }
  ctx.savedBuild = { name: parsed.name, bricks, used: result.used, available: result.available };
  return ok(`Saved "${parsed.name}" — ${result.used} bricks, every one verified against the inventory.`);
}

/**
 * Fill in what the model may leave out: brick ids, and the real colour hex
 * (the pool knows it — the model shouldn't have to guess a colour code).
 */
function enrichBricks(bricks: ModelBrick[], pool: Pool): PlacedBrick[] {
  return bricks.map((b, index) => {
    const owned = pool.get(`${b.partNum}:${b.colorId}`);
    return {
      id: b.id ?? `b${index + 1}`,
      partNum: b.partNum,
      colorId: b.colorId,
      colorName: b.colorName,
      colorHex: owned?.colorHex ?? b.colorHex ?? "#c91a09",
      x: b.x,
      y: b.y,
      z: b.z,
      rot: b.rot,
    };
  });
}

export function proposeIdeas(args: unknown, ctx: ToolContext): ToolResult {
  const { ideas } = z.object(proposeIdeasShape).parse(args);
  ctx.ideas = ideas;
  return ok("Delivered. The three ideas are now clickable for the user.");
}

// ---------------------------------------------------------------------------
// Registration list — the one place tools are named with their descriptions.
// ---------------------------------------------------------------------------

export interface RegisteredTool {
  name: string;
  description: string;
  inputShape: Record<string, z.ZodType>;
  run: (args: unknown, ctx: ToolContext) => Promise<ToolResult> | ToolResult;
}

export const TOOLS: RegisteredTool[] = [
  {
    name: "list_my_parts",
    description:
      "Returns every part the user owns — one row per part/colour combo: part number, name, footprint w×d×h (w/d in studs, h in plates: brick=3, plate/tile=1), colour, quantity. Call this first, before proposing or designing anything.",
    inputShape: listMyPartsShape,
    run: listMyParts,
  },
  {
    name: "get_set_parts",
    description:
      "Fetches a LEGO set's buildable parts from Rebrickable by set number. Read-only preview — the user adds sets with the form above the chat, not through you.",
    inputShape: getSetPartsShape,
    run: getSetParts,
  },
  {
    name: "propose_ideas",
    description:
      "Proposes your three build ideas. Exactly three, each a short title and a 1–2 sentence description grounded in the parts actually owned. Call after list_my_parts when the user asks what they can build.",
    inputShape: proposeIdeasShape,
    run: proposeIdeas,
  },
  {
    name: "validate_build",
    description:
      "Checks a proposed brick list against the user's actual inventory: known parts, known colours, quantities, bounds, overlap, support. Violations come back as a list with brick indexes — fix every one and call again. ALWAYS pass the COMPLETE design (every brick of every section, not just the part you just added) — a section sent on its own looks like it is floating. ALWAYS call this before saving or showing a design.",
    inputShape: validateBuildShape,
    run: validateBuildTool,
  },
  {
    name: "save_build",
    description:
      "Submits a verified design to the canvas. It is validated again on save; an invalid build is refused with the reasons. Call this ONCE, with the COMPLETE design (floor + walls + top) — a partial build is saved as it is, and it will look unfinished. Only call once validate_build passes.",
    inputShape: saveBuildShape,
    run: saveBuild,
  },
];
