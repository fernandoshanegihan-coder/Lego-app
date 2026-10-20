/**
 * lib/sampleBuild.ts — a small, legal build assembled from whatever the user
 * actually owns.
 *
 * Two uses: `?demo=1` renders it straight away (a deterministic first look for
 * anyone opening the app, and a stable shot for the demo video), and it is a
 * fixture that proves the renderer and the kernel agree — every brick here is
 * legal under the same seven rules the model has to satisfy.
 */
import type { PlacedBrick, Pool } from "@/lib/types";

/** A chosen part: the brick plus the footprint that positions it. */
interface Picked {
  brick: PlacedBrick;
  w: number;
  d: number;
  h: number;
  quantity: number;
}

/** The most common part of a category, if the user owns one. */
function pick(pool: Pool, category: "brick" | "plate" | "tile"): Picked | null {
  let best: Picked | null = null;

  for (const part of pool.values()) {
    if (part.category !== category) continue;
    if (best && part.quantity <= best.quantity) continue;

    best = {
      w: part.w,
      d: part.d,
      h: part.h,
      quantity: part.quantity,
      brick: {
        id: `${category}-0`,
        partNum: part.partNum,
        colorId: part.colorId,
        colorName: part.colorName,
        colorHex: part.colorHex,
        x: 0,
        y: 0,
        z: 0,
        rot: 0,
      },
    };
  }

  return best;
}

/**
 * A little hut: a tiled floor, two walls of bricks, a plate roof. Every
 * brick is one the user owns, and every one rests on something.
 */
export function sampleBuild(pool: Pool): PlacedBrick[] {
  const brick = pick(pool, "brick");
  const plate = pick(pool, "plate");
  const tile = pick(pool, "tile");
  if (!brick) return [];

  const out: PlacedBrick[] = [];
  const add = (base: Picked, id: string, x: number, y: number, z: number) =>
    out.push({ ...base.brick, id, x, y, z });

  // Floor: a 2×2 patch of tiles.
  if (tile) {
    const positions: Array<[number, number]> = [
      [0, 0],
      [tile.w, 0],
      [0, tile.d],
      [tile.w, tile.d],
    ];
    positions.forEach(([x, z], i) => add(tile, `tile-${i}`, x, 0, z));
  }

  // Four corner walls, two bricks high, standing on the floor.
  const floorY = tile ? 1 : 0;
  const corners: Array<[number, number]> = tile
    ? [
        [0, 0],
        [tile.w, 0],
        [0, tile.d],
        [tile.w, tile.d],
      ]
    : [
        [0, 0],
        [brick.w, 0],
      ];
  corners.forEach(([x, z], i) => {
    add(brick, `wall-${i}-1`, x, floorY, z);
    add(brick, `wall-${i}-2`, x, floorY + 3, z);
  });

  // A plate roof over each wall.
  if (plate) {
    corners.forEach(([x, z], i) => add(plate, `roof-${i}`, x, floorY + 6, z));
  }

  return out;
}
