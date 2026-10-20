/**
 * Which Rebrickable part categories the renderer can draw.
 *
 * A part in an excluded category never enters the collection, so it can never
 * be claimed by Claude or rendered. This is what keeps the renderer's vocabulary
 * and the validator's vocabulary the same set.
 *
 * Names verified against the live `/part_categories/` list during the build
 * (Rebrickable calls the slope family "Bricks Sloped", not "Slopes").
 * Round, curved, and wedged families are excluded by design: the POC cannot
 * draw them honestly, so they must not be claimable.
 * Baseplates, Technic, minifigs, gear, and stickers are excluded as usual.
 */
import type { PartCategory } from "@/lib/types";

export const BUILDABLE_CATEGORY_NAMES: readonly string[] = [
  "bricks",
  "bricks sloped",
  "plates",
  "tiles",
  "tiles special",
];

export interface CategoryLookup {
  /** Whether the part is renderable at all. */
  buildable: boolean;
  category?: PartCategory;
}

export function makeCategoryResolver(categories: { id: number; name: string }[]) {
  const byId = new Map(categories.map((c) => [c.id, c.name.toLowerCase().trim()]));
  const allowed = new Set(BUILDABLE_CATEGORY_NAMES.map((n) => n.toLowerCase().trim()));

  const memo = new Map<number, CategoryLookup>();

  return (partCatId: number): CategoryLookup => {
    const hit = memo.get(partCatId);
    if (hit) return hit;

    const name = byId.get(partCatId);
    let result: CategoryLookup;
    if (!name) {
      result = { buildable: false };
    } else if (allowed.has(name)) {
      result = { buildable: true, category: inferCategory(name) };
    } else {
      result = { buildable: false };
    }
    memo.set(partCatId, result);
    return result;
  };
}

function inferCategory(name: string): PartCategory {
  if (name.includes("sloped")) return "slope";
  if (name.includes("tile")) return "tile";
  if (name.includes("plate")) return "plate";
  return "brick";
}
