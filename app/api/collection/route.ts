import { NextResponse } from "next/server";
import { z } from "zod";
import { publishCollection, readCollection } from "@/lib/localState";
import { aggregate } from "@/lib/collection";

export const runtime = "nodejs";

/**
 * The collection, published by the browser so the local MCP server can design
 * against the user's ACTUAL parts — the kernel promise, from another client.
 *
 *   POST /api/collection   the browser publishes its collection
 *   GET  /api/collection   the MCP server reads it
 *
 * In memory only, on the user's own machine.
 */

const partSchema = z.object({
  partNum: z.string(),
  name: z.string(),
  category: z.enum(["brick", "plate", "tile", "slope"]),
  w: z.number().int().positive(),
  d: z.number().int().positive(),
  h: z.number().int().positive(),
  colorId: z.number().int(),
  colorName: z.string(),
  colorHex: z.string(),
  isTrans: z.boolean(),
  quantity: z.number().int().positive(),
});

const setSchema = z.object({
  setNum: z.string(),
  name: z.string(),
  year: z.number().int(),
  totalParts: z.number().int(),
  buildableParts: z.number().int(),
  parts: z.array(partSchema),
  addedAt: z.number(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed-request" }, { status: 400 });
  }

  const parsed = z.object({ sets: z.array(setSchema).max(20) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "malformed-request" }, { status: 400 });
  }

  publishCollection(parsed.data.sets);
  return NextResponse.json({ ok: true, sets: parsed.data.sets.length });
}

export async function GET() {
  const sets = readCollection();
  const pool = aggregate(sets);
  return NextResponse.json({
    sets: sets.map((s) => ({ setNum: s.setNum, name: s.name, buildableParts: s.buildableParts })),
    pool: [...pool.values()].map((p) => ({
      partNum: p.partNum,
      name: p.name,
      category: p.category,
      w: p.w,
      d: p.d,
      h: p.h,
      colorId: p.colorId,
      colorName: p.colorName,
      colorHex: p.colorHex,
      isTrans: p.isTrans,
      quantity: p.quantity,
    })),
  });
}
