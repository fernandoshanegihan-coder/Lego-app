/**
 * Rebrickable part data → the normalized collection shape.
 *
 * Two filters decide whether a part is buildable:
 *   1. its category must be one the renderer can draw (categories.ts), and
 *   2. its name must parse into exactly a two-number footprint.
 *
 * A part that fails either never enters the collection — so it can never be
 * claimed by Claude or rendered.
 */
import type {
  StoredPart,
  StoredSet,
} from "@/lib/types";
import { HEIGHTS } from "@/parts/shapes";
import { makeCategoryResolver, type CategoryLookup } from "@/parts/categories";
import type {
  RebrickableInventoryItem,
  RebrickableSet,
} from "@/rebrickable/client";

// ---------------------------------------------------------------------------
// Name parsing
// ---------------------------------------------------------------------------

/** e.g. "Brick 2 x 4" → [2, 4]; "Slope 45 2 x 2" → [2, 2]. */
const DIM_PAIR = /(\d+)\s*[x×]\s*(\d+)/;
/** "Brick 1 x 2 x 5"-style names declare an explicit height — nonstandard, excluded. */
const TRIPLE_DIM = /(\d+)\s*[x×]\s*(\d+)\s*[x×]\s*(\d+)/;

/**
 * Extract the w×d footprint in studs. Returns null for anything the renderer
 * cannot honestly draw at correct proportions.
 */
export function parseDimensions(name: string): { w: number; d: number } | null {
  if (TRIPLE_DIM.test(name)) return null;

  const m = DIM_PAIR.exec(name);
  if (!m) return null;

  // Keep only simple integer pairs within sane limits for a display model.
  const nums = [Number(m[1]), Number(m[2])];
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 12)) return null;

  return { w: Math.max(...nums), d: Math.min(...nums) };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------


/** Category names that we haven't seen yet yet arrive on buildable-looking parts. */
const reportedUnknownCategories = new Set<number>();

export interface NormalizeResult {
  set: StoredSet;
  /** Category ids seen on parts that were dropped, for the one-time build check. */
  excludedCategoryIds: number[];
}

export type CategoryResolver = (partCatId: number) => CategoryLookup;

export function normalizeSet(
  setMeta: RebrickableSet,
  items: RebrickableInventoryItem[],
  resolveCategory: CategoryResolver,
): NormalizeResult {
  const byCatId = new Map<number, CategoryLookup>();
  const lookup = (id: number) => {
    let v = byCatId.get(id);
    if (!v) {
      v = resolveCategory(id);
      byCatId.set(id, v);
    }
    return v;
  };

  const excludedCategoryIds: number[] = [];
  const merged = new Map<string, StoredPart>();

  for (const item of items) {
    if (!item.color) continue; // no colour → not a wall brick, excluded

    const cat = lookup(item.part.part_cat_id);
    if (!cat.buildable) {
      if (!excludedCategoryIds.includes(item.part.part_cat_id)) {
        excludedCategoryIds.push(item.part.part_cat_id);
      }
      if (!reportedUnknownCategories.has(item.part.part_cat_id)) {
        reportedUnknownCategories.add(item.part.part_cat_id);
        console.warn(
          `[brickbrain] excluded category id=${item.part.part_cat_id} (not in the buildable allowlist)`,
        );
      }
      continue;
    }

    const dims = parseDimensions(item.part.name);
    if (!dims) continue;

    const key = `${item.part.part_num}:${item.color.id}`;
    const prev = merged.get(key);
    if (prev) {
      prev.quantity += item.quantity;
    } else {
      merged.set(key, {
        partNum: item.part.part_num,
        name: item.part.name,
        category: cat.category!,
        w: dims.w,
        d: dims.d,
        h: HEIGHTS[cat.category!],
        colorId: item.color.id,
        colorName: item.color.name,
        colorHex: hexFromRgb(item.color.rgb, item.color.is_trans),
        isTrans: item.color.is_trans,
        quantity: item.quantity,
      });
    }
  }

  const parts = [...merged.values()].sort(
    (a, b) => b.quantity - a.quantity || a.partNum.localeCompare(b.partNum),
  );
  const buildableParts = parts.reduce((sum, p) => sum + p.quantity, 0);

  return {
    set: {
      setNum: setMeta.set_num,
      name: setMeta.name,
      year: setMeta.year,
      totalParts: setMeta.num_parts,
      buildableParts,
      parts,
      addedAt: Date.now(),
    },
    excludedCategoryIds,
  };
}

/** Rebrickable rgb is a bare hex triplet; ensure a leading `#`. */
function hexFromRgb(rgb: string, isTrans: boolean): string {
  const clean = rgb.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6).padEnd(6, "0");
  return `#${clean}`;
}

/** Normalized set number: accepts "21328" or "21328-1". */
export function normalizeSetNum(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  const m = /^([0-9]{4,7})(?:-([0-9]{1,3}))?$/.exec(trimmed);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : `${m[1]}-1`;
}
