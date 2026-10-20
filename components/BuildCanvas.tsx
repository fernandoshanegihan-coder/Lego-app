"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type { PlacedBrick, Pool } from "@/lib/types";
import Scene from "@/scene/Scene";

/**
 * The 3D canvas. `spec.md > Components > BuildCanvas`.
 *
 * Bricks arrive sorted by y and are revealed on a ~25ms interval, so the model
 * assembles itself bottom-up instead of appearing all at once.
 */
export default function BuildCanvas({
  bricks,
  pool,
  name,
  source = "chat",
}: {
  bricks: PlacedBrick[];
  pool: Pool;
  name: string;
  /** Where the design came from — the in-app chat, or the MCP server. */
  source?: "chat" | "mcp" | "demo";
}) {
  const [revealed, setRevealed] = useState(0);

  // A new build restarts the reveal; the same build stays put.
  const signature = useMemo(
    () => bricks.map((b) => `${b.partNum}:${b.colorId}:${b.x},${b.y},${b.z}`).join("|"),
    [bricks],
  );

  useEffect(() => {
    setRevealed(0);
    if (bricks.length === 0) return;
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= bricks.length) clearInterval(timer);
    }, 25);
    return () => clearInterval(timer);
  }, [signature, bricks.length]);

  return (
    <div
      className="relative flex-1 overflow-hidden"
      style={{ background: "var(--canvas)" }}
      id="build-canvas"
    >
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [16, 13, 16], fov: 38 }}>
        <Scene bricks={bricks} pool={pool} revealed={revealed} />
      </Canvas>

      {bricks.length > 0 && (
        <span
          className="pointer-events-none absolute left-4 top-3 text-xs"
          style={{ color: "var(--dim)" }}
          id="canvas-summary"
        >
          {name ? `${name} — ` : ""}
          {bricks.length.toLocaleString("en-US")} bricks
          {source === "mcp" && (
            <span className="ml-2 rounded px-1.5 py-0.5 align-middle" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}>
              via MCP
            </span>
          )}
        </span>
      )}
    </div>
  );
}
