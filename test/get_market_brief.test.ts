import { describe, it, expect } from 'vitest';
import { KalshiClient } from '../src/kalshi/client.js';
import {
  deriveYesBook,
  summarizeTrend,
  fetchMarketBrief,
  renderBrief,
} from '../src/tools/get_market_brief.js';
import type { KalshiOrderbookResponse, KalshiCandlesticksResponse } from '../src/kalshi/types.js';
import { loadFixture, routeTransport, type Route } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const TICKER = 'KXBTCD-25JAN0117-T103000';

const market = loadFixture('market.json');
const event = loadFixture('event.json');
const orderbook = loadFixture<KalshiOrderbookResponse>('orderbook.json');
const candles = loadFixture<KalshiCandlesticksResponse>('candlesticks.json');

// Order matters: specific paths before the general /markets/ detail route.
const fullRoutes: Route[] = [
  { match: '/candlesticks', json: candles },
  { match: '/orderbook', json: orderbook },
  { match: '/events/', json: event },
  { match: '/markets/', json: market },
];

describe('deriveYesBook (bids-only → two-sided)', () => {
  it('keeps YES bids and derives YES asks from inverted NO bids', () => {
    const book = deriveYesBook(orderbook);
    expect(book.yesBids[0]).toEqual({ priceCents: 15, count: 100 });
    expect(book.yesBids.map((l) => l.priceCents)).toEqual([15, 14, 13]); // desc
    // NO bids 83/82/81 → YES asks 17/18/19, ascending
    expect(book.yesAsks[0]).toEqual({ priceCents: 17, count: 120 });
    expect(book.yesAsks.map((l) => l.priceCents)).toEqual([17, 18, 19]);
  });
  it('handles an empty book', () => {
    expect(deriveYesBook({})).toEqual({ yesBids: [], yesAsks: [] });
  });
});

describe('summarizeTrend', () => {
  it('summarizes trade-price closes into first/last/change/range', () => {
    const t = summarizeTrend(candles.candlesticks ?? []);
    expect(t).toEqual({
      firstCents: 12,
      lastCents: 16,
      changeCents: 4,
      lowCents: 12,
      highCents: 16,
      points: 3,
    });
  });
  it('returns undefined when there are no priced candles', () => {
    expect(summarizeTrend([])).toBeUndefined();
    expect(summarizeTrend([{ price: { close_dollars: null } }])).toBeUndefined();
  });
});

describe('fetchMarketBrief', () => {
  it('aggregates market + orderbook + trend (series resolved via the event)', async () => {
    const client = new KalshiClient({ baseUrl: DEMO_BASE, transport: routeTransport(fullRoutes) });
    const brief = await fetchMarketBrief(client, TICKER, () => 1_735_200_000_000);
    expect(brief.ticker).toBe(TICKER);
    expect(brief.rulesPrimary).toMatch(/resolves YES/);
    expect(brief.lastCents).toBe(16);
    expect(brief.book.yesBids[0]?.priceCents).toBe(15);
    expect(brief.book.yesAsks[0]?.priceCents).toBe(17);
    expect(brief.trend?.changeCents).toBe(4);
  });

  it('still returns a brief when the trend is unavailable (best-effort)', async () => {
    const noTrend: Route[] = [
      { match: '/orderbook', json: orderbook },
      { match: '/events/', json: { error: { message: 'no event' } }, status: 404 },
      { match: '/markets/', json: market },
    ];
    const client = new KalshiClient({ baseUrl: DEMO_BASE, transport: routeTransport(noTrend) });
    const brief = await fetchMarketBrief(client, TICKER);
    expect(brief.trend).toBeUndefined();
    expect(brief.book.yesBids[0]?.priceCents).toBe(15);
  });
});

describe('renderBrief', () => {
  it('renders a dense, correct, two-sided brief with the probability note', async () => {
    const client = new KalshiClient({ baseUrl: DEMO_BASE, transport: routeTransport(fullRoutes) });
    const out = renderBrief(await fetchMarketBrief(client, TICKER, () => 1_735_200_000_000));
    expect(out).toContain('YES  bid 15¢ / ask 17¢ (spread 2¢) · last 16¢');
    expect(out).toContain('NO   bid 83¢ / ask 85¢');
    expect(out).toContain('Resolution:');
    expect(out).toContain('Trend (7d): 12¢ → 16¢ (+4¢), range 12–16¢ over 3 pts');
    expect(out).toContain('price = probability');
  });
});
