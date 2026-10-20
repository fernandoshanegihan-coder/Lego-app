/**
 * The shape vocabulary — everything the renderer knows how to draw, and
 * therefore everything Claude may claim. `spec.md > Components > shapes`.
 *
 * This is the other half of the kernel's honesty contract: a category only
 * exists here if the canvas can draw it at true proportions. `categories.ts`
 * admits parts into the pool; `shapes.ts` says how they become geometry.
 *
 * Units: one stud pitch = 1.0 world unit; a plate is 3.2 mm tall against an
 * 8 mm stud pitch → 0.4 units. A brick (3 plates) is 1.2 units tall.
 */
import type { PartCategory } from "@/lib/types";

/** Height of each category in PLATES — the validator's integer unit. */
export const HEIGHTS: Record<PartCategory, number> = {
  brick: 3,
  plate: 1,
  tile: 1,
  slope: 3,
};

export const PLATE_HEIGHT_UNITS = 0.4;

/** World-units height for a part that is `plates` plate-thick. */
export function heightUnits(plates: number): number {
  return plates * PLATE_HEIGHT_UNITS;
}

export type ShapeKind = "box" | "slope";

/** Tiles draw as half-height boxes (they sit where plates sit, look thinner). */
export function shapeKind(category: PartCategory): ShapeKind {
  return category === "slope" ? "slope" : "box";
}
