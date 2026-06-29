/**
 * In-memory daily-spend ledger. The rolling-24h daily cap is sourced from the audit
 * log, but audit writes are best-effort (a disk/permission failure must never crash a
 * trade). That left a hole: if the log is unwritable, every placement reads 0 and the
 * daily cap silently disables. This ledger records each successful placement IN MEMORY
 * (write-failure-independent), and the daily total is the audit log UNION the ledger,
 * deduped by client_order_id — so the cap holds even when the log can't be written.
 *
 * Scope: one server process (like the place mutex + token store). Cross-process sharing
 * of one audit log is out of scope for v1 (documented in docs/HARDENING.md / ADR-0003).
 */
import type { KalshiEnv } from '../config.js';
import { readAuditEntries, sumPlacedCostWithin24hCents } from './audit.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LedgerEntry {
  tsMs: number;
  costCents: number;
  clientOrderId: string;
  env: KalshiEnv;
}

export class DailyLedger {
  private readonly entries: LedgerEntry[] = [];

  record(entry: LedgerEntry): void {
    this.entries.push(entry);
  }

  /** Placed cost (cents) in the last 24h for `env`, excluding ids already counted elsewhere. */
  extraCents(nowMs: number, env: KalshiEnv, alreadyCounted: Set<string>): number {
    const cutoff = nowMs - DAY_MS;
    let total = 0;
    for (const e of this.entries) {
      if (e.env !== env || e.tsMs < cutoff || alreadyCounted.has(e.clientOrderId)) continue;
      total += e.costCents;
    }
    return total;
  }
}

/**
 * Daily placed cost (cents) = durable audit log + in-memory placements the log is
 * missing (deduped by client_order_id). Robust to an unwritable audit log.
 */
export function dailyPlacedCents(
  auditPath: string,
  ledger: DailyLedger,
  nowMs: number,
  env: KalshiEnv,
): number {
  const entries = readAuditEntries(auditPath);
  const auditSum = sumPlacedCostWithin24hCents(entries, nowMs, env);
  const counted = new Set<string>();
  for (const e of entries) {
    if (e.event === 'place' && e.result === 'ok' && e.clientOrderId) counted.add(e.clientOrderId);
  }
  return auditSum + ledger.extraCents(nowMs, env, counted);
}
