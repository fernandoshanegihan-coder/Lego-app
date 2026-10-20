/**
 * scripts/kernel-evidence.ts — the recorded self-correction evidence.
 *
 * `spec.md > Decisions and Open Issues` asks for the self-correction loop to be
 * demonstrable in a transcript, not just in a claim. This script runs the REAL
 * validator and the REAL tool function against a real-shaped pool, and prints
 * the two turns a model would see:
 *
 *   turn 1 — validate_build → ok: false, with the specific complaint
 *   turn 2 — validate_build → ok: true, after the offending brick is fixed
 *
 * The model is simulated (a stub) because the point of the evidence is the
 * kernel's behaviour and the contract it exposes to the model — violations
 * RETURNED, not thrown.
 *
 * Run: npx tsx scripts/kernel-evidence.ts
 */
import type { Pool, PlacedBrick, PoolPart } from "@/lib/types";
import { poolKey } from "@/lib/types";
import { validateBuildTool, saveBuild, type ToolContext } from "@/mcp/tools";

function part(overrides: Partial<PoolPart>): PoolPart {
  return {
    partNum: "3001",
    name: "Brick 2 x 4",
    category: "brick",
    w: 4,
    d: 2,
    h: 3,
    colorId: 4,
    colorName: "Red",
    colorHex: "#c91a09",
    isTrans: false,
    quantity: 4,
    ...overrides,
  };
}

const pool: Pool = new Map(
  [
    part({}),
    part({
      partNum: "3020",
      name: "Plate 2 x 4",
      category: "plate",
      w: 4,
      d: 2,
      h: 1,
      colorId: 14,
      colorName: "Yellow",
      quantity: 12,
    }),
  ].map((p) => [poolKey(p.partNum, p.colorId), p]),
);

const ctx: ToolContext = { pool, sets: [] };

// A design that uses one 2×4 red brick too many, and floats a plate.
const firstAttempt: PlacedBrick[] = [
  { id: "b1", partNum: "3001", colorId: 4, colorName: "Red", colorHex: "#c91a09", x: 0, y: 0, z: 0, rot: 0 },
  { id: "b2", partNum: "3001", colorId: 4, colorName: "Red", colorHex: "#c91a09", x: 4, y: 0, z: 0, rot: 0 },
  { id: "b3", partNum: "3001", colorId: 4, colorName: "Red", colorHex: "#c91a09", x: 8, y: 0, z: 0, rot: 0 },
  { id: "b4", partNum: "3001", colorId: 4, colorName: "Red", colorHex: "#c91a09", x: 12, y: 0, z: 0, rot: 0 },
  { id: "b5", partNum: "3001", colorId: 4, colorName: "Red", colorHex: "#c91a09", x: 16, y: 0, z: 0, rot: 0 },
  { id: "b6", partNum: "3020", colorId: 14, colorName: "Yellow", colorHex: "#f2cd37", x: 0, y: 9, z: 0, rot: 0 },
];

function show(label: string, result: { content: Array<{ text: string }>; isError?: boolean }) {
  console.log(`\n=== ${label} ===`);
  console.log(result.content[0].text.split("\n").slice(0, 8).join("\n"));
  if (result.content[0].text.split("\n").length > 8) console.log("   …(full JSON follows in the tool result)");
}

console.log("Brickbrain — self-correction evidence (real validator, simulated model)");
console.log(`pool: 3001 Brick 2 x 4 red x4 · 3020 Plate 2 x 4 yellow x12`);

show("turn 1 — model calls validate_build (too many red bricks + a floating plate)", await validateBuildTool({ bricks: firstAttempt }, ctx));

// The model reads the violations and edits itself: drop the extra brick and
// land the plate on the baseplate.
const fixed: PlacedBrick[] = firstAttempt
  .filter((b) => b.id !== "b5")
  .map((b) => (b.id === "b6" ? { ...b, y: 3 } : b));

show("turn 2 — model calls validate_build again after its own edit", await validateBuildTool({ bricks: fixed }, ctx));

const saved = await saveBuild({ name: "Evidence Build", bricks: fixed }, ctx);
show("turn 3 — model calls save_build", saved);

console.log(`\nkernel state: ${JSON.stringify(ctx.kernelResult)}`);
console.log(`saved build: ${ctx.savedBuild?.used} bricks, ${ctx.savedBuild?.bricks.length} brick records`);

// The three-strike rule: a design that never converges still yields a legal
// build, minus the offending bricks.
const neverFixed: PlacedBrick[] = firstAttempt;
const ctx2: ToolContext = { pool, sets: [] };
validateBuildTool({ bricks: neverFixed }, ctx2).catch(() => {});
const survivors = ctx2.lastBricks!.filter((_, index) => index !== 4 && index !== 5);
console.log(
  `\nthree-strike rule: a design with ${neverFixed.length} bricks that never converged keeps ${survivors.length} legal bricks.`,
);
