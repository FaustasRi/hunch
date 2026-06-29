/**
 * get_market_brief — the context keystone. One dense, LLM-optimized payload per
 * market: resolution rules, YES/NO best quotes, a correctly-derived two-sided depth
 * view, volume/open-interest, and a compact recent trend. Read-only; no key needed.
 *
 * Correctness anchors (CONTEXT gotchas):
 *  - The order book is BIDS-ONLY on each leg. The YES ask side is derived from the
 *    NO bids: a YES ask at price p equals a NO bid at (100 − p). (gotcha #3)
 *  - Candlesticks need series_ticker in the path; the market no longer carries it,
 *    so we resolve it via the event. The trend is best-effort. (gotcha #4)
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import type { KalshiClient } from '../kalshi/client.js';
import type {
  KalshiMarket,
  KalshiMarketResponse,
  KalshiOrderbookResponse,
  KalshiEventResponse,
  KalshiCandlestick,
  KalshiCandlesticksResponse,
} from '../kalshi/types.js';
import { dollarStringToCents, parseFp } from '../kalshi/fixedpoint.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';
import { fmtCount, fmtCentsPrice, groupThousands } from '../mcp/format.js';

const MAX_LEVELS = 5;
const TREND_DAYS = 7;

export interface DepthLevel {
  priceCents: number;
  count: number;
}

export interface TwoSidedBook {
  /** Resting bids to buy YES, best (highest) first. */
  yesBids: DepthLevel[];
  /** Derived asks to sell YES (from the NO bids), best (lowest) first. */
  yesAsks: DepthLevel[];
}

export interface TrendSummary {
  firstCents: number;
  lastCents: number;
  changeCents: number;
  lowCents: number;
  highCents: number;
  points: number;
}

export interface MarketBrief {
  ticker: string;
  status: string | undefined;
  subtitle: string | undefined;
  closeTime: string | undefined;
  rulesPrimary: string | undefined;
  rulesSecondary: string | undefined;
  lastCents: number | undefined;
  book: TwoSidedBook;
  volume: string | undefined;
  volume24h: string | undefined;
  openInterest: string | undefined;
  trend: TrendSummary | undefined;
}

/**
 * Derive a proper two-sided YES book from the bids-only order book.
 * YES bids come straight from `yes_dollars`; YES asks are the NO bids inverted
 * (price 100 − p), since a YES ask at p == a NO bid at 100 − p.
 */
export function deriveYesBook(ob: KalshiOrderbookResponse, maxLevels = MAX_LEVELS): TwoSidedBook {
  const yesRaw = ob.orderbook_fp?.yes_dollars ?? [];
  const noRaw = ob.orderbook_fp?.no_dollars ?? [];
  const yesBids = yesRaw
    .map(([price, count]): DepthLevel => ({
      priceCents: dollarStringToCents(price),
      count: parseFp(count),
    }))
    .sort((a, b) => b.priceCents - a.priceCents)
    .slice(0, maxLevels);
  const yesAsks = noRaw
    .map(([price, count]): DepthLevel => ({
      priceCents: 100 - dollarStringToCents(price),
      count: parseFp(count),
    }))
    .sort((a, b) => a.priceCents - b.priceCents)
    .slice(0, maxLevels);
  return { yesBids, yesAsks };
}

/** Summarize trade-price closes across candles into a compact trend. */
export function summarizeTrend(candles: KalshiCandlestick[]): TrendSummary | undefined {
  const closes: number[] = [];
  for (const candle of candles) {
    const close = candle.price?.close_dollars;
    if (typeof close === 'string' && close.length > 0) closes.push(dollarStringToCents(close));
  }
  if (closes.length === 0) return undefined;
  const first = closes[0] as number;
  const last = closes[closes.length - 1] as number;
  return {
    firstCents: first,
    lastCents: last,
    changeCents: last - first,
    lowCents: Math.min(...closes),
    highCents: Math.max(...closes),
    points: closes.length,
  };
}

export function buildBrief(
  market: KalshiMarket,
  book: TwoSidedBook,
  trend: TrendSummary | undefined,
): MarketBrief {
  return {
    ticker: market.ticker,
    status: market.status,
    subtitle: market.yes_sub_title,
    closeTime: market.close_time,
    rulesPrimary: market.rules_primary,
    rulesSecondary: market.rules_secondary,
    lastCents: market.last_price_dollars
      ? dollarStringToCents(market.last_price_dollars)
      : undefined,
    book,
    volume: market.volume_fp,
    volume24h: market.volume_24h_fp,
    openInterest: market.open_interest_fp,
    trend,
  };
}

async function resolveSeriesTicker(
  client: KalshiClient,
  market: KalshiMarket,
): Promise<string | undefined> {
  if (market.series_ticker) return market.series_ticker;
  if (!market.event_ticker) return undefined;
  const res = await client.get<KalshiEventResponse>(
    `/events/${encodeURIComponent(market.event_ticker)}`,
    {
      authenticated: false,
    },
  );
  return res.event?.series_ticker;
}

