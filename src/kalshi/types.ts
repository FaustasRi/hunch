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

export interface KalshiEventResponse {
  event?: {
    event_ticker?: string;
    series_ticker?: string;
    title?: string;
  };
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

// TODO(M3): Position, Order.
// TODO(M4): CreateOrderV2Request { ticker; side: 'bid' | 'ask'; price: string;
//   count: string; time_in_force: 'good_till_canceled' | 'immediate_or_cancel'
//   | 'fill_or_kill'; self_trade_prevention_type; client_order_id; ... }.
