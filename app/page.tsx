"use client";

/**
 * The one page. Canvas left, chat right, toolbar above, kernel strip below —
 * `prd.md > Screens and Layout`. No routes, no navigation, no movement.
 *
 * Collection state lives here: loaded from localStorage on mount, written on
 * every change (`spec.md > Data Model`).
 */
import { useEffect, useState } from "react";
import type { StoredSet } from "@/lib/types";
import { loadCollection, saveCollection } from "@/lib/storage";
import { addSet } from "@/lib/collection";
import Toolbar from "@/components/Toolbar";
import BuildCanvas from "@/components/BuildCanvas";
import KernelStrip from "@/components/KernelStrip";
import ChatPanel from "@/components/ChatPanel";

export default function Page() {
  const [sets, setSets] = useState<StoredSet[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSets(loadCollection());
    setHydrated(true);
  }, []);

  // Persist on every change, after hydration so the initial empty state
  // doesn't overwrite a saved collection with [].
  useEffect(() => {
    if (hydrated) saveCollection(sets);
  }, [sets, hydrated]);

  const buildable = sets.reduce((s, set) => s + set.buildableParts, 0);

  return (
    <div className="flex h-screen flex-col">
      <Toolbar sets={sets} onAddSet={(s) => setSets((prev) => addSet(prev, s))} />

      <div className="min-h-0 flex flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <BuildCanvas working={false} />
          <KernelStrip available={buildable} />
        </div>
        <ChatPanel sets={sets} />
      </div>
    </div>
  );
}
