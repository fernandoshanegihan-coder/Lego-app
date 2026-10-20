"use client";

/**
 * The dedicated set-number field. The app always knows this text is a set
 * number and never a message — PRD decision.
 *
 * States: idle → submitting → confirmed (name + both counts) or inline error.
 * Duplicate set numbers are rejected client-side before any request.
 */
import { useState } from "react";
import type { StoredSet } from "@/lib/types";
import { normalizeSetNum } from "@/lib/setNumClient";

type Phase = "idle" | "loading" | "error";

export default function SetField({
  existing,
  onAddSet,
}: {
  existing: StoredSet[];
  onAddSet: (set: StoredSet) => void;
}) {
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // Placeholder state: the last confirmed set, shown under the field.
  const [confirmed, setConfirmed] = useState<StoredSet | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === "loading") return;

    const setNum = normalizeSetNum(value);
    if (!setNum) {
      setPhase("error");
      setError("That isn't a set number — try 21328.");
      return;
    }

    const suffixless = setNum.split("-")[0];
    if (existing.some((s) => s.setNum.split("-")[0] === suffixless)) {
      setPhase("error");
      setError(`Set ${setNum} is already in your collection.`);
      return;
    }

    setPhase("loading");
    setError(null);
    try {
      const res = await fetch("/api/sets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setNum }),
      });
      const data = (await res.json()) as
        | { set: StoredSet }
        | { error: string; message?: string };

      if (!res.ok || !("set" in data)) {
        setPhase("error");
        setError(
          "message" in data && data.message
            ? data.message
            : "Rebrickable couldn't confirm that set number.",
        );
        return;
      }

      setConfirmed(data.set);
      onAddSet(data.set);
      setValue("");
      setPhase("idle");
    } catch {
      setPhase("error");
      setError("The network dropped while fetching that set.");
    }
  }

  const box = "flex w-72 items-center gap-2 rounded-lg border px-3";
  const style = {
    borderColor: error ? "var(--bad-line)" : "var(--edge)",
    background: "var(--bench)",
  };

  return (
    <div className="flex flex-col">
      <form onSubmit={submit} className={box} style={style} id="set-form">
        <label htmlFor="setnum" className="font-mono-brick text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: "var(--faint)" }}>
          Add a set
        </label>
        <input
          id="setnum"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={confirmed ? confirmed.name : "e.g. 21328"}
          disabled={phase === "loading"}
          autoComplete="off"
          spellCheck={false}
          className="font-mono-brick w-full bg-transparent py-2 text-sm font-semibold outline-none disabled:animate-pulse"
          style={{ color: "var(--ink)" }}
        />
      </form>
      {error && (
        <p id="set-error" className="font-mono-brick mt-1 max-w-72 text-xs" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      {confirmed && !error && (
        <p className="font-mono-brick mt-1 max-w-72 text-xs" style={{ color: "var(--dim)" }}>
          {confirmed.name} · {confirmed.totalParts.toLocaleString()} parts ·{" "}
          {confirmed.buildableParts.toLocaleString()} buildable
        </p>
      )}
    </div>
  );
}
