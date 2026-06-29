import { describe, it, expect } from 'vitest';
import { KalshiClient } from '../src/kalshi/client.js';
import { filterMarketsByText, searchMarkets, renderSearch } from '../src/tools/search_markets.js';
import type { KalshiMarket, KalshiMarketsResponse } from '../src/kalshi/types.js';
import { loadFixture, routeTransport } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const list = loadFixture<KalshiMarketsResponse>('markets_list.json');

function clientWithList(): KalshiClient {
  return new KalshiClient({
    baseUrl: DEMO_BASE,
    transport: routeTransport([{ match: '/markets', json: list }]),
  });
}

describe('filterMarketsByText', () => {
  const markets = list.markets;
  it('matches on subtitle, ticker, or event (case-insensitive)', () => {
    expect(filterMarketsByText(markets, 'fed').map((m) => m.ticker)).toEqual(['KXFED-26MAR-CUT']);
    expect(filterMarketsByText(markets, 'bitcoin').map((m) => m.ticker)).toEqual([
      'KXBTCD-25JAN0117-T103000',
    ]);
    expect(filterMarketsByText(markets, 'KXBTCD')).toHaveLength(1);
  });
  it('returns nothing when nothing matches', () => {
    expect(filterMarketsByText(markets, 'zzz')).toHaveLength(0);
  });
});

describe('searchMarkets', () => {
  it('fetches the page and returns markets + cursor', async () => {
    const res = await searchMarkets(clientWithList(), { status: 'open' });
    expect(res.markets).toHaveLength(2);
    expect(res.cursor).toBe('NEXTPAGE');
  });
  it('applies the optional text filter to the page', async () => {
    const res = await searchMarkets(clientWithList(), { query: 'fed' });
    expect(res.markets.map((m: KalshiMarket) => m.ticker)).toEqual(['KXFED-26MAR-CUT']);
  });
});

describe('renderSearch', () => {
  it('renders compact lines with cent prices and a pagination hint', () => {
    const out = renderSearch(list.markets, 'NEXTPAGE');
    expect(out).toContain('KXBTCD-25JAN0117-T103000');
    expect(out).toContain('YES bid 15¢ / ask 17¢');
    expect(out).toContain('Bitcoin above $103,000');
    expect(out).toContain('cursor="NEXTPAGE"');
  });
  it('handles an empty result', () => {
    expect(renderSearch([], undefined)).toBe('No markets matched.');
  });
});
