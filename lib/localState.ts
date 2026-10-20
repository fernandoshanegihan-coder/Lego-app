/**
 * lib/localState.ts — the small amount of state the local app shares with the
 * MCP server.
 *
 * The collection lives in the browser; the MCP server is a separate process.
 * This module is the meeting point: the browser publishes its collection
 * here, the MCP server reads it, designs against it, and pushes the design
 * back — which the browser then renders.
 *
 * In memory only, on purpose: no accounts, no database, nothing that leaves
 * the machine (`prd.md > States and Boundaries`).
 */
import type { PlacedBrick, StoredSet } from "@/lib/types";

export interface SharedDesign {
  name: string;
  bricks: PlacedBrick[];
  used: number;
  /** When it arrived — the browser uses it to tell new designs from old ones. */
  at: number;
}

let collection: StoredSet[] = [];
let design: SharedDesign | null = null;

export function publishCollection(sets: StoredSet[]): void {
  collection = sets;
}

export function readCollection(): StoredSet[] {
  return collection;
}

export function publishDesign(next: SharedDesign): void {
  design = next;
}

export function readDesign(): SharedDesign | null {
  return design;
}
