import { describe, expect, it } from "vitest";
import type { PlacedBrick, Pool, PoolPart } from "@/lib/types";
import { poolKey } from "@/lib/types";
import { applyDropRule, runLoop } from "@/lib/loop";
import { validateBuild } from "@/validate/validateBuild";
import { TOOLS, type ToolContext } from "@/mcp/tools";
import type { ChatEvent } from "@/lib/sse";
import type { ChatProvider, ProviderRequest } from "@/lib/provider";

/**
 * The three-strike rule is the backstop under the product's central claim:
 * even when the model never converges, what the user sees is still a build
 * made only of parts they own.
 */

function part(overrides: Partial<PoolPart>): PoolPart {
  return {
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
    quantity: 4,
    ...overrides,
  };
}

const pool: Pool = new Map(
  [
    part({}),
    part({
      partNum: "3020",
      name: "Plate 2 x 4",
      category: "plate",
      w: 4,
      d: 2,
      h: 1,
      colorId: 14,
      colorName: "Yellow",
      colorHex: "#f2cd37",
      quantity: 12,
    }),
  ].map((p) => [poolKey(p.partNum, p.colorId), p]),
);

function brick(overrides: Partial<PlacedBrick>): PlacedBrick {
  return {
    id: "b",
    partNum: "3001",
    colorId: 4,
    colorName: "Red",
    colorHex: "#c91a09",
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    ...overrides,
  };
}

describe("applyDropRule — the three-strike backstop", () => {
  it("keeps a legal design untouched", () => {
    const bricks = [
      brick({ id: "b1" }),
      brick({ id: "b2", x: 4 }),
      brick({ id: "b3", y: 3 }),
    ];
    const outcome = applyDropRule(bricks, pool);
    expect(outcome.dropped).toBe(0);
    expect(outcome.bricks).toHaveLength(3);
    expect(validateBuild(outcome.bricks, pool).ok).toBe(true);
  });

  it("drops the brick the user does not own enough of", () => {
    const bricks = [0, 1, 2, 3, 4].map((i) => brick({ id: `b${i}`, x: i * 4 }));
    const outcome = applyDropRule(bricks, pool);
    expect(outcome.dropped).toBe(1);
    expect(outcome.bricks).toHaveLength(4);
    expect(validateBuild(outcome.bricks, pool).ok).toBe(true);
  });

  it("drops a floating brick", () => {
    const bricks = [brick({ id: "b1" }), brick({ id: "b2", y: 9 })];
    const outcome = applyDropRule(bricks, pool);
    expect(outcome.dropped).toBe(1);
    expect(validateBuild(outcome.bricks, pool).ok).toBe(true);
  });

  it("cascades: dropping a support brick drops what it carried", () => {
    // b1 floats (nothing under it) and b2 sits on b1. The rule only requires
    // the cell beneath to be occupied, so b2 looks supported — but when b1 is
    // dropped, b2 orphans and must go too. Two passes, one guarantee.
    const bricks = [
      brick({ id: "b1", y: 9 }),
      brick({ id: "b2", y: 12 }),
      brick({ id: "b3", x: 4 }),
    ];
    const outcome = applyDropRule(bricks, pool);
    expect(validateBuild(outcome.bricks, pool).ok).toBe(true);
    expect(outcome.dropped).toBe(2);
    expect(outcome.bricks.map((b) => b.id)).toEqual(["b3"]);
  });

  it("returns nothing legal when everything is illegal", () => {
    const bricks = [brick({ id: "b1", y: 9 }), brick({ id: "b2", y: 12, x: 4 })];
    const outcome = applyDropRule(bricks, pool);
    expect(validateBuild(outcome.bricks, pool).ok).toBe(true);
    expect(outcome.bricks).toHaveLength(0);
  });
});

/**
 * The loop's contract: a failing tool call is RETURNED to the model, never
 * thrown. A thrown error would end the conversation; a returned one lets the
 * model fix itself.
 */

describe("runLoop — a failing tool call does not end the loop", () => {
  it("hands the error back to the model and carries on to a saved build", async () => {
    const ctx: ToolContext = { pool, sets: [] };
    const events: ChatEvent[] = [];
    const requests: ProviderRequest[] = [];

    const bricks = [brick({ id: "b1" }), brick({ id: "b2", x: 4 })];

    // Turn 1: call validate_build — the tool call FAILS (schema rejection).
    // Turn 2: the model calls validate_build again — this time it works.
    // Turn 3: the model calls save_build. Turn 4: it talks.
    let call = 0;
    const provider: ChatProvider = {
      id: "fake",
      label: "Fake",
      models: ["fake"],
      async *stream(request) {
        requests.push(request);
        const turn = call++;
        if (turn === 0 || turn === 1) {
          yield { kind: "toolCall", id: `c${turn}`, name: "validate_build", args: { bricks } };
        } else if (turn === 2) {
          yield {
            kind: "toolCall",
            id: "c2",
            name: "save_build",
            args: { name: "Test Build", bricks },
          };
        } else {
          yield { kind: "text", text: "All done." };
        }
      },
    };

    // The first tool call fails the way a schema rejection would.
    let failed = false;
    const mcpClient = {
      callTool: async ({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) => {
        if (name === "validate_build" && !failed) {
          failed = true;
          throw new Error("schema rejected: bricks must be an array");
        }
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) throw new Error(`unknown tool ${name}`);
        return tool.run(args, ctx);
      },
    };

    await runLoop({
      system: "test",
      providers: [provider],
      tools: [],
      mcpClient,
      ctx,
      messages: [{ role: "user", content: "build a tower" }],
      emit: (e) => events.push(e),
    });

    // The failure came back to the model as a tool result, not a crash.
    expect(JSON.stringify(requests[1]?.history ?? [])).toContain("schema rejected");

    // The loop continued: the retry validated, and the build was saved.
    const kernel = events.find((e) => e.type === "kernel");
    expect(kernel).toBeDefined();
    expect((kernel as { ok: boolean }).ok).toBe(true);

    const build = events.find((e) => e.type === "build");
    expect(build).toBeDefined();
    expect((build as { bricks: PlacedBrick[] }).bricks).toHaveLength(2);
  });
});
