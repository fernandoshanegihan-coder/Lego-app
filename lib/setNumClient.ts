/**
 * Client-side copy of the set-number normalizer. Kept tiny and duplicated
 * deliberately — `parts/normalize.ts` imports the Rebrickable client, which
 * must never reach the browser bundle.
 */
export function normalizeSetNum(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  const m = /^([0-9]{4,7})(?:-([0-9]{1,3}))?$/.exec(trimmed);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : `${m[1]}-1`;
}
