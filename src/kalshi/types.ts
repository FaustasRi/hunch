/**
 * Kalshi API response types. Extended per checkpoint.
 * Keep these faithful to the live API shapes (docs/REFERENCES.md) — the v2
 * surface uses fixed-point dollar STRINGS (e.g. "0.1500") and *_fp counts.
 */

/**
 * GET /portfolio/balance. Kalshi returns BOTH integer cents and a fixed-point
 * dollar string. `portfolio_value` is the cents value of all open positions.
 * (Verified against docs.kalshi.com → api-reference/portfolio/get-balance.)
 */
export interface KalshiBalanceResponse {
  /** Available cash, in cents (integer). */
  balance: number;
  /** Available cash as a fixed-point dollar string, e.g. "1000.00". */
  balance_dollars?: string;
  /** Current value of all open positions, in cents. */
  portfolio_value?: number;
  /** Unix timestamp (seconds) of the last update. */
  updated_ts?: number;
}

/**
 * A market on the V2 surface. Prices are fixed-point dollar STRINGS
 * (yes_bid_dollars etc.); counts/volumes are `_fp` strings. The market object no
 * longer carries `series_ticker` or `title` — resolve the series via the event,
 * and prefer yes_sub_title for display. (docs.kalshi.com → market/get-market.)
 */
export interface KalshiMarket {
  ticker: string;
  event_ticker?: string;
  market_type?: string;
  status?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  rules_primary?: string;
  rules_secondary?: string;
  open_time?: string;
  close_time?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  volume_fp?: string;
  volume_24h_fp?: string;
  open_interest_fp?: string;
  /** Sometimes absent; resolve via the event when missing (for candlesticks). */
  series_ticker?: string;
}

export interface KalshiMarketsResponse {
  markets: KalshiMarket[];
  cursor?: string;
}

export interface KalshiMarketResponse {
  market: KalshiMarket;
}

/**
 * GET /markets/{ticker}/orderbook. Each leg lists **resting bids only**, as
 * `[priceDollarString, countFpString]`. YES asks are derived from NO bids:
 * a YES ask at price p equals a NO bid at (1 − p). (CONTEXT gotcha #3.)
 */
export interface KalshiOrderbookResponse {
  orderbook_fp?: {
    yes_dollars?: [string, string][];
    no_dollars?: [string, string][];
  };
}

/**
 * An event groups related markets and — unlike a market — carries the human-readable
 * `title`, `category`, and `series_ticker`. This is the key to discovery/search: text
 * lives on events, not markets. With `with_nested_markets=true`, `markets` is populated.
 */
export interface KalshiEvent {
  event_ticker: string;
  series_ticker?: string;
  title?: string;
  sub_title?: string;
  category?: string;
  mutually_exclusive?: boolean;
  markets?: KalshiMarket[];
}

export interface KalshiEventResponse {
  event?: KalshiEvent;
}

export interface KalshiEventsResponse {
  events?: KalshiEvent[];
  cursor?: string;
}

export interface KalshiSeries {
  ticker?: string;
  title?: string;
  category?: string;
  frequency?: string;
}

export interface KalshiSeriesResponse {
  series?: KalshiSeries;
}

/** One candlestick (a subset — we only need the trade-price close for trend). */
export interface KalshiCandlestick {
  end_period_ts?: number;
  price?: {
    open_dollars?: string | null;
    high_dollars?: string | null;
    low_dollars?: string | null;
    close_dollars?: string | null;
  };
  volume_fp?: string;
}

export interface KalshiCandlesticksResponse {
  ticker?: string;
  candlesticks?: KalshiCandlestick[];
}

/**
 * GET /portfolio/positions → { market_positions, event_positions, cursor }.
 * `position_fp` is a SIGNED contract count (positive = long YES, negative = long NO).
 * Money fields are fixed-point dollar strings. (docs → portfolio/get-positions.)
 */
