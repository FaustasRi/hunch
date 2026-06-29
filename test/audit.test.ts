import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readAuditEntries,
  sumPlacedCostWithin24hCents,
  appendAuditEntry,
  makeAuditEntry,
  type AuditEntry,
} from '../src/safety/audit.js';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

describe('sumPlacedCostWithin24hCents (rolling 24h)', () => {
  it('counts only placed+ok entries inside the 24h window', () => {
    const entries: AuditEntry[] = [
      { ts: iso(2 * HOUR), event: 'place', env: 'demo', result: 'ok', costBasisCents: 1000 }, // counts
      { ts: iso(23 * HOUR), event: 'place', env: 'demo', result: 'ok', costBasisCents: 500 }, // counts
      { ts: iso(30 * HOUR), event: 'place', env: 'demo', result: 'ok', costBasisCents: 9999 }, // too old
      { ts: iso(1 * HOUR), event: 'preview', env: 'demo', result: 'ok', costBasisCents: 7777 }, // not a placement
      { ts: iso(1 * HOUR), event: 'place', env: 'demo', result: 'rejected', costBasisCents: 8888 }, // rejected
    ];
    expect(sumPlacedCostWithin24hCents(entries, NOW)).toBe(1500);
  });

  it('is zero with no entries', () => {
    expect(sumPlacedCostWithin24hCents([], NOW)).toBe(0);
  });

  it('scopes to the given env so demo and live do not share a daily total', () => {
    const entries: AuditEntry[] = [
      { ts: iso(1 * HOUR), event: 'place', env: 'demo', result: 'ok', costBasisCents: 1000 },
      { ts: iso(1 * HOUR), event: 'place', env: 'live', result: 'ok', costBasisCents: 5000 },
    ];
    expect(sumPlacedCostWithin24hCents(entries, NOW, 'demo')).toBe(1000);
    expect(sumPlacedCostWithin24hCents(entries, NOW, 'live')).toBe(5000);
    expect(sumPlacedCostWithin24hCents(entries, NOW)).toBe(6000); // unscoped = both
  });
});

describe('makeAuditEntry / appendAuditEntry (write side)', () => {
  it('stamps an ISO ts from the injected clock and round-trips through the log', () => {
    const entry = makeAuditEntry(
      { event: 'place', env: 'demo', result: 'ok', costBasisCents: 160 },
      () => NOW,
    );
    expect(entry.ts).toBe(new Date(NOW).toISOString());

    // write into a NOT-yet-existing nested dir to exercise mkdirSync.
    const path = join(mkdtempSync(join(tmpdir(), 'hunch-audit-')), 'nested', 'deep', 'audit.jsonl');
    appendAuditEntry(path, entry);
    appendAuditEntry(
      path,
      makeAuditEntry({ event: 'cancel', env: 'demo', result: 'ok', orderId: 'O1' }, () => NOW),
    );
    const back = readAuditEntries(path);
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ event: 'place', result: 'ok', costBasisCents: 160 });
    expect(back[1]).toMatchObject({ event: 'cancel', orderId: 'O1' });
  });

  it('never throws on an unwritable path (audit failure must not break a trade)', () => {
    expect(() =>
      appendAuditEntry(
        '/proc/nonexistent/cannot/write.jsonl',
        makeAuditEntry({ event: 'place', env: 'demo' }, () => NOW),
      ),
    ).not.toThrow();
  });
});

describe('readAuditEntries', () => {
  it('returns [] for a missing file', () => {
    expect(readAuditEntries(join(tmpdir(), 'hunch-definitely-missing.jsonl'))).toEqual([]);
  });

  it('parses JSONL and skips malformed lines', () => {
    const path = join(tmpdir(), `hunch-audit-test-${NOW}.jsonl`);
    writeFileSync(
      path,
      '{"ts":"a","event":"place","env":"demo"}\n\nNOT JSON\n{"ts":"b","event":"cancel","env":"demo"}\n',
    );
    try {
      const entries = readAuditEntries(path);
      expect(entries).toHaveLength(2);
      expect(entries[0]?.event).toBe('place');
      expect(entries[1]?.event).toBe('cancel');
    } finally {
      rmSync(path, { force: true });
    }
  });
});
