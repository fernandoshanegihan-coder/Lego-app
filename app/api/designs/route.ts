import { NextResponse } from "next/server";
import { z } from "zod";
import { publishDesign, readDesign, readCollection } from "@/lib/localState";
import { aggregate } from "@/lib/collection";
import { validateBuild } from "@/validate/validateBuild";
import type { PlacedBrick } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Designs made by the local MCP server (Claude, in claude.ai or Claude Code).
 *
 *   POST /api/designs   the MCP server submits a design it designed
 *   GET  /api/designs   the browser polls for the newest one and renders it
 *
 * The design is validated HERE as well as in the MCP server: the kernel is
 * the one authority on what a legal build is, whichever client proposed it.
 */

const brickSchema = z.object({
  id: z.string().optional(),
  partNum: z.string().min(1),
  colorId: z.number().int(),
  colorName: z.string().min(1),
  colorHex: z.string().optional(),
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
  rot: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed-request" }, { status: 400 });
  }

  const parsed = z
    .object({ name: z.string().min(1).max(80), bricks: z.array(brickSchema).max(2000) })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "malformed-request" }, { status: 400 });
  }

  const pool = aggregate(readCollection());
  if (pool.size === 0) {
    return NextResponse.json(
      {
        error: "no-collection",
        message: "The app has no collection yet — open Brickbrain and add a set first.",
      },
      { status: 409 },
    );
  }

  // Fill in what the model may have left out, from the pool.
  const bricks: PlacedBrick[] = parsed.data.bricks.map((b, index) => {
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

  const result = validateBuild(bricks, pool);
  if (!result.ok) {
    return NextResponse.json(
      { error: "invalid-build", violations: result.violations },
      { status: 422 },
    );
  }

  const at = Date.now();
  publishDesign({ name: parsed.data.name, bricks, used: result.used, at });

  return NextResponse.json({ ok: true, used: result.used, at });
}

export async function GET() {
  return NextResponse.json({ design: readDesign() });
}
