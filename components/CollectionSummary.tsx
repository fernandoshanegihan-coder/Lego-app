"use client";

/**
 * COLLECTION SUMMARY — "Your sets: 3 · 1,904 parts"
 * `prd.md > Screens and Layout`: the collection list is available in the toolbar.
 */
import type { StoredSet } from "@/lib/types";

export default function CollectionSummary({ sets }: { sets: StoredSet[] }) {
  const totalParts = sets.reduce((s, set) => s + set.totalParts, 0);
  const buildable = sets.reduce((s, set) => s + set.buildableParts, 0);

  return (
    <div className="ml-auto flex items-center gap-3 text-right" id="collection-summary">
      <span className="font-mono-brick text-xs" style={{ color: "var(--dim)" }}>
        Your sets:{" "}
        <b className="text-sm" style={{ color: "var(--ink)" }}>
          {sets.length}
        </b>{" "}
        · {totalParts.toLocaleString()} parts
      </span>
      {sets.length > 0 && (
        <span
          className="font-mono-brick hidden text-[11px] md:inline"
          style={{ color: "var(--faint)" }}
          title="Only bricks, plates, tiles, and slopes can be drawn — the rest is excluded."
        >
          {buildable.toLocaleString()} buildable
        </span>
      )}
    </div>
  );
}
