/**
 * Order translation — THE single riskiest correctness surface (ADR-0004, CONTEXT
 * gotcha #2). Kalshi V2 create is YES-leg-only: `side` is `bid` (buy YES) or `ask`
 * (sell YES); there is no action / yes_price / no_price / type field. A conversational
 * order names a side (yes/no), an action (buy/sell), and a price for THAT side; we map
 * it onto the YES leg, mirroring the price for NO:
 *
 *   buy  YES @p  → bid @p          sell YES @p  → ask @p
 *   buy  NO  @p  → ask @(100−p)    sell NO  @p  → bid @(100−p)
 *
 * (A YES bid at p equals a NO ask at 100−p, confirmed against the live order book.)
 * "market" is not a field: it is IOC at a marketable price. Get this wrong and you
 * trade the opposite side — hence the exhaustive truth-table test.
 */
import { centsToUsd, formatCount } from '../kalshi/fixedpoint.js';

export type OrderAction = 'buy' | 'sell';
export type OrderSide = 'yes' | 'no';
export type OrderTif = 'limit' | 'market';
export type BookSide = 'bid' | 'ask';
export type TimeInForce = 'good_till_canceled' | 'immediate_or_cancel' | 'fill_or_kill';

/** A conversational order: price is in the named side's terms (NO @30¢ → priceCents 30). */
export interface ConversationalOrder {
  ticker: string;
  action: OrderAction;
  side: OrderSide;
  priceCents: number;
  count: number;
  tif: OrderTif;
}

/** The core V2 wire shape (client_order_id + self_trade_prevention_type added at placement). */
export interface V2OrderRequest {
  ticker: string;
  side: BookSide;
  price: string;
  count: string;
  time_in_force: TimeInForce;
}

function assertValid(o: ConversationalOrder): void {
  if (!Number.isInteger(o.priceCents) || o.priceCents < 1 || o.priceCents > 99) {
    throw new Error(`price must be a whole number of cents in 1–99; got ${o.priceCents}`);
  }
  if (!Number.isInteger(o.count) || o.count < 1) {
    throw new Error(`count must be a whole number of contracts ≥ 1; got ${o.count}`);
  }
}

/** Map a conversational order to the YES-leg V2 wire shape. Pure. */
export function translateOrder(o: ConversationalOrder): V2OrderRequest {
  assertValid(o);
  // YES leg: buy→bid, sell→ask. NO is the opposite leg with the price mirrored.
  const bookSide: BookSide =
    o.side === 'yes' ? (o.action === 'buy' ? 'bid' : 'ask') : o.action === 'buy' ? 'ask' : 'bid';
  const yesPriceCents = o.side === 'yes' ? o.priceCents : 100 - o.priceCents;
  return {
    ticker: o.ticker,
    side: bookSide,
    price: centsToUsd(yesPriceCents),
    count: formatCount(o.count),
    time_in_force: o.tif === 'limit' ? 'good_till_canceled' : 'immediate_or_cancel',
  };
}

/**
 * Cost basis = maximum loss of the order, in cents. You pay the named side's price
 * when buying; when selling you risk the complement (treating a sell as opening the
 * opposite leg — conservative, never under-estimates risk). This is what the caps
 * measure (ADR-0003: cost basis, not payout).
 */
export function orderCostBasisCents(o: ConversationalOrder): number {
  const perContract = o.action === 'buy' ? o.priceCents : 100 - o.priceCents;
  return perContract * o.count;
}
