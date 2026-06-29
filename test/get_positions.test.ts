import { describe, it, expect } from 'vitest';
import { KalshiClient } from '../src/kalshi/client.js';
import { normalizePositions, fetchPositions, renderPositions } from '../src/tools/get_positions.js';
import type { KalshiPositionsResponse } from '../src/kalshi/types.js';
import { loadFixture, routeTransport, testKey } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const positions = loadFixture<KalshiPositionsResponse>('positions.json');

describe('normalizePositions', () => {
  it('derives side from the sign of position_fp and drops zero positions', () => {
    const views = normalizePositions(positions);
    expect(views).toHaveLength(2); // the 0-contract row is filtered out
    expect(views[0]).toEqual({
      ticker: 'KXBTCD-25JAN0117-T103000',
      outcome: 'YES',
      contracts: 10,
      exposureUsd: '1.60',
      realizedPnlUsd: '0.00',
    });
    expect(views[1]).toMatchObject({
      ticker: 'KXFED-26MAR-CUT',
      outcome: 'NO',
      contracts: 5,
      realizedPnlUsd: '3.25',
    });
  });
});

describe('fetchPositions / renderPositions', () => {
  it('fetches (authenticated) and renders with exposure + P&L', async () => {
    const client = new KalshiClient({
      baseUrl: DEMO_BASE,
      apiKeyId: 'k',
      privateKeyPem: testKey(),
      transport: routeTransport([{ match: '/portfolio/positions', json: positions }]),
    });
    const out = renderPositions(await fetchPositions(client));
    expect(out).toContain('2 open position(s)');
    expect(out).toContain('KXBTCD-25JAN0117-T103000  YES 10 · exposure $1.60 · realized P&L $0.00');
    expect(out).toContain('KXFED-26MAR-CUT  NO 5');
  });

  it('renders an empty state', () => {
    expect(renderPositions([])).toBe('No open positions.');
  });

  it('places the sign correctly on negative realized P&L (-$3.25, not $-3.25)', () => {
    const out = renderPositions([
      { ticker: 'T', outcome: 'NO', contracts: 5, exposureUsd: '2.10', realizedPnlUsd: '-3.25' },
    ]);
    expect(out).toContain('exposure $2.10');
    expect(out).toContain('realized P&L -$3.25');
    expect(out).not.toContain('$-3.25');
  });
});
