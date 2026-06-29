/**
 * Kalshi V2 order MUTATION endpoints — the only place order mutation lives (ADR-0004).
 * The legacy /portfolio/orders create/cancel endpoints were deprecated June 2026 and
 * now error; reads still use the legacy GET (see tools/get_orders.ts). All shapes
 * verified against docs.kalshi.com → orders/{create,cancel,batch-cancel}-order-v2.
 */
import type { KalshiClient } from './client.js';
import type {
  CreateOrderBody,
  CreateOrderV2Response,
  CancelOrderV2Response,
  BatchCancelV2Response,
} from './types.js';

/** POST /portfolio/events/orders — place an order (YES-leg-only body). */
export function createOrderV2(
  client: KalshiClient,
  body: CreateOrderBody,
): Promise<CreateOrderV2Response> {
  return client.post<CreateOrderV2Response>('/portfolio/events/orders', body);
}

/** DELETE /portfolio/events/orders/{order_id} — cancel one resting order. */
export function cancelOrderV2(
  client: KalshiClient,
  orderId: string,
): Promise<CancelOrderV2Response> {
  return client.delete<CancelOrderV2Response>(
    `/portfolio/events/orders/${encodeURIComponent(orderId)}`,
  );
}

/** DELETE /portfolio/events/orders/batched — cancel many; body is { orders: [{ order_id }] }. */
export function batchCancelV2(
  client: KalshiClient,
  orderIds: string[],
): Promise<BatchCancelV2Response> {
  return client.delete<BatchCancelV2Response>('/portfolio/events/orders/batched', {
    body: { orders: orderIds.map((order_id) => ({ order_id })) },
  });
}
