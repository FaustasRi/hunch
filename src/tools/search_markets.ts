/**
 * search_markets — discovery. Read-only; no key needed.
 *
 * Why this is non-trivial: markets carry NO title/category/series and there are 10,000+
 * open markets, so a literal substring scan of one /markets page misses almost everything
 * (a query like "bitcoin" returned 0 while 58 bitcoin events existed). EVENTS carry the
 * human-readable title + category + series_ticker, so free-text search runs over events,
 * ranks them, and expands the best ones into concrete markets. Modes:
 *   - precise:  tickers / series_ticker / event_ticker → direct /markets (exact, fast)
 *   - text:     query → scan + rank events → markets of the top match(es) + drill-in list
 *   - category: browse open events in a category
 *   - landing:  no args → list categories + how to search
 *   - empty:    nothing matched → guidance, never a dead end
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import type { KalshiClient } from '../kalshi/client.js';
import type { KalshiMarket, KalshiMarketsResponse, KalshiEvent } from '../kalshi/types.js';
import { fetchEventsPage, KALSHI_CATEGORIES } from '../kalshi/discovery.js';
import { dollarStringToCents } from '../kalshi/fixedpoint.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';
import { fmtCount, fmtCentsPrice } from '../mcp/format.js';

const STATUS = ['unopened', 'open', 'paused', 'closed', 'settled'] as const;

// Bounded work per call (tune here). Text search scans event pages, early-stopping
// once it has enough candidates, then expands the very top events into markets.
const EVENT_PAGE_LIMIT = 200;
const EVENT_SCAN_PAGES = 12;
const MATCH_TARGET = 40; // early-stop once this many events match
const RESULT_EVENTS = 8; // top events surfaced for drill-in
const MARKET_EVENTS = 2; // top events expanded into concrete markets
const MARKETS_PER_EVENT = 50;

export interface MarketSearchParams {
  query?: string | undefined;
  category?: string | undefined;
  status?: (typeof STATUS)[number] | undefined;
  series_ticker?: string | undefined;
  event_ticker?: string | undefined;
  tickers?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface MarketHit {
  market: KalshiMarket;
  eventTitle: string | undefined;
}

export interface SearchResult {
  mode: 'markets' | 'search' | 'category' | 'landing' | 'empty';
  markets: MarketHit[];
  events: KalshiEvent[];
  cursor: string | undefined;
  query: string | undefined;
  category: string | undefined;
  /** The event scan hit its page budget before exhausting matches (results may be partial). */
  capped: boolean;
}

const inputShape = {
  query: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Free-text search. Matches event titles / series / category, so it finds markets even when the word is not in the ticker (e.g. "bitcoin", "fed rate cut").',
    ),
  category: z
    .string()
    .optional()
    .describe(`Browse one category (or narrow a query). Known: ${KALSHI_CATEGORIES.join(', ')}.`),
  status: z
    .enum(STATUS)
    .optional()
    .describe('Lifecycle filter; defaults to "open" for search/browse.'),
  series_ticker: z
    .string()
    .optional()
    .describe('Exact: list markets in one series (e.g. "KXBTC").'),
  event_ticker: z
    .string()
    .optional()
    .describe('Exact: list markets in one event (drill in from a result).'),
  tickers: z.string().optional().describe('Exact: comma-separated market tickers.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe('Max markets to return (default 40).'),
  cursor: z.string().optional().describe('Pagination cursor from a previous response.'),
};

/** Split a query into lowercase tokens of length ≥ 2. */
export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Relevance of an event to the query: title hits weigh more than series/category hits. */
export function scoreEvent(event: KalshiEvent, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const title = `${event.title ?? ''} ${event.sub_title ?? ''}`.toLowerCase();
  const meta =
    `${event.series_ticker ?? ''} ${event.event_ticker ?? ''} ${event.category ?? ''}`.toLowerCase();
  let score = 0;
  let matched = 0;
  for (const t of tokens) {
    if (title.includes(t)) {
      score += 3;
      matched += 1;
    } else if (meta.includes(t)) {
      score += 1;
      matched += 1;
    }
  }
  if (matched === 0) return 0;
  if (matched === tokens.length) score += 2; // every token present → strong match
  return score;
}

const emptyResult = (
  mode: SearchResult['mode'],
  over: Partial<SearchResult> = {},
): SearchResult => ({
  mode,
  markets: [],
  events: [],
  cursor: undefined,
  query: undefined,
  category: undefined,
  capped: false,
  ...over,
});

function literalFilter(markets: KalshiMarket[], query: string): KalshiMarket[] {
  const q = query.toLowerCase();
  return markets.filter((m) =>
    [m.ticker, m.yes_sub_title, m.event_ticker].some((f) => f?.toLowerCase().includes(q)),
  );
}

async function preciseMarkets(client: KalshiClient, p: MarketSearchParams): Promise<SearchResult> {
  const res = await client.get<KalshiMarketsResponse>('/markets', {
    authenticated: false,
    query: {
      status: p.status,
      series_ticker: p.series_ticker,
      event_ticker: p.event_ticker,
      tickers: p.tickers,
      limit: p.limit,
      cursor: p.cursor,
    },
  });
  let markets = res.markets ?? [];
  if (p.query) markets = literalFilter(markets, p.query);
  return emptyResult('markets', {
    markets: markets.map((market) => ({ market, eventTitle: undefined })),
    cursor: res.cursor,
    query: p.query,
  });
}

