/**
 * Kalshi API response types. Extended per checkpoint.
 * Keep these faithful to the live API shapes (docs/REFERENCES.md) — the v2
 * surface uses fixed-point dollar STRINGS (e.g. "0.1500") and *_fp counts.
 */

export interface KalshiBalance {
  /** Cash balance in cents (integer). */
  balance: number;
  // TODO(M1): add balance dollar-string + portfolio value fields per
  //   GET /portfolio/balance.
}

// TODO(M2): Market, Event, Series, OrderBook, Candlestick.
// TODO(M3): Position, Order.
// TODO(M4): CreateOrderV2Request { ticker; side: 'bid' | 'ask'; price: string;
//   count: string; time_in_force: 'good_till_canceled' | 'immediate_or_cancel'
//   | 'fill_or_kill'; client_order_id; ... }.
