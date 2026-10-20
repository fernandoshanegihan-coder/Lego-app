/**
 * Collection operations. `spec.md > Components > CollectionStore`.
 *
 * The parts POOL is derived on every read rather than stored twice — aggregation
 * is what makes two sets of the same colour combine into a usable quantity.
 */
import type { Pool, StoredSet } from "@/lib/types";
import { poolKey } from "@/lib/types";

/** Sum quantities across every set, by (partNum, colorId). */
export function aggregate(sets: StoredSet[]): Pool {
  const pool: Pool = new Map();
  for (const set of sets) {
    for (const part of set.parts) {
      const key = poolKey(part.partNum, part.colorId);
      const prev = pool.get(key);
      if (prev) {
        prev.quantity += part.quantity;
      } else {
        pool.set(key, { ...part });
      }
    }
  }
  return pool;
}

/** Dedupe by set number's base (75192 and 75192-1 are the same set). */
export function addSet(sets: StoredSet[], next: StoredSet): StoredSet[] {
  if (sets.some((s) => s.setNum.split("-")[0] === next.setNum.split("-")[0])) {
    return sets;
  }
  return [...sets, next];
}

/** Total buildable parts across the collection — the kernel strip's denominator. */
export function buildableTotal(sets: StoredSet[]): number {
  return sets.reduce((sum, s) => sum + s.buildableParts, 0);
}

/** Total box parts across the collection — what the user recognises. */
export function boxPartsTotal(sets: StoredSet[]): number {
  return sets.reduce((sum, s) => sum + s.totalParts, 0);
}
