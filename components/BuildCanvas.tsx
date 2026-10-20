"use client";

/**
 * The 3D canvas — placeholder this slice, so the page reads as the product from
 * slice one. The warm surface + faint stud grid is CSS here; real geometry
 * arrives in slice 6.
 */
export default function BuildCanvas({ working }: { working: boolean }) {
  return (
    <div
      className="relative flex-1 overflow-hidden"
      style={{
        background: `radial-gradient(circle at 50% 35%, rgba(255,255,255,0.5), transparent 60%), var(--canvas)`,
        backgroundImage: `radial-gradient(circle, rgba(42,38,32,0.05) 2.2px, transparent 2.6px)`,
        backgroundSize: "22px 22px",
      }}
      id="build-canvas"
    >
      <span
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm"
        style={{ color: "var(--faint)" }}
      >
        {working ? "" : "Your build will assemble here"}
      </span>
    </div>
  );
}
