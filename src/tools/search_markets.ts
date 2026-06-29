/**
 * search_markets — discover markets by status / series / event / tickers, with an
 * optional client-side text filter over the returned page. Read-only; no key needed
 * (market data is public). Kalshi has no server-side free-text param, so `query`
 * matches the current page only (documented in the tool description).
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import type { KalshiClient } from '../kalshi/client.js';
import type { KalshiMarket, KalshiMarketsResponse } from '../kalshi/types.js';
import { dollarStringToCents } from '../kalshi/fixedpoint.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';
import { fmtCount, fmtCentsPrice } from '../mcp/format.js';

const STATUS = ['unopened', 'open', 'paused', 'closed', 'settled'] as const;

const inputShape = {
  query: z
    .string()
    .min(1)
    .optional()
    .describe('Case-insensitive text match over the returned page (ticker, subtitle, event).'),
  status: z.enum(STATUS).optional().describe('Market lifecycle filter. Most useful: "open".'),
  series_ticker: z
    .string()
    .optional()
    .describe('Restrict to one series (recurring template), e.g. "KXBTC".'),
  event_ticker: z.string().optional().describe('Restrict to one event (group of related markets).'),
  tickers: z.string().optional().describe('Comma-separated explicit market tickers.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe('Page size (default 100, max 1000).'),
  cursor: z.string().optional().describe('Pagination cursor from a previous response.'),
};

export interface MarketSearchParams {
  query?: string | undefined;
  status?: (typeof STATUS)[number] | undefined;
  series_ticker?: string | undefined;
  event_ticker?: string | undefined;
  tickers?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

/** Case-insensitive substring filter over ticker + subtitle + event. */
export function filterMarketsByText(markets: KalshiMarket[], query: string): KalshiMarket[] {
  const q = query.toLowerCase();
  return markets.filter((m) =>
    [m.ticker, m.yes_sub_title, m.event_ticker].some((f) => f?.toLowerCase().includes(q)),
  );
}

export async function searchMarkets(
  client: KalshiClient,
  params: MarketSearchParams,
): Promise<{ markets: KalshiMarket[]; cursor: string | undefined }> {
  const res = await client.get<KalshiMarketsResponse>('/markets', {
    authenticated: false,
    query: {
      status: params.status,
      series_ticker: params.series_ticker,
      event_ticker: params.event_ticker,
      tickers: params.tickers,
      limit: params.limit,
      cursor: params.cursor,
    },
  });
  const all = res.markets ?? [];
  const markets = params.query ? filterMarketsByText(all, params.query) : all;
  return { markets, cursor: res.cursor };
}

function renderMarketLine(m: KalshiMarket): string {
  const status = m.status ? `[${m.status}]` : '';
  const yes = m.yes_bid_dollars ? fmtCentsPrice(dollarStringToCents(m.yes_bid_dollars)) : '—';
  const ask = m.yes_ask_dollars ? fmtCentsPrice(dollarStringToCents(m.yes_ask_dollars)) : '—';
  const vol = m.volume_fp ? ` · vol ${fmtCount(m.volume_fp)}` : '';
  const close = m.close_time ? ` · closes ${m.close_time}` : '';
  const sub = m.yes_sub_title ? `\n    "${m.yes_sub_title}"` : '';
  return `${m.ticker} ${status}  YES bid ${yes} / ask ${ask}${vol}${close}${sub}`;
}

export function renderSearch(markets: KalshiMarket[], cursor: string | undefined): string {
  if (markets.length === 0) return 'No markets matched.';
  const lines = markets.map(renderMarketLine);
  const footer = cursor ? `\n\nMore results — pass cursor="${cursor}" to page.` : '';
  return `${markets.length} market(s):\n\n${lines.join('\n')}${footer}`;
}

export function register(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'search_markets',
    {
      title: 'Search markets',
      description:
        'Find Kalshi markets by status, series, event, or explicit tickers, with an ' +
        'optional text filter applied to the returned page. Read-only. Prices shown in ' +
        'cents (= probability). Use the returned cursor to paginate.',
      inputSchema: inputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const { markets, cursor } = await searchMarkets(ctx.client, args);
        return textResult(renderSearch(markets, cursor));
      } catch (err) {
        return errorResult(toErrorMessage(err));
      }
    },
  );
}
