import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCollection, saveCollection, onStorageWarning } from "@/lib/storage";
import { COLLECTION_KEY, type StoredSet } from "@/lib/types";

/**
 * The collection lives in the browser only. When the browser refuses — private
 * mode, quota — the app must still work and say so once.
 */

function set(n: number): StoredSet {
  return {
    setNum: `2132${n}-1`,
    name: "Test Set",
    year: 2021,
    totalParts: 100,
    buildableParts: 80,
    parts: [],
    addedAt: 1700000000000,
  };
}

const realLocalStorage = globalThis.localStorage;

beforeEach(() => {
  // A minimal in-memory localStorage.
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: realLocalStorage,
  });
});

describe("collection storage", () => {
  it("saves and reads the collection back", () => {
    saveCollection([set(1)]);
    expect(loadCollection()).toHaveLength(1);
    expect(localStorage.getItem(COLLECTION_KEY)).toContain("21321-1");
  });

  it("returns an empty collection when nothing is stored", () => {
    expect(loadCollection()).toEqual([]);
  });

  it("drops a corrupt payload instead of trusting it", () => {
    localStorage.setItem(COLLECTION_KEY, "{not json");
    expect(loadCollection()).toEqual([]);
  });

  it("drops a payload that is not an array", () => {
    localStorage.setItem(COLLECTION_KEY, '{"sets":[]}');
    expect(loadCollection()).toEqual([]);
  });

  it("keeps the app running when storage refuses to write, and says so once", () => {
    const messages: string[] = [];
    const unsubscribe = onStorageWarning((m) => messages.push(m));

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
        clear: () => {},
      },
    });

    expect(() => saveCollection([set(1)])).not.toThrow();
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("could not be saved");

    // The same problem twice still shows one line.
    saveCollection([set(2)]);
    expect(messages.length).toBe(1);

    unsubscribe();
  });
});
