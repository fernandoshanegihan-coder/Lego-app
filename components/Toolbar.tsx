"use client";

/**
 * The toolbar: brand, the dedicated set-number field, and the collection summary.
 * Serves `prd.md > Adding a set` and `prd.md > Screens and Layout`.
 */
import type { StoredSet } from "@/lib/types";
import SetField from "@/components/SetField";
import CollectionSummary from "@/components/CollectionSummary";

export default function Toolbar({
  sets,
  onAddSet,
}: {
  sets: StoredSet[];
  onAddSet: (set: StoredSet) => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4" style={{ borderColor: "var(--edge)", background: "var(--panel)" }}>
      <span className="text-lg font-bold tracking-tight">Brickbrain</span>
      <SetField existing={sets} onAddSet={onAddSet} />
      <CollectionSummary sets={sets} />
    </header>
  );
}
