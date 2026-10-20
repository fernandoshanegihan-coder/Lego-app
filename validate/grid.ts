/**
 * The occupancy grid: integer arithmetic only. x and z in studs, y in PLATES.
 * A plate is 1, a brick is 3 — `spec.md > Components > validateBuild`.
 *
 * Why plates and not studs for y: support and overlap become exact comparisons
 * with no float tolerance and no "close enough".
 */
import type { PlacedBrick } from "@/lib/types";

export const GRID = {
  /** Buildable area in studs. */
  studsX: 48,
  studsZ: 48,
  /** Buildable height in plates — ~21 bricks. */
  platesY: 64,
} as const;

/**
 * Effective footprint at the brick's rotation. 90° and 270° swap w and d.
 * The dimensions come from the POOL entry (the source of truth), never from
 * the placed brick — the model can only choose where and how to rotate.
 */
export function footprint(part: Pick<PlacedBrick, "rot">, dims: { w: number; d: number }): {
  w: number;
  d: number;
} {
  return part.rot === 90 || part.rot === 270
    ? { w: dims.d, d: dims.w }
    : { w: dims.w, d: dims.d };
}

export interface Bounding {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/** Is every layer of the brick inside the buildable volume? */
export function inBounds(b: Bounding): boolean {
  return (
    b.x >= 0 &&
    b.z >= 0 &&
    b.y >= 0 &&
    b.x + b.w <= GRID.studsX &&
    b.z + b.d <= GRID.studsZ &&
    b.y + b.h <= GRID.platesY
  );
}

/** The plate-thick cells the brick occupies. */
export function cellsOf(b: Bounding): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let z = b.z; z < b.z + b.d; z++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        out.push([x, y, z]);
      }
    }
  }
  return out;
}

export class Occupancy {
  /** Flat array: x + z*GRID.studsX + y*GRID.studsX*GRID.studsZ; value = stamped index + 1, 0 = empty. */
  private grid: Int32Array;

  constructor(x = GRID.studsX, z = GRID.studsZ, y = GRID.platesY) {
    this.grid = new Int32Array(x * z * y);
  }

  private idx(x: number, y: number, z: number): number {
    return x + z * GRID.studsX + y * GRID.studsX * GRID.studsZ;
  }

  /** Stamp every cell if none are taken. Returns false on any overlap. */
  place(cells: Array<[number, number, number]>, placedIndex: number): boolean {
    for (const [x, y, z] of cells) {
      if (this.grid[this.idx(x, y, z)] !== 0) return false;
    }
    for (const [x, y, z] of cells) {
      this.grid[this.idx(x, y, z)] = placedIndex + 1;
    }
    return true;
  }

  /** Distinct placements that own a cell in the layer directly beneath `y`, restricted to `cells`' footprints. */
  providersBeneath(cells: Array<[number, number, number]>, y: number): number[] {
    const found = new Set<number>();
    const xs = new Set(cells.map(([x]) => x));
    const zs = new Set(cells.map(([, , z]) => z));
    for (const z of zs) {
      for (const x of xs) {
        const v = this.grid[this.idx(x, y - 1, z)];
        if (v !== 0) found.add(v - 1);
      }
    }
    return [...found];
  }
}
