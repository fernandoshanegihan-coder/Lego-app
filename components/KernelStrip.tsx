"use client";

/**
 * THE KERNEL STRIP — the visible guarantee.
 * Two states, `spec.md > Components > KernelStrip`:
 *   idle/verified — green dot + the promise + used / buildable in mono
 *   violation     — red bar + the specific complaint
 * Slice 5 wires the live states in; this slice shows the empty resting form.
 */
export default function KernelStrip({ available }: { available: number }) {
  const dot = (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: available > 0 ? "var(--ok)" : "var(--faint)" }}
    />
  );

  return (
    <footer
      className="flex h-9 shrink-0 items-center gap-2.5 border-t px-4"
      style={{ borderColor: "var(--edge)", background: "var(--panel)" }}
      id="kernel-strip"
    >
      {dot}
      <span className="text-xs" style={{ color: "var(--dim)" }}>
        {available > 0
          ? "every brick verified against your inventory"
          : "add a set to get started"}
      </span>
      <span
        className="font-mono-brick ml-auto text-xs font-bold"
        style={{ color: "var(--ink)" }}
        id="kernel-count"
      >
        0 / {available}
      </span>
    </footer>
  );
}
