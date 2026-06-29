import { describe, it, expect } from 'vitest';
import { KalshiClient } from '../src/kalshi/client.js';
import { tokenize, scoreEvent, searchMarkets, renderSearch } from '../src/tools/search_markets.js';
import type { KalshiEvent } from '../src/kalshi/types.js';
import { loadFixture, routeTransport } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const eventsPage = loadFixture('events_page.json');
const marketsEvent = loadFixture('markets_event.json');

function client(routes: Array<{ match: string; json: unknown }>): KalshiClient {
  return new KalshiClient({ baseUrl: DEMO_BASE, transport: routeTransport(routes) });
}

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumerics, drops <2 char tokens', () => {
    expect(tokenize('Fed Rate Cut!')).toEqual(['fed', 'rate', 'cut']);
    expect(tokenize('a BTC')).toEqual(['btc']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('scoreEvent', () => {
  const btc: KalshiEvent = {
    event_ticker: 'KXBTCD-1',
    series_ticker: 'KXBTCD',
    category: 'Crypto',
    title: 'Bitcoin price on Dec 8',
  };
  it('scores a title match higher than a meta-only match, with an all-tokens bonus', () => {
    expect(scoreEvent(btc, ['bitcoin'])).toBe(5); // 3 (title) + 2 (all tokens)
    expect(scoreEvent(btc, ['crypto'])).toBe(3); // 1 (category) + 2 (all tokens)
    expect(scoreEvent(btc, ['nope'])).toBe(0);
    expect(scoreEvent({ event_ticker: 'X' }, ['bitcoin'])).toBe(0);
  });
});

describe('searchMarkets — text mode (the live "bitcoin" false-negative, now fixed)', () => {
  it('finds bitcoin via event titles and returns the top events + their markets', async () => {
    const c = client([
      { match: '/events', json: eventsPage },
      { match: '/markets', json: marketsEvent },
    ]);
    const r = await searchMarkets(c, { query: 'bitcoin' });
    expect(r.mode).toBe('search');
    // three bitcoin events in the fixture; the two non-crypto ones excluded
    expect(r.events.map((e) => e.event_ticker)).toEqual(
      expect.arrayContaining(['KXBTCD-28DEC08', 'KXBTCD-28DEC09', 'KXBTC-RANGE']),
    );
    expect(r.events.some((e) => e.event_ticker === 'KXFED-26MAR')).toBe(false);
    // expanded into concrete markets from the top event(s)
    expect(r.markets.length).toBeGreaterThan(0);
    const out = renderSearch(r);
    expect(out).toContain('event(s) matching "bitcoin"');
    expect(out).toContain('KXBTCD-28DEC08-T100000');
    expect(out).toContain('event_ticker=KXBTCD-28DEC08');
  });

  it('returns a helpful empty state (never a dead end) when nothing matches', async () => {
    const c = client([{ match: '/events', json: eventsPage }]);
    const r = await searchMarkets(c, { query: 'zzzznomatchxyz' });
    expect(r.mode).toBe('empty');
    const out = renderSearch(r);
    expect(out).toContain('No open markets matched');
    expect(out).toContain('Categories:');
  });
});

describe('searchMarkets — other modes', () => {
  it('precise: event_ticker lists that event’s markets directly', async () => {
    const c = client([{ match: '/markets', json: marketsEvent }]);
    const r = await searchMarkets(c, { event_ticker: 'KXBTCD-28DEC08' });
    expect(r.mode).toBe('markets');
    expect(r.markets).toHaveLength(2);
    expect(renderSearch(r)).toContain('KXBTCD-28DEC08-T100000');
  });

  it('category: browses events in a category', async () => {
    const c = client([{ match: '/events', json: eventsPage }]);
    const r = await searchMarkets(c, { category: 'Crypto' });
    expect(r.mode).toBe('category');
    expect(r.events.length).toBeGreaterThan(0);
    expect(renderSearch(r)).toContain('Drill in: search_markets({ event_ticker');
  });

  it('landing: no args lists the categories and how to search (no API call)', async () => {
    const c = client([]); // any call would 404
    const r = await searchMarkets(c, {});
    expect(r.mode).toBe('landing');
    const out = renderSearch(r);
    expect(out).toContain('Discover Kalshi markets');
    expect(out).toContain('Crypto');
  });
});
