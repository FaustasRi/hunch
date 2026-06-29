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

// TODO(M2): Market, Event, Series, OrderBook, Candlestick.
// TODO(M3): Position, Order.
// TODO(M4): CreateOrderV2Request { ticker; side: 'bid' | 'ask'; price: string;
//   count: string; time_in_force: 'good_till_canceled' | 'immediate_or_cancel'
//   | 'fill_or_kill'; client_order_id; ... }.
