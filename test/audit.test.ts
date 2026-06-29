import { describe, it, expect } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readAuditEntries,
  sumPlacedCostWithin24hCents,
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
