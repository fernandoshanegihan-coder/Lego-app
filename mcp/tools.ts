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
import type { Pool, StoredSet, PlacedBrick, ModelBrick, PoolPart } from "@/lib/types";
import { poolKey } from "@/lib/types";
import { buildSchema } from "@/validate/buildSchema";
import { validateBuild } from "@/validate/validateBuild";
import { fetchSetNormalized } from "@/rebrickable/fetchSetNormalized";
import { inventoryRows, DESIGN_RULES } from "@/lib/buildRules";

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
  /**
   * The running Brickbrain app, when there is one. The MCP server uses it to
   * read the user's live collection and to push a finished design onto the
   * canvas — which is how a design made in claude.ai ends up in the app.
   */
  appUrl?: string;
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
export const getBuildBriefShape = {} as const;
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

export async function listMyParts(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  return listParts(ctx);
}

/**
 * The user's collection — read live from the running app when there is one,
 * so a design made in another client is checked against what the user has
 * *right now*.
 */
async function livePool(ctx: ToolContext): Promise<{
  pool: Pool;
  sets: StoredSet[];
  source: string;
}> {
  if (ctx.appUrl) {
    try {
      const res = await fetch(`${ctx.appUrl}/api/collection`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          pool: PoolPart[];
          sets: StoredSet[];
        };
        const pool: Pool = new Map(
          data.pool.map((p) => [poolKey(p.partNum, p.colorId), p]),
        );
        if (pool.size > 0) {
          return { pool, sets: data.sets ?? [], source: "the running Brickbrain app" };
        }
      }
    } catch {
      // The app isn't running (or isn't reachable) — fall back to the snapshot.
    }
  }
  return { pool: ctx.pool, sets: ctx.sets, source: "the saved collection" };
}

async function listParts(ctx: ToolContext): Promise<ToolResult> {
  const { pool, sets, source } = await livePool(ctx);
  const { rows } = inventoryRows(pool, 400);
  const available = [...pool.values()].reduce((sum, p) => sum + p.quantity, 0);

  if (pool.size === 0) {
    return ok(
      "The collection is empty — no sets added yet. Ask the user for a set number and use get_set_parts, or ask them to add one in the app.",
    );
  }

  return ok(
    `${sets.map((s) => s.name).join(", ") || "the user's sets"} — ${pool.size} part/colour combos, ${available} buildable parts (from ${source}):\n${rows.join("\n")}`,
  );
}

/**
 * The brief: the inventory AND the rules of the grid, so a model in any
 * client can design a legal build without being told them twice.
 */
export async function getBuildBrief(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { pool, sets, source } = await livePool(ctx);
  if (pool.size === 0) {
    return bad(
      "The user has no parts yet — ask them for a set number, then call get_set_parts, and design from that set's parts.",
    );
  }

  const { rows, trimmed, totalBuildable } = inventoryRows(pool);
  return ok(
    `BRIEF — the parts this user owns (from ${source})

SETS: ${sets.map((s) => `${s.name} (${s.setNum})`).join(", ")}
INVENTORY  (part | name | w×d×h | colour | qty)
${rows.join("\n")}${trimmed}

Total buildable parts: ${totalBuildable}.

${DESIGN_RULES}

Aim for roughly 30-60 bricks while this pool is small.`,
  );
}

export async function validateBuildTool(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = z.object(validateBuildShape).parse(args);
  if (parsed.bricks.length === 0) {
    // An empty list is not a build. Say so plainly so the model tries again
    // rather than treating a vacuous pass as success.
    return bad(
      "The design is empty — that is not a build. Call validate_build again with the actual bricks (at least 10), using the part numbers and colour ids from the inventory.",
    );
  }
  const { pool } = await livePool(ctx);
  const bricks = enrichBricks(parsed.bricks, pool);
  const result = validateBuild(bricks, pool);
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

export async function saveBuild(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = z.object(saveBuildShape).parse(args);
  if (parsed.bricks.length === 0) {
    return bad("Nothing to save — the design has no bricks.");
  }
  const { pool } = await livePool(ctx);
  const bricks = enrichBricks(parsed.bricks, pool);
  const result = validateBuild(bricks, pool);
  if (!result.ok) {
    return bad(
      `Refusing to save — the build is not legal:\n${result.violations.map((v) => `- brick ${v.brickIndex}: ${v.detail}`).join("\n")}`,
    );
  }
  ctx.savedBuild = { name: parsed.name, bricks, used: result.used, available: result.available };

  // Push it into the running app, so a design made in claude.ai (or Claude
  // Code) shows up on the canvas with the kernel strip green.
  if (ctx.appUrl) {
    try {
      const res = await fetch(`${ctx.appUrl}/api/designs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: parsed.name, bricks }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return ok(
          `Saved "${parsed.name}" — ${result.used} bricks, every one verified against the inventory, and sent to the running Brickbrain app: it is on the canvas now.`,
        );
      }
      const detail = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      return ok(
        `Saved "${parsed.name}" — ${result.used} bricks, verified against the inventory. The app did not accept it (${detail.message ?? detail.error ?? res.status}).`,
      );
    } catch {
      return ok(
        `Saved "${parsed.name}" — ${result.used} bricks, verified against the inventory. (The Brickbrain app is not reachable, so it was not pushed there.)`,
      );
    }
  }

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
    name: "get_build_brief",
    description:
      "Returns the brief for designing: the exact parts and colours the user owns, plus the coordinate rules (x/z in studs, y in plates, a brick is 3 plates, rot swaps w/d at 90/270, slopes support nothing, stay inside 48x48 studs and 64 plates). Call this before designing anything, then design, then validate_build, then save_build.",
    inputShape: getBuildBriefShape,
    run: getBuildBrief,
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
      "Checks a proposed brick list against the user's actual inventory: known parts, known colours, quantities, bounds, overlap, support. Violations come back as a list with brick indexes — fix every one and call again. ALWAYS call this before saving or showing a design.",
    inputShape: validateBuildShape,
    run: validateBuildTool,
  },
  {
    name: "save_build",
    description:
      "Submits a verified design to the canvas. It is validated again on save; an invalid build is refused with the reasons. Only call once validate_build passes.",
    inputShape: saveBuildShape,
    run: saveBuild,
  },
];
