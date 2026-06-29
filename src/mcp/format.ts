/**
 * Display formatting shared across tools. Deterministic (no ICU/locale dependency)
 * so rendered output is stable in tests and across machines.
 */
import { parseFp, parseDollarString } from '../kalshi/fixedpoint.js';

/** Group a non-negative integer with thousands separators: 12340 → "12,340". */
export function groupThousands(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Format an `_fp` count string ("12340.00") as a grouped integer ("12,340"). */
export function fmtCount(fp: string): string {
  return groupThousands(parseFp(fp));
}

/** Format integer cents as a probability price: 16 → "16¢". */
export function fmtCentsPrice(cents: number): string {
  return `${cents}¢`;
}

/** Format a fixed-point dollar string as a 2-decimal amount: "12.5000" → "12.50". */
export function fmtDollars(dollarString: string): string {
  return parseDollarString(dollarString).toFixed(2);
}

/** Prefix a 2-decimal amount string with a correctly-placed $: "1.60" → "$1.60", "-3.25" → "-$3.25". */
export function money(twoDecimalAmount: string): string {
  return twoDecimalAmount.startsWith('-')
    ? `-$${twoDecimalAmount.slice(1)}`
    : `$${twoDecimalAmount}`;
}
