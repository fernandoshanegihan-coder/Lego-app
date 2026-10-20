/**
 * Browser persistence — the only place the collection exists persistently.
 * `spec.md > Data Model`: no accounts, no database, nothing server-side.
 *
 * Versioned key so a future shape change can migrate instead of silently
 * mixing formats.
 */
import { COLLECTION_KEY, type StoredSet } from "@/lib/types";

/** Warn once per distinct problem if persistence is unavailable. */
const warned = new Set<string>();
const listeners = new Set<(message: string) => void>();

/**
 * The UI can show the "your collection won't survive a reload" notice —
 * `prd.md > States and Boundaries`: a one-line notice appears once.
 */
export function onStorageWarning(listener: (message: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[brickbrain] ${message}`);
  for (const listener of listeners) listener(message);
}

/**
 * The browser's storage, or null when there is none (server rendering, or a
 * browser that refuses to expose it). Reading `localStorage` can itself throw
 * in some private modes, so even the lookup is guarded.
 */
function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadCollection(): StoredSet[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(COLLECTION_KEY);
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
  const store = storage();
  if (!store) return;
  try {
    store.setItem(COLLECTION_KEY, JSON.stringify(sets));
  } catch {
    warnOnce(
      "The collection could not be saved (storage unavailable or full). " +
        "The app still runs, but it won't survive a reload.",
    );
  }
}
