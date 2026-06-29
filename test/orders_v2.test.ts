import { describe, it, expect } from 'vitest';
import { KalshiClient, type KalshiTransport } from '../src/kalshi/client.js';
import { createOrderV2, cancelOrderV2, batchCancelV2 } from '../src/kalshi/orders.js';
import type { CreateOrderBody } from '../src/kalshi/types.js';
import { testKey } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';

function capture(json: unknown): {
  client: KalshiClient;
  seen: () => Parameters<KalshiTransport>[0];
} {
  let captured: Parameters<KalshiTransport>[0];
  const transport: KalshiTransport = async (req) => {
    captured = req;
    return { status: 200, json };
  };
  const client = new KalshiClient({
    baseUrl: DEMO_BASE,
    apiKeyId: 'k',
    privateKeyPem: testKey(),
    transport,
  });
  return { client, seen: () => captured };
}

describe('V2 order mutation endpoints (mutation lives ONLY here — ADR-0004)', () => {
  it('createOrderV2 → POST /portfolio/events/orders with the full body', async () => {
    const { client, seen } = capture({ order_id: 'O1' });
    const body: CreateOrderBody = {
      ticker: 'KXBTCD',
      side: 'bid',
      price: '0.16',
      count: '10',
      time_in_force: 'good_till_canceled',
      client_order_id: 'c-1',
      self_trade_prevention_type: 'taker_at_cross',
    };
    await createOrderV2(client, body);
    expect(seen().method).toBe('POST');
    expect(seen().url).toBe(`${DEMO_BASE}/portfolio/events/orders`);
    expect(JSON.parse(seen().body as string)).toEqual(body);
  });

  it('cancelOrderV2 → DELETE /portfolio/events/orders/{order_id}', async () => {
    const { client, seen } = capture({ order_id: 'O1', reduced_by: '10.00' });
    await cancelOrderV2(client, 'O1');
    expect(seen().method).toBe('DELETE');
    expect(seen().url).toBe(`${DEMO_BASE}/portfolio/events/orders/O1`);
  });

  it('batchCancelV2 → DELETE /portfolio/events/orders/batched with { orders: [{ order_id }] }', async () => {
    const { client, seen } = capture({ orders: [] });
    await batchCancelV2(client, ['O1', 'O2']);
    expect(seen().method).toBe('DELETE');
    expect(seen().url).toBe(`${DEMO_BASE}/portfolio/events/orders/batched`);
    expect(JSON.parse(seen().body as string)).toEqual({
      orders: [{ order_id: 'O1' }, { order_id: 'O2' }],
    });
  });
});
