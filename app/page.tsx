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
import { useEffect, useMemo, useState } from "react";
import type { PlacedBrick, StoredSet } from "@/lib/types";
import type { ChatEvent } from "@/lib/sse";
import { loadCollection, saveCollection, onStorageWarning } from "@/lib/storage";
import { addSet, aggregate } from "@/lib/collection";
import { sampleBuild } from "@/lib/sampleBuild";
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
  const [storageNotice, setStorageNotice] = useState<string | null>(null);

  // Storage can be unavailable (private mode, quota). The app still runs;
  // the user gets one honest line instead of silent data loss.
  useEffect(() => onStorageWarning((message) => setStorageNotice(message)), []);

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

  // The renderer resolves each brick's real size and colour from the pool —
  // the same source of truth the validator uses.
  const pool = useMemo(() => aggregate(sets), [sets]);

  // `?demo=1` renders a small legal build straight from the collection —
  // a deterministic first look, and a stable shot for the demo video.
  const demo = useMemo(
    () =>
      typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo"),
    [],
  );

  useEffect(() => {
    if (!demo || bricks.length > 0) return;
    const sample = sampleBuild(pool);
    if (sample.length > 0) {
      setBricks(sample);
      setBuildName("Sample build");
      setKernel({ status: "verified", used: sample.length, available: buildable });
    }
  }, [demo, pool, bricks.length, buildable]);

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

      {storageNotice && (
        <p
          className="border-b px-4 py-1.5 text-xs"
          style={{ borderColor: "var(--edge)", background: "var(--bad-bg)", color: "var(--bad)" }}
          role="status"
          id="storage-notice"
        >
          {storageNotice}
        </p>
      )}

      <div className="min-h-0 flex flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <BuildCanvas bricks={bricks} pool={pool} name={buildName} />
          <KernelStrip
            state={{ ...kernel, available: kernel.status === "idle" ? buildable : kernel.available }}
            available={buildable}
          />
        </div>
        <ChatPanel sets={sets} currentBuild={bricks} onEvent={handleEvent} />
      </div>
    </div>
  );
}
