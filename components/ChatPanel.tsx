"use client";

/**
 * The chat panel — right column. This slice renders the greeting and holds the
 * input; real streaming arrives in slice 4.
 */
export default function ChatPanel() {
  return (
    <aside
      className="flex h-full w-[360px] shrink-0 flex-col border-l"
      style={{ borderColor: "var(--edge)", background: "var(--panel)" }}
      id="chat-panel"
    >
      <div className="flex-1 space-y-3 overflow-y-auto p-4" id="chat-scroll">
        <p className="text-[15px] leading-relaxed" style={{ color: "var(--ink)" }}>
          <b>Enter a set number to get started.</b>
        </p>
        <p className="text-[15px] leading-relaxed" style={{ color: "var(--dim)" }}>
          Tell Brickbrain which sets you own, and it designs a build using only the
          bricks you actually have.
        </p>
      </div>
      <div className="border-t p-3" style={{ borderColor: "var(--edge)" }}>
        <input
          disabled
          placeholder="Ask what you can build…"
          className="font-mono-brick w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-60"
          style={{ borderColor: "var(--edge)", background: "var(--bench)", color: "var(--dim)" }}
        />
      </div>
    </aside>
  );
}
