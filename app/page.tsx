"use client";

/**
 * The one page. Canvas left, chat right, toolbar above, kernel strip below —
 * `prd.md > Screens and Layout`. No routes, no navigation, no movement.
 *
 * Collection state lives here: loaded from localStorage on mount, written on
 * every change (`spec.md > Data Model`).
 *
 * The kernel strip's state is also here: it is the product's central claim,
 * so it is surfaced rather than hidden (`prd.md > Product Decisions`).
 */
import { useEffect, useState } from "react";
import type { PlacedBrick, StoredSet } from "@/lib/types";
import type { ChatEvent } from "@/lib/sse";
import { loadCollection, saveCollection } from "@/lib/storage";
import { addSet } from "@/lib/collection";
import Toolbar from "@/components/Toolbar";
import BuildCanvas from "@/components/BuildCanvas";
import KernelStrip, { type KernelState } from "@/components/KernelStrip";
import ChatPanel from "@/components/ChatPanel";

export default function Page() {
  const [sets, setSets] = useState<StoredSet[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [bricks, setBricks] = useState<PlacedBrick[]>([]);
  const [buildName, setBuildName] = useState<string>("");
  const [kernel, setKernel] = useState<KernelState>({
    status: "idle",
    used: 0,
    available: 0,
  });

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

  function handleEvent(event: ChatEvent): void {
    if (event.type === "kernel") {
      setKernel({
        status: event.ok ? "verified" : "violation",
        used: event.used,
        available: event.available,
        detail: event.violations?.[0]?.detail,
        problems: event.violations?.length,
        dropped: event.dropped,
      });
      return;
    }
    if (event.type === "build") {
      setBricks(event.bricks as PlacedBrick[]);
      setBuildName(event.name);
      return;
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <Toolbar sets={sets} onAddSet={(s) => setSets((prev) => addSet(prev, s))} />

      <div className="min-h-0 flex flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <BuildCanvas bricks={bricks} name={buildName} />
          <KernelStrip
            state={{ ...kernel, available: kernel.status === "idle" ? buildable : kernel.available }}
            available={buildable}
          />
        </div>
        <ChatPanel sets={sets} onEvent={handleEvent} />
      </div>
    </div>
  );
}
