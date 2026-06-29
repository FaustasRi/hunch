/**
 * Append-only JSONL audit log (ADR-0003): every proposed / placed / cancelled order.
 *
 * This module owns the log FORMAT and the READ side (needed now so the rolling-24h
 * daily cap can sum recent placements). M5 adds the append/write side and wires the
 * tools to record entries. Keeping the format + reader here lets caps.ts stay pure
 * (it takes the already-summed number) while preview_order sources it from the log.
 */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KalshiEnv } from '../config.js';
import type { OrderAction, OutcomeSide } from '../kalshi/types.js';

export type AuditEvent = 'preview' | 'place' | 'cancel' | 'cancel_all' | 'fill';
export type AuditResult = 'ok' | 'rejected' | 'error';

export interface AuditEntry {
  /** ISO-8601 timestamp. */
  ts: string;
  event: AuditEvent;
  env: KalshiEnv;
  result?: AuditResult | undefined;
  ticker?: string | undefined;
  action?: OrderAction | undefined;
  side?: OutcomeSide | undefined;
  priceCents?: number | undefined;
  count?: number | undefined;
  /** Max loss of the order, in cents — what the daily/exposure caps accumulate. */
  costBasisCents?: number | undefined;
  orderId?: string | undefined;
  clientOrderId?: string | undefined;
  rationale?: string | undefined;
  error?: string | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Build an entry, stamping `ts` with the current time. */
export function makeAuditEntry(
  fields: Omit<AuditEntry, 'ts'>,
  now: () => number = Date.now,
): AuditEntry {
  return { ts: new Date(now()).toISOString(), ...fields };
}

/**
 * Append one entry as a JSONL line (creates the file + parent dir if needed).
 * Best-effort: a write failure is warned to STDERR and swallowed — losing one audit
 * line to a disk error must never crash a trade or make a placed order report failure.
 */
export function appendAuditEntry(path: string, entry: AuditEntry): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.error(
      `[hunch] audit write failed (${path}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Read all entries from the log. Missing file → []; malformed lines are skipped. */
export function readAuditEntries(path: string): AuditEntry[] {
  if (!existsSync(path)) return [];
  const entries: AuditEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as AuditEntry);
    } catch {
      // Skip a corrupt line rather than fail the cap check.
    }
  }
  return entries;
}

/**
 * Sum the cost basis (cents) of successfully PLACED orders within the last 24h.
 * Previews and rejections do not count — only money actually committed. When `env`
 * is given, only that environment's placements count, so demo activity can't eat the
 * live daily cap (and vice-versa).
 */
export function sumPlacedCostWithin24hCents(
  entries: AuditEntry[],
  nowMs: number,
  env?: KalshiEnv,
): number {
  const cutoff = nowMs - DAY_MS;
  let total = 0;
  for (const e of entries) {
    if (e.event !== 'place' || e.result !== 'ok') continue;
    if (env !== undefined && e.env !== env) continue;
    if (typeof e.costBasisCents !== 'number') continue;
    const t = Date.parse(e.ts);
    if (Number.isFinite(t) && t >= cutoff) total += e.costBasisCents;
  }
  return total;
}