async function fetchTrend(
  client: KalshiClient,
  market: KalshiMarket,
  ticker: string,
  now: () => number,
): Promise<TrendSummary | undefined> {
  const series = await resolveSeriesTicker(client, market);
  if (!series) return undefined;
  const endTs = Math.floor(now() / 1000);
  const startTs = endTs - TREND_DAYS * 24 * 60 * 60;
  const res = await client.get<KalshiCandlesticksResponse>(
    `/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks`,
    { authenticated: false, query: { start_ts: startTs, end_ts: endTs, period_interval: 1440 } },
  );
  return summarizeTrend(res.candlesticks ?? []);
}

export async function fetchMarketBrief(
  client: KalshiClient,
  ticker: string,
  now: () => number = Date.now,
): Promise<MarketBrief> {
  const marketRes = await client.get<KalshiMarketResponse>(
    `/markets/${encodeURIComponent(ticker)}`,
    {
      authenticated: false,
    },
  );
  const market = marketRes.market;
  const ob = await client.get<KalshiOrderbookResponse>(
    `/markets/${encodeURIComponent(ticker)}/orderbook`,
    { authenticated: false },
  );
  const book = deriveYesBook(ob);
  // Trend is best-effort: new markets, missing series, or candlestick gaps just omit it.
  const trend = await fetchTrend(client, market, ticker, now).catch(() => undefined);
  return buildBrief(market, book, trend);
}

function renderLevels(levels: DepthLevel[]): string {
  if (levels.length === 0) return '—';
  return levels.map((l) => `${l.priceCents}¢×${groupThousands(l.count)}`).join('  ');
}

export function renderBrief(b: MarketBrief): string {
  const lines: string[] = [];
  const head = b.status ? `Market ${b.ticker} (${b.status})` : `Market ${b.ticker}`;
  lines.push(b.subtitle ? `${head} — ${b.subtitle}` : head);
  if (b.closeTime) lines.push(`Closes: ${b.closeTime}`);
  if (b.rulesPrimary) {
    lines.push('');
    lines.push(`Resolution: ${b.rulesPrimary}`);
  }

  const bestBid = b.book.yesBids[0];
  const bestAsk = b.book.yesAsks[0];
  const yesBid = bestBid ? fmtCentsPrice(bestBid.priceCents) : '—';
  const yesAsk = bestAsk ? fmtCentsPrice(bestAsk.priceCents) : '—';
  const spread = bestBid && bestAsk ? ` (spread ${bestAsk.priceCents - bestBid.priceCents}¢)` : '';
  const last = b.lastCents !== undefined ? ` · last ${fmtCentsPrice(b.lastCents)}` : '';
  lines.push('');
  lines.push(`YES  bid ${yesBid} / ask ${yesAsk}${spread}${last}`);
  const noBid = bestAsk ? fmtCentsPrice(100 - bestAsk.priceCents) : '—';
  const noAsk = bestBid ? fmtCentsPrice(100 - bestBid.priceCents) : '—';
  lines.push(`NO   bid ${noBid} / ask ${noAsk}   (mirror of the YES leg)`);
  lines.push('Depth (YES leg):');
  lines.push(`  bids: ${renderLevels(b.book.yesBids)}`);
  lines.push(`  asks: ${renderLevels(b.book.yesAsks)}`);

  const stats: string[] = [];
  if (b.volume) stats.push(`Volume ${fmtCount(b.volume)}`);
  if (b.volume24h) stats.push(`24h ${fmtCount(b.volume24h)}`);
  if (b.openInterest) stats.push(`OI ${fmtCount(b.openInterest)}`);
  if (stats.length) lines.push(stats.join(' · '));

  if (b.trend) {
    const sign = b.trend.changeCents > 0 ? '+' : '';
    lines.push(
      `Trend (${TREND_DAYS}d): ${fmtCentsPrice(b.trend.firstCents)} → ${fmtCentsPrice(b.trend.lastCents)} ` +
        `(${sign}${b.trend.changeCents}¢), range ${b.trend.lowCents}–${b.trend.highCents}¢ over ${b.trend.points} pts`,
    );
  }

  lines.push('');
  lines.push(
    'Note: price = probability (16¢ ≈ 16% likely, pays $1 if YES). You decide size; caps apply.',
  );
  return lines.join('\n');
}

export function register(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'get_market_brief',
    {
      title: 'Get market brief',
      description:
        'Rich one-shot context for a single market: resolution rules, YES/NO best ' +
        'quotes, order-book depth (correctly two-sided), volume/open-interest, and a ' +
        'recent price trend. Read-only. Prices in cents (= probability).',
      inputSchema: {
        ticker: z.string().min(1).describe('Market ticker, e.g. "KXBTCD-25JAN0117-T103000".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ ticker }) => {
      try {
        const brief = await fetchMarketBrief(ctx.client, ticker);
        return textResult(renderBrief(brief));
      } catch (err) {
        return errorResult(toErrorMessage(err));
      }
    },
  );
}
