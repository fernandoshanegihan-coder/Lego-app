/**
 * THE KERNEL. `prd.md > The inventory guarantee (the kernel)`,
 * `spec.md > Components > validateBuild`.
 *
 * Pure. No I/O, no Anthropic, no React. Rules in order:
 *   1 known part · 2 known colour · 3 quantity · 4 bounds ·
 *   5 no overlap · 6 supported · 7 grounded at y=0
 *
 * The contract that makes the whole product work:
 *
 *   violations are RETURNED, not thrown.
 *
 * A thrown error ends the agent loop; a returned violation continues it —
 * Claude reads it like any other tool result and edits its own design.
 */
import type {
  BuildResult,
  PlacedBrick,
  Pool,
  Violation,
} from "@/lib/types";
import { poolKey } from "@/lib/types";
import {
  GRID,
  Occupancy,
  cellsOf,
  footprint,
  inBounds,
  type Bounding,
} from "@/validate/grid";

export { GRID } from "@/validate/grid";

interface Placement {
  /** Index in the incoming array — what every violation reports. */
  index: number;
  colorName: string;
  name: string;
  isSlope: boolean;
  bounding: Bounding;
}

export function validateBuild(bricks: PlacedBrick[], pool: Pool): BuildResult {
  const violations: Violation[] = [];

  const partNumbers = new Set<string>();
  for (const part of pool.values()) partNumbers.add(part.partNum);

  // Pass 0: total demand per (partNum, colorId), so a quantity message can use
  // the design's real total rather than the count seen so far.
  const demand = new Map<string, number>();
  for (const brick of bricks) {
    const key = poolKey(brick.partNum, brick.colorId);
    demand.set(key, (demand.get(key) ?? 0) + 1);
  }

  // ---- Pass 1: identity, quantity, bounds --------------------------------
  const usage = new Map<string, number>();
  const quantityReported = new Set<string>();
  const candidates: Placement[] = [];

  for (let index = 0; index < bricks.length; index++) {
    const brick = bricks[index];

    const key = poolKey(brick.partNum, brick.colorId);
    const owned = pool.get(key);

    // Rule 1 + 2 — the pool key is (partNum, colorId), so a missing entry is
    // either a part the user doesn't own at all, or a colour they don't.
    if (!owned) {
      const rule: Violation["rule"] = partNumbers.has(brick.partNum)
        ? "unknown-colour"
        : "unknown-part";
      const detail =
        rule === "unknown-part"
          ? `part ${brick.partNum} is not in your collection at all`
          : `part ${brick.partNum} isn't available in ${brick.colorName} — use a colour you own`;
      violations.push({ brickIndex: index, rule, detail });
      continue;
    }

    // The pool entry is the source of truth for size — the model chooses only
    // position and rotation. A brick is its top surface: h plates tall,
    // w × d studs of footprint, possibly swapped by rotation.
    const { w, d } = footprint(brick, owned);
    const bounding: Bounding = { x: brick.x, y: brick.y, z: brick.z, w, d, h: owned.h };

    // Rule 4 — every cell must sit inside the buildable volume.
    if (
      !Number.isInteger(brick.x) ||
      !Number.isInteger(brick.y) ||
      !Number.isInteger(brick.z) ||
      !inBounds(bounding)
    ) {
      violations.push({
        brickIndex: index,
        rule: "bounds",
        detail: `position (${brick.x}, ${brick.y}, ${brick.z}) for a ${owned.w}×${owned.d} sits outside the build area — the grid is ${GRID.studsX}×${GRID.studsZ} studs, ${GRID.platesY} plates high`,
      });
      continue;
    }

    candidates.push({
      index,
      colorName: owned.colorName,
      name: owned.name,
      isSlope: owned.category === "slope",
      bounding,
    });

    // Rule 3 — quantity, reported once, on the brick that crosses the line.
    const used = (usage.get(key) ?? 0) + 1;
    usage.set(key, used);
    if (used > owned.quantity && !quantityReported.has(key)) {
      quantityReported.add(key);
      violations.push({
        brickIndex: index,
        rule: "quantity",
        detail: `${owned.colorName} ${owned.name} — design uses ${demand.get(key)}, you own ${owned.quantity}`,
      });
    }
  }

  // ---- Pass 2: overlap and support, in placement order --------------------
  const occupancy = new Occupancy();
  const stamped: Placement[] = [];
  const label = (p: Placement) => `${p.colorName} ${p.name} (${p.bounding.w}×${p.bounding.d})`;

  for (const candidate of candidates) {
    const cells = cellsOf(candidate.bounding);

    // Rule 5 — no two bricks share a plate-thick cell.
    if (!occupancy.place(cells, stamped.length)) {
      violations.push({
        brickIndex: candidate.index,
        rule: "overlap",
        detail: `${label(candidate)} collides with an already-placed brick`,
      });
      continue; // not stamped, so it cannot support anything either
    }
    stamped.push(candidate);

    // Rule 6 + 7 — y=0 is the baseplate; anything higher needs one occupied,
    // non-slope cell directly beneath its footprint.
    if (candidate.bounding.y > 0) {
      const providers = occupancy.providersBeneath(cells, candidate.bounding.y);
      const resting = providers
        .map((i) => stamped[i])
        .filter((p) => p !== undefined);
      const solid = resting.find((p) => !p.isSlope);
      if (!solid) {
        violations.push({
          brickIndex: candidate.index,
          rule: "support",
          detail: resting.length
            ? `${label(candidate)} rests on a slope — slopes can't support anything`
            : `${label(candidate)} has nothing underneath at y=${candidate.bounding.y}`,
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    used: stamped.length,
    available: poolTotal(pool),
    violations,
  };
}

export function poolTotal(pool: Pool): number {
  let total = 0;
  for (const p of pool.values()) total += p.quantity;
  return total;
}
