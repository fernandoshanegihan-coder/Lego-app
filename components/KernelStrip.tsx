"use client";

/**
 * THE KERNEL STRIP — the visible guarantee.
 * `spec.md > Components > KernelStrip`.
 *
 * Two states:
 *   idle     — nothing built yet; the promise, dimmed
 *   verified — green dot, "every brick verified against your inventory", used / buildable
 *   violation— red bar, the specific complaint, and how many were found
 *
 * The second number is the BUILDABLE count — the parts the renderer can
 * actually draw — with a tooltip saying so. The first number is the bricks
 * in the current design.
 */
export interface KernelState {
  status: "idle" | "verified" | "violation";
  used: number;
  available: number;
  /** The complaint, when it failed. */
  detail?: string;
  /** How many problems were found. */
  problems?: number;
  /** How many bricks the three-strike rule removed. */
  dropped?: number;
}

export default function KernelStrip({
  state,
  available,
}: {
  state: KernelState;
  /** The collection's buildable total — the denominator before any design. */
  available: number;
}) {
  const total = state.status === "idle" ? available : state.available;
  const used = state.used;

  const violated = state.status === "violation";

  const dot = (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{
        background:
          state.status === "idle"
            ? available > 0
              ? "var(--faint)"
              : "var(--faint)"
            : violated
              ? "var(--bad)"
              : "var(--ok)",
      }}
    />
  );

  return (
    <footer
      className="flex h-9 shrink-0 items-center gap-2.5 border-t px-4"
      style={{
        borderColor: violated ? "var(--bad)" : "var(--edge)",
        background: violated ? "var(--bad-bg)" : "var(--panel)",
      }}
      id="kernel-strip"
    >
      {dot}
      <span className="truncate text-xs" style={{ color: violated ? "var(--bad)" : "var(--dim)" }}>
        {violated
          ? `${state.detail ?? "the design broke the rules"}${
              state.problems && state.problems > 1 ? ` (${state.problems} problems)` : ""
            }${state.dropped ? ` — ${state.dropped} bricks dropped` : ""}`
          : state.status === "verified"
            ? "every brick verified against your inventory"
            : available > 0
              ? "every brick will be verified against your inventory"
              : "add a set to get started"}
      </span>
      <span
        className="font-mono-brick ml-auto text-xs font-bold"
        style={{ color: violated ? "var(--bad)" : "var(--ink)" }}
        id="kernel-count"
        title={`${total.toLocaleString("en-US")} buildable parts in your collection — parts the renderer can draw`}
      >
        {used.toLocaleString("en-US")} / {total.toLocaleString("en-US")}
      </span>
    </footer>
  );
}
