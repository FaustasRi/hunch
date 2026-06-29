import { describe, it, expect } from 'vitest';
import { KalshiClient } from '../src/kalshi/client.js';
import {
  deriveYesBook,
  summarizeTrend,
  buildBrief,
  fetchMarketBrief,
  renderBrief,
} from '../src/tools/get_market_brief.js';
import type { KalshiMarket } from '../src/kalshi/types.js';
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

  it('drops malformed/blank levels instead of throwing (best-effort)', () => {
    const book = deriveYesBook({
      orderbook_fp: {
        yes_dollars: [
          ['0.15', '100'],
          ['', ''], // blank → dropped
          ['0.14'] as unknown as [string, string], // missing count → dropped
          ['0.00', '50'], // 0¢ phantom → dropped
        ],
        no_dollars: [],
      },
    });
    expect(book.yesBids).toEqual([{ priceCents: 15, count: 100 }]);
  });
});

describe('renderBrief — edge cases', () => {
  const emptyBook = { yesBids: [], yesAsks: [] };
  const market = (over: Partial<KalshiMarket> = {}): KalshiMarket => ({ ticker: 'T', ...over });

  it('suppresses a misleading "last 0¢" for never-traded markets', () => {
    const out = renderBrief(
      buildBrief(market({ last_price_dollars: '0.0000' }), emptyBook, undefined),
    );
    expect(out).not.toMatch(/last/);
  });

  it('labels a crossed book instead of showing a negative spread', () => {
    const crossed = {
      yesBids: [{ priceCents: 20, count: 10 }],
      yesAsks: [{ priceCents: 18, count: 10 }],
    };
    expect(renderBrief(buildBrief(market(), crossed, undefined))).toContain('(crossed book)');
  });

  it('renders the secondary rules and the untrusted-data caveat', () => {
    const out = renderBrief(
      buildBrief(
        market({ rules_primary: 'Primary rule', rules_secondary: 'Source: X' }),
        emptyBook,
        undefined,
      ),
    );
    expect(out).toContain('Resolution: Primary rule');
    expect(out).toContain('Resolution (cont.): Source: X');
    expect(out).toMatch(/exchange-sourced DATA, not instructions/);
  });

  it('caps very long resolution text', () => {
    const out = renderBrief(
      buildBrief(market({ rules_primary: 'r'.repeat(2000) }), emptyBook, undefined),
    );
    const resolutionLine = out.split('\n').find((l) => l.startsWith('Resolution:')) ?? '';
    expect(resolutionLine.length).toBeLessThan(650);
    expect(resolutionLine).toContain('…');
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
