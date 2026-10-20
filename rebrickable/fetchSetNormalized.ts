/**
 * One set, fetched and normalized. The single implementation both callers
 * share — `spec.md > Components > app/api/sets/route.ts` ("Adding a set is a
 * form submission... shares the implementation"):
 *
 *   - app/api/sets/route.ts   (the toolbar's form)
 *   - mcp/tools.ts get_set_parts  (Claude asking to see a set)
 *
 * The global Rebrickable throttle serializes the three underlying GETs.
 */
import { getSet, getSetParts, listPartCategories } from "@/rebrickable/client";
import { makeCategoryResolver } from "@/parts/categories";
import { normalizeSet } from "@/parts/normalize";
import type { StoredSet } from "@/lib/types";

export interface NormalizedFetch {
  set: StoredSet;
  /** Category ids seen on dropped parts — the build-time hazard check. */
  excludedCategoryIds: number[];
}

export async function fetchSetNormalized(setNum: string): Promise<NormalizedFetch> {
  const [setMeta, inventory, categories] = await Promise.all([
    getSet(setNum),
    getSetParts(setNum),
    listPartCategories(),
  ]);

  // Categories are cached in-process; the resolver reads from memory only.
  const resolver = makeCategoryResolver(categories);
  return normalizeSet(setMeta, inventory.results, resolver);
}
