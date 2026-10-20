/**
 * Every shared type in the system. The single source of truth for the data shapes
 * the browser stores, the server normalizes, and the validator checks.
 */

/** The part shapes the renderer can draw — and therefore the only parts Claude can claim. */
export type PartCategory = "brick" | "plate" | "tile" | "slope";

/** One part, in one colour, as it arrives in the user's collection. */
export interface StoredPart {
  /** Rebrickable part number, e.g. "3001" for Brick 2x4. */
  partNum: string;
  /** Rebrickable's own name, e.g. "Brick 2 x 4". */
  name: string;
  category: PartCategory;
  /** Footprint in studs. */
  w: number;
  /** Footprint in studs. */
  d: number;
  /** Height in PLATES — a brick is 3, a plate or tile is 1. */
  h: number;
  /** The wall colour the user actually owns. */
  colorId: number;
  colorName: string;
  colorHex: string;
  isTrans: boolean;
  quantity: number;
}

/** One set the user has told the app they own. */
export interface StoredSet {
  /** Rebrickable set number with the suffix, e.g. "21328-1". */
  setNum: string;
  name: string;
  year: number;
  /** What the box says — the number the user recognises. */
  totalParts: number;
  /** The subset the renderer can draw, summed by quantity. Shown in the kernel strip. */
  buildableParts: number;
  /** Buildable parts only. */
  parts: StoredPart[];
  addedAt: number;
}

/** The flattened pool across every set: quantities summed by (partNum, colorId). */
export interface PoolPart extends Omit<StoredPart, "quantity"> {
  quantity: number;
}

export type Pool = Map<string, PoolPart>;

export const poolKey = (partNum: string, colorId: number) => `${partNum}:${colorId}`;

/**
 * A placed brick. Coordinates are integers: x and z in studs, y in PLATES.
 * A brick occupies `w × d` studs and `h` plates, rotated by `rot` degrees.
 *
 * `w`/`d`/`h` are NOT on this type: the pool entry is the source of truth for
 * a part's size, so the model can only choose where and how to rotate.
 */
export interface PlacedBrick {
  id: string;
  partNum: string;
  colorId: number;
  colorName: string;
  colorHex: string;
  x: number;
  y: number;
  z: number;
  rot: 0 | 90 | 180 | 270;
}

/** A brick as the model sends it: ids and hex may be missing. */
export type ModelBrick = Omit<PlacedBrick, "id" | "colorHex"> & {
  id?: string;
  colorHex?: string;
};

export interface BuildResult {
  ok: boolean;
  used: number;
  available: number;
  violations: Violation[];
}

export type ViolationRule =
  | "unknown-part"
  | "unknown-colour"
  | "quantity"
  | "bounds"
  | "overlap"
  | "support";

export interface Violation {
  brickIndex: number;
  rule: ViolationRule;
  /** A sentence Claude can act on directly. */
  detail: string;
}

/** Versioned storage key — bump when the StoredSet shape changes. */
export const COLLECTION_KEY = "brickbrain.collection.v1";
