import { describe, it, expect } from 'vitest';
import { KalshiClient, type KalshiTransport } from '../src/kalshi/client.js';
import { normalizeOrder, fetchOrders, renderOrders } from '../src/tools/get_orders.js';
import type { KalshiOrdersResponse } from '../src/kalshi/types.js';
import { loadFixture, routeTransport, testKey } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const orders = loadFixture<KalshiOrdersResponse>('orders.json');

describe('normalizeOrder', () => {
  it('reads direction from canonical outcome_side + book_side and the matching price', () => {
    const yesBid = normalizeOrder(orders.orders![0]!);
    expect(yesBid).toMatchObject({
      verb: 'buy',
      outcome: 'YES',
      priceCents: 16,
      initial: 10,
      filled: 0,
      status: 'resting',
    });
    const noBid = normalizeOrder(orders.orders![1]!);
    expect(noBid).toMatchObject({
      verb: 'buy',
      outcome: 'NO',
      priceCents: 30,
      initial: 4,
      filled: 4,
      status: 'executed',
    });
  });

  it('falls back to the deprecated side/action fields', () => {
    const v = normalizeOrder({
      order_id: 'x',
      ticker: 'T',
      side: 'no',
      action: 'sell',
      no_price_dollars: '0.40',
      initial_count_fp: '2.00',
      fill_count_fp: '0.00',
      remaining_count_fp: '2.00',
      status: 'resting',
    });
    expect(v).toMatchObject({ verb: 'sell', outcome: 'NO', priceCents: 40 });
  });
});

describe('fetchOrders / renderOrders', () => {
  it('fetches and renders direction, price, fill progress, and status', async () => {
    const client = new KalshiClient({
      baseUrl: DEMO_BASE,
      apiKeyId: 'k',
      privateKeyPem: testKey(),
      transport: routeTransport([{ match: '/portfolio/orders', json: orders }]),
    });
    const out = renderOrders(await fetchOrders(client));
    expect(out).toContain('2 order(s)');
    expect(out).toContain('buy YES 16¢ ×10 [resting] filled 0/10 · id ord_resting_1');
    expect(out).toContain('buy NO 30¢ ×4 [executed] filled 4/4 · id ord_done_2');
  });

  it('passes the status filter through as a query param', async () => {
    let seenUrl = '';
    const transport: KalshiTransport = async (req) => {
      seenUrl = req.url;
      return { status: 200, json: orders };
    };
    const client = new KalshiClient({
      baseUrl: DEMO_BASE,
      apiKeyId: 'k',
      privateKeyPem: testKey(),
      transport,
    });
    await fetchOrders(client, { status: 'resting', ticker: 'KXBTCD-25JAN0117-T103000' });
    expect(seenUrl).toContain('status=resting');
    expect(seenUrl).toContain('ticker=KXBTCD-25JAN0117-T103000');
  });
});