export interface KalshiMarketPosition {
  ticker: string;
  position_fp?: string;
  market_exposure_dollars?: string;
  realized_pnl_dollars?: string;
  total_traded_dollars?: string;
  fees_paid_dollars?: string;
  resting_orders_count?: number;
  last_updated_ts?: string;
}

export interface KalshiPositionsResponse {
  market_positions?: KalshiMarketPosition[];
  event_positions?: unknown[];
  cursor?: string;
}

/**
 * GET /portfolio/orders (the legacy READ path — still valid; mutation does NOT go
 * here, see ADR-0004). `outcome_side` (yes/no) + `book_side` (bid/ask) are the
 * canonical direction fields; `side`/`action` are deprecated fallbacks. Prices are
 * fixed-point dollar strings; counts are `_fp` strings. (docs → orders/get-orders.)
 */
export type OutcomeSide = 'yes' | 'no';
export type BookSide = 'bid' | 'ask';
export type OrderStatus = 'resting' | 'canceled' | 'executed';

export interface KalshiOrder {
  order_id: string;
  client_order_id?: string;
  ticker: string;
  outcome_side?: OutcomeSide;
  book_side?: BookSide;
  /** @deprecated use outcome_side */ side?: OutcomeSide;
  /** @deprecated use book_side */ action?: 'buy' | 'sell';
  type?: string;
  status?: string;
  yes_price_dollars?: string;
  no_price_dollars?: string;
  initial_count_fp?: string;
  fill_count_fp?: string;
  remaining_count_fp?: string;
  created_time?: string;
  time_in_force?: string;
}

export interface KalshiOrdersResponse {
  orders?: KalshiOrder[];
  cursor?: string;
}

// ── Order domain (translation + mutation) ────────────────────────────────────
// The conversational order (what the user expresses) and the YES-leg-only V2 wire
// shape it maps to. The mapping logic lives in tools/translate.ts; these are the
// shapes. V2 create is YES-leg-only and self_trade_prevention_type is REQUIRED
// (verified against docs → orders/create-order-v2).

export type OrderAction = 'buy' | 'sell';
export type OrderTif = 'limit' | 'market';
export type TimeInForce = 'good_till_canceled' | 'immediate_or_cancel' | 'fill_or_kill';
export type SelfTradePrevention = 'taker_at_cross' | 'maker';

/** Price is in the NAMED side's terms (NO @30¢ → priceCents 30); side is yes/no. */
export interface ConversationalOrder {
  ticker: string;
  action: OrderAction;
  side: OutcomeSide;
  priceCents: number;
  count: number;
  tif: OrderTif;
}

/** Core V2 create fields (client_order_id + self_trade_prevention_type added at placement). */
export interface V2OrderRequest {
  ticker: string;
  side: BookSide;
  price: string;
  count: string;
  time_in_force: TimeInForce;
}

/** Full POST /portfolio/events/orders body. */
export interface CreateOrderBody extends V2OrderRequest {
  client_order_id: string;
  self_trade_prevention_type: SelfTradePrevention;
}

/** POST /portfolio/events/orders response — order fields returned at top level (not wrapped). */
export interface CreateOrderV2Response {
  order_id?: string;
  client_order_id?: string;
  fill_count?: number;
  remaining_count?: number;
  fill_count_fp?: string;
  remaining_count_fp?: string;
  ts_ms?: number;
  status?: string;
}

/** DELETE /portfolio/events/orders/{order_id} response. */
export interface CancelOrderV2Response {
  order_id?: string;
  client_order_id?: string;
  /** Contracts cancelled (the remaining count at cancel time), fixed-point string. */
  reduced_by?: string;
  ts_ms?: number;
}

/** DELETE /portfolio/events/orders/batched response. */
export interface BatchCancelV2Response {
  orders?: Array<{
    order_id?: string;
    client_order_id?: string;
    reduced_by?: string;
    ts_ms?: number;
    error?: unknown;
  }>;
}
