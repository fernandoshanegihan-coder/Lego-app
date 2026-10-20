/**
 * The Rebrickable HTTP client. Two GET calls and a throttle.
 * Docs: https://rebrickable.com/api/v3/docs/
 */

const BASE = "https://rebrickable.com/api/v3/lego";

/** Error codes the route maps into user-facing messages. */
export type RebrickableError =
  | "no-such-set"
  | "bad-key"
  | "rate-limited"
  | "network"
  | "unconfigured";

export function rebrickableErrorFromStatus(status: number): RebrickableError {
  switch (status) {
    case 404:
      return "no-such-set";
    case 401:
    case 403:
      return "bad-key";
    default:
      return "network";
  }
}

/**
 * Global throttle: one request per ~1.1s. A set needs at most two calls
 * (the set itself, then its parts), so a simple shared queue is enough.
 */
let chain: Promise<unknown> = Promise.resolve();

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const gap = throttle.lastCall ? 1100 - (Date.now() - throttle.lastCall) : 0;
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    throttle.lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}
throttle.lastCall = 0;

async function getJson<T>(path: string): Promise<T> {
  const key = process.env.REBRICKABLE_API_KEY;
  if (!key) {
    const e = new Error("REBRICKABLE_API_KEY is not set") as Error & {
      code: RebrickableError;
      status: number;
    };
    e.code = "unconfigured";
    e.status = 500;
    throw e;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `key ${key}` },
      cache: "no-store",
    });
  } catch (cause) {
    const e = new Error(`Rebrickable unreachable: ${String(cause)}`) as Error & {
      code: RebrickableError;
      status: number;
    };
    e.code = "network";
    e.status = 502;
    throw e;
  }

  if (!res.ok) {
    if (res.status === 429) {
      // One retry after a pause, per the spec's failure-mode table.
      await new Promise((r) => setTimeout(r, 2000));
      res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `key ${key}` },
        cache: "no-store",
      });
      if (!res.ok) {
        const e = new Error(`Rebrickable ${res.status}`) as Error & {
          code: RebrickableError;
          status: number;
        };
        e.code = res.status === 429 ? "rate-limited" : rebrickableErrorFromStatus(res.status);
        e.status = res.status;
        throw e;
      }
    } else {
      const e = new Error(`Rebrickable ${res.status}`) as Error & {
        code: RebrickableError;
        status: number;
      };
      e.code = rebrickableErrorFromStatus(res.status);
      e.status = res.status;
      throw e;
    }
  }

  return (await res.json()) as T;
}

/** Throttled variant for the calls made in sequence. */
const getJsonThrottled = <T>(path: string) => throttle(() => getJson<T>(path));

// ---------------------------------------------------------------------------
// Shapes (only the fields we consume)
// ---------------------------------------------------------------------------

export interface RebrickableSet {
  set_num: string;
  name: string;
  year: number;
  num_parts: number;
}

export interface RebrickableColor {
  id: number;
  name: string;
  rgb: string; // "C91A09", or "003FF8"-style; "F4CD9C"-ish transparents carry their own rgb
  is_trans: boolean;
}

export interface RebrickablePart {
  part_num: string;
  name: string;
  part_cat_id: number;
}

export interface RebrickableInventoryItem {
  id: number;
  part: RebrickablePart;
  color: RebrickableColor | null; // gear / instructions have no colour
  quantity: number;
}

export async function getSet(setNum: string): Promise<RebrickableSet> {
  return getJsonThrottled<RebrickableSet>(`/sets/${setNum}/`);
}

export async function getSetParts(
  setNum: string,
): Promise<{ count: number; results: RebrickableInventoryItem[] }> {
  // One call for the whole set, per the throttling note in the spec.
  return getJsonThrottled(`/sets/${setNum}/parts/?page_size=1000`);
}

export interface PartCategory {
  id: number;
  name: string;
}

let categoriesCache: PartCategory[] | null = null;

/** Category id → name, fetched once per process and cached in memory. */
export async function listPartCategories(): Promise<PartCategory[]> {
  if (categoriesCache) return categoriesCache;
  const data = await getJson<{ results: PartCategory[] }>("/part_categories/");
  categoriesCache = data.results;
  return categoriesCache;
}
