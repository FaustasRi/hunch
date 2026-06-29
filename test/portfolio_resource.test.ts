import { describe, it, expect } from 'vitest';
import { KalshiClient } from '../src/kalshi/client.js';
import { fetchPortfolio, renderPortfolio } from '../src/resources/portfolio.js';
import type { KalshiBalanceResponse, KalshiPositionsResponse } from '../src/kalshi/types.js';
import { loadFixture, routeTransport, testKey } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';

describe('portfolio resource', () => {
  it('composes balance + positions into one snapshot', async () => {
    const balance = loadFixture<KalshiBalanceResponse>('balance.json');
    const positions = loadFixture<KalshiPositionsResponse>('positions.json');
    const client = new KalshiClient({
      baseUrl: DEMO_BASE,
      apiKeyId: 'k',
      privateKeyPem: testKey(),
      transport: routeTransport([
        { match: '/portfolio/balance', json: balance },
        { match: '/portfolio/positions', json: positions },
      ]),
    });

    const { balance: bal, positions: pos } = await fetchPortfolio(client);
    const out = renderPortfolio(bal, pos, 'demo');
    expect(out).toContain('Portfolio (demo)');
    expect(out).toContain('Cash available: $1000.00');
    expect(out).toContain('2 open position(s)');
    expect(out).toContain('KXBTCD-25JAN0117-T103000  YES 10');
  });
});