async function textSearch(client: KalshiClient, p: MarketSearchParams): Promise<SearchResult> {
  const tokens = tokenize(p.query ?? '');
  const status = p.status ?? 'open';
  const matched: Array<{ event: KalshiEvent; score: number }> = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await fetchEventsPage(client, {
      status,
      category: p.category,
      limit: EVENT_PAGE_LIMIT,
      cursor,
    });
    for (const event of page.events ?? []) {
      const score = scoreEvent(event, tokens);
      if (score > 0) matched.push({ event, score });
    }
    cursor = page.cursor || undefined;
    pages += 1;
    if (matched.length >= MATCH_TARGET) break;
  } while (cursor && pages < EVENT_SCAN_PAGES);

  // "capped" only when we ran out of page budget before collecting enough matches.
  const capped = Boolean(cursor) && matched.length < MATCH_TARGET;
  if (matched.length === 0) {
    return emptyResult('empty', { query: p.query, category: p.category, capped });
  }

  matched.sort((a, b) => b.score - a.score);
  const topEvents = matched.slice(0, RESULT_EVENTS).map((m) => m.event);

  const hits: MarketHit[] = [];
  for (const event of topEvents.slice(0, MARKET_EVENTS)) {
    const res = await client.get<KalshiMarketsResponse>('/markets', {
      authenticated: false,
      query: { event_ticker: event.event_ticker, status, limit: MARKETS_PER_EVENT },
    });
    for (const market of res.markets ?? []) hits.push({ market, eventTitle: event.title });
  }

  return emptyResult('search', {
    markets: hits.slice(0, p.limit ?? 40),
    events: topEvents,
    query: p.query,
    category: p.category,
    capped,
  });
}

async function categoryBrowse(client: KalshiClient, p: MarketSearchParams): Promise<SearchResult> {
  const page = await fetchEventsPage(client, {
    status: p.status ?? 'open',
    category: p.category,
    limit: p.limit ?? 50,
    cursor: p.cursor,
  });
  return emptyResult('category', {
    events: page.events ?? [],
    cursor: page.cursor,
    category: p.category,
  });
}

export async function searchMarkets(
  client: KalshiClient,
  p: MarketSearchParams,
): Promise<SearchResult> {
  if (p.tickers || p.series_ticker || p.event_ticker) return preciseMarkets(client, p);
  if (p.query && p.query.trim()) return textSearch(client, p);
  if (p.category) return categoryBrowse(client, p);
  return emptyResult('landing');
}

// ── rendering ────────────────────────────────────────────────────────────────

function marketLine(hit: MarketHit): string {
  const m = hit.market;
  const status = m.status ? `[${m.status}] ` : '';
  const yes = m.yes_bid_dollars ? fmtCentsPrice(dollarStringToCents(m.yes_bid_dollars)) : '—';
  const ask = m.yes_ask_dollars ? fmtCentsPrice(dollarStringToCents(m.yes_ask_dollars)) : '—';
  const vol = m.volume_fp ? ` · vol ${fmtCount(m.volume_fp)}` : '';
  const sub = m.yes_sub_title ? ` — ${m.yes_sub_title}` : '';
  return `  ${status}${m.ticker} YES ${yes}/${ask}${vol}${sub}`;
}

function eventLine(e: KalshiEvent): string {
  const cat = e.category ? ` [${e.category}]` : '';
  const series = e.series_ticker ? ` series=${e.series_ticker}` : '';
  return `  ${e.title ?? e.event_ticker}${cat} → event_ticker=${e.event_ticker}${series}`;
}

const categoriesHint = `Categories: ${KALSHI_CATEGORIES.join(', ')}.`;

export function renderSearch(r: SearchResult): string {
  switch (r.mode) {
    case 'landing':
      return [
        'Discover Kalshi markets. Three ways:',
        '  • Text:     search_markets({ query: "bitcoin" })  — finds markets by event title/series.',
        '  • Browse:   search_markets({ category: "Crypto" }) — then drill into an event.',
        '  • Exact:    search_markets({ event_ticker | series_ticker | tickers }).',
        '',
        categoriesHint,
      ].join('\n');

    case 'empty':
      return [
        `No open markets matched "${r.query}".${r.capped ? ' (Only part of the market set was scanned — try a more specific term.)' : ''}`,
        `Try a broader/different term, or browse a category, then drill in.`,
        categoriesHint,
      ].join('\n');

    case 'category':
      if (r.events.length === 0)
        return `No open events in category "${r.category}". ${categoriesHint}`;
      return [
        `${r.events.length} event(s) in "${r.category}"${r.cursor ? ' (more — pass cursor)' : ''}:`,
        ...r.events.map(eventLine),
        '',
        'Drill in: search_markets({ event_ticker: "<one above>" }).',
      ].join('\n');

    case 'markets':
      if (r.markets.length === 0) return 'No markets matched.';
      return [
        `${r.markets.length} market(s):`,
        ...r.markets.map(marketLine),
        ...(r.cursor ? ['', `More — pass cursor="${r.cursor}".`] : []),
      ].join('\n');

    case 'search': {
      const out = [
        `Found ${r.events.length} event(s) matching "${r.query}"${r.capped ? ' (partial scan)' : ''}.`,
      ];
      if (r.markets.length > 0) {
        out.push('', 'Markets in the top match(es):', ...r.markets.map(marketLine));
      }
      out.push('', 'Matching events (drill in with event_ticker):', ...r.events.map(eventLine));
      return out.join('\n');
    }
  }
}

export function register(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'search_markets',
    {
      title: 'Search markets',
      description:
        'Discover Kalshi markets. Free-text `query` searches by event title/series/category ' +
        '(so "bitcoin" works even though it is not in the ticker); `category` browses; ' +
        '`event_ticker`/`series_ticker`/`tickers` list exact markets. Read-only; prices in ' +
        'cents (= probability). No args returns the category list.',
      inputSchema: inputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return textResult(renderSearch(await searchMarkets(ctx.client, args)));
      } catch (err) {
        return errorResult(toErrorMessage(err));
      }
    },
  );
}
