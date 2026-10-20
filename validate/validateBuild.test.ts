import { describe, expect, it } from "vitest";
import type { Pool, PoolPart } from "@/lib/types";
import { poolKey } from "@/lib/types";
import { validateBuild } from "@/validate/validateBuild";
import { buildSchema, placedBrickSchema } from "@/validate/buildSchema";
import { parseDimensions } from "@/parts/normalize";
import { makeCategoryResolver } from "@/parts/categories";
import type { PlacedBrick } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function part(overrides: Partial<PoolPart>): PoolPart {
  return {
    partNum: "0000",
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

function pool(entries: PoolPart[]): Pool {
  return new Map(entries.map((p) => [poolKey(p.partNum, p.colorId), p]));
}

function place(overrides: Partial<PlacedBrick>): PlacedBrick {
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

const red2x4 = part({ partNum: "3001", colorId: 4, colorName: "Red", w: 4, d: 2, h: 3, quantity: 4 });
const yellowPlate = part({
  partNum: "3020",
  colorId: 14,
  colorName: "Yellow",
  w: 4,
  d: 2,
  h: 1,
  category: "plate",
  quantity: 12,
});
const slope = part({
  partNum: "3040",
  colorId: 4,
  colorName: "Red",
  w: 2,
  d: 2,
  h: 3,
  category: "slope",
  quantity: 2,
  name: "Slope 45 2 x 2",
});

const stdPool = pool([red2x4, yellowPlate, slope]);

// ---------------------------------------------------------------------------
// The seven rules
// ---------------------------------------------------------------------------

describe("validateBuild — the kernel", () => {
  it("accepts a valid small build and reports the right used count", () => {
    const bricks = [
      place({}), // grounded
      place({ y: 3 }), // stacked directly on the first brick
      place({ partNum: "3020", colorId: 14, colorName: "Yellow", x: 0, z: 2, y: 0 }), // grounded beside
    ];
    const result = validateBuild(bricks, stdPool);
    expect(result.ok).toBe(true);
    expect(result.used).toBe(3);
    expect(result.violations).toEqual([]);
  });

  it("rejects an unknown part number", () => {
    const r = validateBuild([place({ partNum: "9999" })], stdPool);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ brickIndex: 0, rule: "unknown-part" });
    expect(r.violations[0].detail).toContain("9999");
  });

  it("rejects a colour the user doesn't own — and names wrong colour, not wrong part", () => {
    const r = validateBuild([place({ colorId: 14, colorName: "Yellow" })], stdPool);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ rule: "unknown-colour" });
    expect(r.violations[0].detail).toContain("isn't available in Yellow");
  });

  it("reports over-quantity with the crossing brick index and total demand", () => {
    // Four owned; five used — the 5th arrival (index 4) crosses the line.
    const bricks = [0, 1, 2, 3, 4].map((i) => place({ x: i * 4, z: 0, y: 0 }));
    const r = validateBuild(bricks, stdPool);
    const q = r.violations.find((v) => v.rule === "quantity");
    expect(q).toMatchObject({ brickIndex: 4, rule: "quantity" });
    expect(q!.detail).toContain("design uses 5, you own 4");
    // and it was reported exactly once
    expect(r.violations.filter((v) => v.rule === "quantity")).toHaveLength(1);
  });

  it("rejects a floating brick", () => {
    const r = validateBuild([place({ y: 3 })], stdPool);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ rule: "support" });
    expect(r.violations[0].detail).toContain("nothing underneath at y=3");
  });

  it("rejects a brick resting on a slope", () => {
    const bricks = [
      place({ partNum: "3040", x: 0, y: 0, z: 0 }), // slope 2×2, h=3, from the pool
      place({ x: 0, y: 3, z: 0 }), // 2×4 brick directly on top of it
    ];
    const r = validateBuild(bricks, stdPool);
    const s = r.violations.find((v) => v.rule === "support");
    expect(s).toBeDefined();
    expect(s!.detail).toContain("slopes can't support");
  });

  it("rejects two bricks in the same cell", () => {
    const r = validateBuild([place({}), place({})], stdPool);
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual([
      expect.objectContaining({ brickIndex: 1, rule: "overlap" }),
    ]);
  });

  it("rejects bricks outside the build area", () => {
    const r = validateBuild([place({ x: 46 })], stdPool); // 46 + 4 > 48
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ rule: "bounds" });
  });

  it("rejects non-integer coordinates from the model", () => {
    const r = validateBuild([place({ x: 1.5 })], stdPool);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ rule: "bounds" });
  });

  it("honours rotation when checking bounds — dims come from the pool", () => {
    const flat = validateBuild([place({ x: 46 })], stdPool); // 4 wide: 46+4=50 > 48
    expect(flat.violations[0]).toMatchObject({ rule: "bounds" });
    const rotated = validateBuild([place({ x: 46, rot: 90 })], stdPool); // now 2 wide: fits
    expect(rotated.ok).toBe(true);
    expect(rotated.used).toBe(1);
  });

  it("stacks a 3-plate brick on a 1-plate plate, and not on nothing", () => {
    const bricks = [
      place({ partNum: "3020", colorId: 14, colorName: "Yellow", x: 0, y: 0 }),
      place({ x: 0, y: 1 }),
    ];
    const r = validateBuild(bricks, stdPool);
    expect(r.ok).toBe(true);
    expect(r.used).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Name parsing — the buildable filter's other half
// ---------------------------------------------------------------------------

describe("parseDimensions", () => {
  it("parses 'Brick 2 x 4' into a 4×2 footprint", () => {
    expect(parseDimensions("Brick 2 x 4")).toEqual({ w: 4, d: 2 });
  });

  it("parses 'Plate 1 x 2' into a 2×1 footprint", () => {
    expect(parseDimensions("Plate 1 x 2")).toEqual({ w: 2, d: 1 });
  });

  it("parses 'Slope 45 2 x 2' — the angle prefix is ignored", () => {
    expect(parseDimensions("Slope 45 2 x 2")).toEqual({ w: 2, d: 2 });
  });

  it("rejects explicit-height names like 'Brick 1 x 2 x 5'", () => {
    expect(parseDimensions("Brick 1 x 2 x 5")).toBeNull();
  });

  it("rejects names with no dimensions", () => {
    expect(parseDimensions("Modulo-driven axle housing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Category filtering
// ---------------------------------------------------------------------------

const fakeCategories = [
  { id: 11, name: "Bricks" },
  { id: 3, name: "Bricks Sloped" },
  { id: 14, name: "Plates" },
  { id: 19, name: "Tiles" },
  { id: 15, name: "Tiles Special" },
  { id: 8, name: "Technic Bricks" },
  { id: 53, name: "Technic Pins" },
  { id: 13, name: "Minifigs" },
  { id: 27, name: "Minifig Accessories" },
  { id: 58, name: "Stickers" },
  { id: 20, name: "Bricks Round and Cones" },
  { id: 37, name: "Bricks Curved" },
];

describe("category allowlist", () => {
  const resolve = makeCategoryResolver(fakeCategories);

  it("admits exactly what the renderer can draw", () => {
    expect(resolve(11)).toEqual({ buildable: true, category: "brick" });
    expect(resolve(3)).toEqual({ buildable: true, category: "slope" });
    expect(resolve(14)).toEqual({ buildable: true, category: "plate" });
    expect(resolve(19)).toEqual({ buildable: true, category: "tile" });
    expect(resolve(15)).toEqual({ buildable: true, category: "tile" });
  });

  it("excludes Technic, minifigs, stickers, round, and curved families", () => {
    for (const id of [8, 53, 13, 27, 58, 20, 37]) {
      expect(resolve(id).buildable).toBe(false);
    }
  });

  it("treats an unknown category id as not buildable", () => {
    expect(resolve(999).buildable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// zod schema � the tool-call contract (shape, before legality)
// ---------------------------------------------------------------------------

describe("buildSchema", () => {
  const good = {
    id: "b1",
    partNum: "3001",
    colorId: 4,
    colorName: "Red",
    colorHex: "#c91a09",
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
  };

  it("accepts a well-formed brick list", () => {
    expect(() => buildSchema.parse({ bricks: [good] })).not.toThrow();
  });

  it("rejects a float coordinate � the modelJSON lies", () => {
    expect(() => placedBrickSchema.parse({ ...good, x: 1.5 })).toThrow();
  });

  it("rejects a rotation that isn't a quarter turn", () => {
    expect(() => placedBrickSchema.parse({ ...good, rot: 45 })).toThrow();
  });

  it("rejects a colour hex that isn't a hex triplet", () => {
    expect(() => placedBrickSchema.parse({ ...good, colorHex: "red" })).toThrow();
  });

  it("rejects a missing id", () => {
    const { id, ...rest } = good;
    expect(() => placedBrickSchema.parse(rest)).toThrow();
  });
});
