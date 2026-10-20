import { NextResponse } from "next/server";
import { fetchSetNormalized } from "@/rebrickable/fetchSetNormalized";
import { normalizeSetNum } from "@/parts/normalize";

export const runtime = "nodejs";

/**
 * The toolbar's path. Adding a set is a form submission, not a conversation —
 * this route shares the same Rebrickable client the get_set_parts MCP tool uses.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed-request" }, { status: 400 });
  }

  const raw = typeof (body as { setNum?: unknown })?.setNum === "string"
    ? ((body as { setNum: string }).setNum as string)
    : "";
  const setNum = normalizeSetNum(raw);
  if (!setNum) {
    return NextResponse.json(
      { error: "malformed-set-num", message: "Set numbers look like 21328 or 21328-1." },
      { status: 400 },
    );
  }

  try {
    const { set } = await fetchSetNormalized(setNum);

    if (set.buildableParts === 0) {
      // Per the spec's failure-mode table: refuse rather than add an empty shell.
      return NextResponse.json(
        {
          error: "nothing-buildable",
          message: `${set.name} loaded, but none of its ${set.totalParts} parts can be drawn.`,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ set });
  } catch (err) {
    const e = err as Error & { code?: string; status?: number };
    const status = e.status ?? 500;
    return NextResponse.json(
      { error: e.code ?? "network", message: e.message },
      { status },
    );
  }
}
