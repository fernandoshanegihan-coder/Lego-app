/**
 * Browser persistence — the only place the collection exists persistently.
 * `spec.md > Data Model`: no accounts, no database, nothing server-side.
 *
 * Versioned key so a future shape change can migrate instead of silently
 * mixing formats.
 */
import { COLLECTION_KEY, type StoredSet } from "@/lib/types";

/** Warn once if persistence is unavailable (private mode, quota exceeded). */
let warned = false;
function warnOnce(message: string) {
  if (!warned) {
    warned = true;
    console.warn(`[brickbrain] ${message}`);
  }
}

export function loadCollection(): StoredSet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COLLECTION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Light shape guard — a v0 or corrupt entry is dropped, never trusted.
    return parsed.filter(
      (s): s is StoredSet =>
        typeof s?.setNum === "string" &&
        typeof s?.name === "string" &&
        Array.isArray(s?.parts),
    );
  } catch {
    warnOnce("Could not read the saved collection; starting empty.");
    return [];
  }
}

export function saveCollection(sets: StoredSet[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLECTION_KEY, JSON.stringify(sets));
  } catch {
    warnOnce(
      "The collection could not be saved (storage unavailable or full). " +
        "The app still runs, but it won't survive a reload.",
    );
  }
}
