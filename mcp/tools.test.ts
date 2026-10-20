import { describe, expect, it } from "vitest";
import type { Pool } from "@/lib/types";
import { poolKey } from "@/lib/types";
import { getBuildBrief, listMyParts, type ToolContext } from "@/mcp/tools";

/**
 * The tools a model in another client (Claude in claude.ai, or Claude Code)
 * uses. They must work with no app running — the collection is then the
 * snapshot the server was started with.
 */

function poolWith(): Pool {
  const pool: Pool = new Map();
  pool.set(poolKey("3001", 4), {
    partNum: "3001",
    name: "Brick 2 x 4",
    category: "brick",
    w: 4,
    d: 2,
    h: 3,
    colorId: 4,
    colorName: "Red",
    colorHex: "#c91a09",
    isTrans: false,
    quantity: 6,
  });
  return pool;
}

function ctx(): ToolContext {
  const pool = poolWith();
  return {
    pool,
    sets: [
      {
        setNum: "21328-1",
        name: "Seinfeld",
        year: 2021,
        totalParts: 1326,
        buildableParts: 6,
        parts: [],
        addedAt: 0,
      },
    ],
  };
}

function textOf(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text;
}

describe("get_build_brief", () => {
  it("gives the model the inventory AND the rules of the grid", async () => {
    const result = await getBuildBrief({}, ctx());
    const text = textOf(result);

    // The parts the user owns, with the colour id the model must send.
    expect(text).toContain("3001");
    expect(text).toContain("Brick 2 x 4");
    expect(text).toContain("colour id 4");

    // The rules — without these, a design cannot be legal.
    expect(text).toContain("y is the height in PLATES");
    expect(text).toContain("48×48 studs");
    expect(text.toLowerCase()).toContain("slopes occupy their full bounding box");
  });

  it("says so plainly when there is nothing to build with", async () => {
    const empty: ToolContext = { pool: new Map(), sets: [] };
    const result = await getBuildBrief({}, empty);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("no parts yet");
  });
});

describe("list_my_parts", () => {
  it("lists the pool with quantities", async () => {
    const result = await listMyParts({}, ctx());
    const text = textOf(result);
    expect(text).toContain("3001");
    expect(text).toContain("6 buildable parts");
  });
});
