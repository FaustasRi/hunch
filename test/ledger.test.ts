import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DailyLedger, dailyPlacedCents } from '../src/safety/ledger.js';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

describe('DailyLedger.extraCents', () => {
  it('sums in-window, env-matching, not-already-counted entries', () => {
    const l = new DailyLedger();
    l.record({ tsMs: NOW - HOUR, costCents: 100, clientOrderId: 'a', env: 'demo' });
    l.record({ tsMs: NOW - 30 * HOUR, costCents: 999, clientOrderId: 'old', env: 'demo' }); // too old
    l.record({ tsMs: NOW - HOUR, costCents: 50, clientOrderId: 'b', env: 'live' }); // wrong env
    l.record({ tsMs: NOW - HOUR, costCents: 200, clientOrderId: 'dup', env: 'demo' }); // already counted
    expect(l.extraCents(NOW, 'demo', new Set(['dup']))).toBe(100);
  });
});

describe('dailyPlacedCents = audit log UNION in-memory ledger (deduped by client_order_id)', () => {
  it('counts each placement once and survives a missing log via the ledger', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'hunch-ledger-')), 'audit.jsonl');
    const iso = new Date(NOW - HOUR).toISOString();
    // Audit log durably has placement "a" (1000c). Ledger has "a" (dup) + "b" (lost write, 500c).
    writeFileSync(
      path,
      `${JSON.stringify({ ts: iso, event: 'place', env: 'demo', result: 'ok', costBasisCents: 1000, clientOrderId: 'a' })}\n`,
    );
    const ledger = new DailyLedger();
    ledger.record({ tsMs: NOW - HOUR, costCents: 1000, clientOrderId: 'a', env: 'demo' }); // already in log
    ledger.record({ tsMs: NOW - HOUR, costCents: 500, clientOrderId: 'b', env: 'demo' }); // log missing it

    expect(dailyPlacedCents(path, ledger, NOW, 'demo')).toBe(1500); // 1000 (a, once) + 500 (b)
  });

  it('falls back to the ledger entirely when the log is unreadable', () => {
    const ledger = new DailyLedger();
    ledger.record({ tsMs: NOW - HOUR, costCents: 700, clientOrderId: 'x', env: 'demo' });
    expect(dailyPlacedCents('/no/such/hunch-ledger.jsonl', ledger, NOW, 'demo')).toBe(700);
  });
});
