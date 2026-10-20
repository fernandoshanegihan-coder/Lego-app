import { describe, expect, it } from "vitest";
import type { PlacedBrick, Pool, PoolPart } from "@/lib/types";
import { poolKey } from "@/lib/types";
import { applyDropRule } from "@/lib/loop";
import { validateBuild } from "@/validate/validateBuild";

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
