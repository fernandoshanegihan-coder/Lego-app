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
    // A sentence the user can act on, not a status code.
    const message = friendlySetError(e.code, e.message);
    return NextResponse.json({ error: e.code ?? "network", message }, { status });
  }
}

/** `spec.md > Important Failure Modes` — every Rebrickable failure, in words. */
function friendlySetError(code: string | undefined, fallback: string): string {
  switch (code) {
    case "no-such-set":
      return "No set with that number.";
    case "bad-key":
      return "Rebrickable rejected the API key — check REBRICKABLE_API_KEY in .env.local.";
    case "rate-limited":
      return "Rebrickable is rate-limiting us. Give it a second and try again.";
    case "network":
      return "Could not reach Rebrickable. Check your connection and try again.";
    case "unconfigured":
      return "REBRICKABLE_API_KEY is not set on this server.";
    default:
      return fallback;
  }
}
