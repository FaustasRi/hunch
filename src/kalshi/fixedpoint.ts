/**
 * Fixed-point conversions for the Kalshi V2 surface.
 *
 * V2 quotes money as fixed-point **dollar strings** ("0.1600", up to 6 dp) and
 * counts/volumes as **_fp strings** ("10.00"). Mixing these with raw numbers is a
 * silent precision-bug factory (CONTEXT gotcha #5), so all parsing/formatting goes
 * through here. Prices are probabilities in whole cents (1–99); we keep price math
 * in integer cents and only stringify at the edges.
 */

/** Parse a fixed-point dollar string ("0.16", "0.5600", "1.00") to dollars as a number. */
export function parseDollarString(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid fixed-point dollar string: ${JSON.stringify(s)}`);
  }
  return n;
}

/**
 * Integer cents → a 2-decimal dollar string. 16 → "0.16", 250 → "2.50".
 * This is also the exact form the V2 order `price` field wants for a cent price.
 */
export function centsToUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Fixed-point dollar string → integer cents (rounded). "0.16" → 16, "0.1600" → 16. */
export function dollarStringToCents(s: string): number {
  return Math.round(parseDollarString(s) * 100);
}

/** Parse an `_fp` contract/volume string to a number. "10.00" → 10, "1234" → 1234. */
export function parseFp(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid fixed-point count string: ${JSON.stringify(s)}`);
  }
  return n;
}

/** Format a contract count for a V2 order `count` string. 10 → "10", 10.5 → "10.50". */
export function formatCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
