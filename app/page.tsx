"use client";

/**
 * The one page. Canvas left, chat right, toolbar above, kernel strip below —
 * `prd.md > Screens and Layout`. No routes, no navigation, no movement.
 *
 * Slice 1: collection state is in-memory only; slice 2 persists it.
 */
import { useState } from "react";
import type { StoredSet } from "@/lib/types";
import Toolbar from "@/components/Toolbar";
import BuildCanvas from "@/components/BuildCanvas";
import KernelStrip from "@/components/KernelStrip";
import ChatPanel from "@/components/ChatPanel";

export default function Page() {
  const [sets, setSets] = useState<StoredSet[]>([]);

  const buildable = sets.reduce((s, set) => s + set.buildableParts, 0);

  return (
    <div className="flex h-screen flex-col">
      <Toolbar sets={sets} onAddSet={(s) => setSets((prev) => [...prev, s])} />

      <div className="min-h-0 flex flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <BuildCanvas working={false} />
          <KernelStrip available={buildable} />
        </div>
        <ChatPanel />
      </div>
    </div>
  );
}
