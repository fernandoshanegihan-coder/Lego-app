/**
 * lib/buildRules.ts — the brief a model needs to design a legal build.
 *
 * Shared by the in-app model (through the system prompt) and the MCP server
 * (through the `get_build_brief` tool), so Claude in claude.ai designs by
 * exactly the same rules as the model inside the app.
 */
import type { Pool } from "@/lib/types";

/** Rows shown from the inventory. A five-set pool can reach ~400 rows; the cap
 *  keeps the prompt bounded and says so when it trims. */
export const MAX_INVENTORY_ROWS = 200;

export function inventoryRows(pool: Pool, max = MAX_INVENTORY_ROWS): {
  rows: string[];
  trimmed: string;
  totalBuildable: number;
} {
  const entries = [...pool.values()].sort((a, b) => b.quantity - a.quantity);
  const totalBuildable = entries.reduce((sum, p) => sum + p.quantity, 0);
  const rows = entries.slice(0, max).map(
    (p) =>
      `${p.partNum} | ${p.name} | ${p.w}×${p.d}×${p.h} | ${p.colorName} (colour id ${p.colorId}) | ${p.quantity}`,
  );
  const trimmed =
    entries.length > max
      ? `\n(Showing the ${max} highest-quantity of ${entries.length} part/colour combos.)`
      : "";
  return { rows, trimmed, totalBuildable };
}

/** The rules of the grid. These are what make a design legal. */
export const DESIGN_RULES = `RULES
- Use only the parts, colours, and quantities above. Nothing else exists.
- Use the exact colour id shown in the inventory — the pair (partNum, colourId) is what identifies a brick you own.
- Coordinates: x and z are stud positions, y is the height in PLATES, rot is 0/90/180/270.
- x counts studs rightward, z counts studs away from the viewer. rot is 0/90/180/270 and swaps w/d at 90 and 270.
- Slopes occupy their full bounding box but support nothing — never rest a brick on one.
- DESIGNING (when the user asks for a specific build):
  - Each brick is one entry: { partNum, colorId, colorName, x, y, z, rot }. x and z are stud positions, y is the height in PLATES, rot is 0/90/180/270.
  - The part's w×d×h comes from the inventory row — do not send w, d or h.
  - Place bricks bottom-up: a brick's y is the sum of the plate-heights of everything under it (a brick is 3 plates, a plate or tile is 1).
  - Keep the whole build inside 48×48 studs and under 64 plates tall.
  - Stay inside the quantities you own — a part can be used at most as many times as its qty.
  - Then call save_build with a short name for the build (e.g. "Cozy Coffee Shop Lounge") and the same brick list.
  - If validate_build reports problems, fix exactly those bricks and call it again.`;
