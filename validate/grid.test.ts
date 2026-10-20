import { describe, expect, it } from "vitest";
import { GRID, cellsOf, footprint, inBounds } from "@/validate/grid";

describe("footprint — rotation swaps w and d", () => {
  const dims = { w: 4, d: 2 };
  it("keeps w/d at 0° and 180°", () => {
    expect(footprint({ rot: 0 }, dims)).toEqual({ w: 4, d: 2 });
    expect(footprint({ rot: 180 }, dims)).toEqual({ w: 4, d: 2 });
  });

  it("swaps w/d at 90° and 270°", () => {
    expect(footprint({ rot: 90 }, dims)).toEqual({ w: 2, d: 4 });
    expect(footprint({ rot: 270 }, dims)).toEqual({ w: 2, d: 4 });
  });
});

describe("inBounds — the 48×48×64 volume", () => {
  it("accepts a piece that ends exactly on the grid edge", () => {
    expect(inBounds({ x: 44, y: 61, z: 46, w: 4, d: 2, h: 3 })).toBe(true); // 44+4=48, 61+3=64
  });

  it("rejects pieces past an edge, below the ground, or above the ceiling", () => {
    expect(inBounds({ x: 45, y: 0, z: 0, w: 4, d: 2, h: 3 })).toBe(false); // 45+4>48
    expect(inBounds({ x: 0, y: 0, z: 47, w: 4, d: 2, h: 3 })).toBe(false); // 47+2>48
    expect(inBounds({ x: 0, y: -1, z: 0, w: 4, d: 2, h: 3 })).toBe(false);
    expect(inBounds({ x: 0, y: 62, z: 0, w: 4, d: 2, h: 3 })).toBe(false); // 62+3>64
  });
});

describe("cellsOf — plate-thick occupancy cells", () => {
  it("enumerates w×d cells for each of the h layers", () => {
    const cells = cellsOf({ x: 0, y: 0, z: 0, w: 2, d: 1, h: 3 });
    expect(cells).toHaveLength(6); // 2 × 1 × 3
    expect(cells).toContainEqual([1, 2, 0]); // top-far corner of a 2×1×3
    expect(cells).not.toContainEqual([2, 0, 0]); // x=2 is outside w=2
  });

  it("offsets from the piece's own position", () => {
    const cells = cellsOf({ x: 10, y: 3, z: 20, w: 1, d: 1, h: 1 });
    expect(cells).toEqual([[10, 3, 20]]);
  });
});

describe("GRID — the spec's numbers", () => {
  it("is 48×48 studs and 64 plates tall", () => {
    expect(GRID.studsX).toBe(48);
    expect(GRID.studsZ).toBe(48);
    expect(GRID.platesY).toBe(64);
  });
});
