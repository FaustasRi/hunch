/**
 * Discovery helpers — events + series. Markets have no title/category/series, so
 * discovery goes through EVENTS (which do) and SERIES. Used by search_markets to make
 * free-text search and category browsing actually work over the ~10k+ open markets.
 * (Shapes verified live against the Kalshi demo API.)
 */
import type { KalshiClient } from './client.js';
import type { KalshiEventsResponse, KalshiSeriesResponse } from './types.js';

/** Kalshi's top-level categories (observed live). Demo category data is noisy, so
 * text-on-title is the strong signal; categories are a browse aid, not ground truth. */
export const KALSHI_CATEGORIES = [
  'Politics',
  'Elections',
  'Economics',
  'Financials',
  'Crypto',
  'Companies',
  'Climate and Weather',
  'Science and Technology',
  'World',
  'Sports',
  'Entertainment',
  'Social',
] as const;

export interface EventQuery {
  status?: string | undefined;
  category?: string | undefined;
  seriesTicker?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  withNestedMarkets?: boolean | undefined;
}

/** GET /events — public read. Pass withNestedMarkets to get each event's markets inline. */
export function fetchEventsPage(
  client: KalshiClient,
  q: EventQuery,
): Promise<KalshiEventsResponse> {
  return client.get<KalshiEventsResponse>('/events', {
    authenticated: false,
    query: {
      status: q.status,
      category: q.category,
      series_ticker: q.seriesTicker,
      limit: q.limit,
      cursor: q.cursor,
      with_nested_markets: q.withNestedMarkets,
    },
  });
}

/** GET /series/{ticker} — public read; carries the series title + category. */
export function fetchSeries(
  client: KalshiClient,
  seriesTicker: string,
): Promise<KalshiSeriesResponse> {
  return client.get<KalshiSeriesResponse>(`/series/${encodeURIComponent(seriesTicker)}`, {
    authenticated: false,
  });
}
