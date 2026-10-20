"use client";

/**
 * One clickable suggestion. `prd.md > Asking for ideas` — ideas are text only,
 * three rows, clicking one sends it back as a normal user message.
 */
export default function IdeaCard({
  index,
  title,
  description,
  onClick,
}: {
  index: number;
  title: string;
  description: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border px-3 py-2 text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2"
      style={{
        borderColor: "var(--edge)",
        background: "var(--bench)",
        cursor: onClick ? "pointer" : "default",
      }}
      aria-label={`Build idea: ${title}`}
    >
      <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
        <span className="font-mono-brick mr-1" style={{ color: "var(--accent)" }}>{index}.</span>
        {title}
      </p>
      <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: "var(--dim)" }}>
        {description}
      </p>
    </button>
  );
}
