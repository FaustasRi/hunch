import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KalshiClient, type KalshiTransport } from '../src/kalshi/client.js';
import { TokenStore } from '../src/safety/token.js';
import { executeCancel } from '../src/tools/cancel_order.js';
import { executeCancelAll } from '../src/tools/cancel_all_orders.js';
import type { ServerContext } from '../src/context.js';
import type { Config } from '../src/config.js';
import type { ConfirmDecision } from '../src/safety/confirm.js';
import { testKey } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const proceed = async (): Promise<ConfirmDecision> => ({ proceed: true, via: 'implicit' });
const decline = async (): Promise<ConfirmDecision> => ({ proceed: false, reason: 'declined' });

function makeCtx(transport: KalshiTransport): ServerContext {
  const config: Config = {
    env: 'demo',
    baseUrl: DEMO_BASE,
    apiKeyId: 'k',
    privateKeyPem: testKey(),
    caps: { maxOrderUsd: 25, maxDailyUsd: 100, maxOpenExposureUsd: 250, disableLimits: false },
    allowSports: false,
    auditLogPath: join(mkdtempSync(join(tmpdir(), 'hunch-audit-')), 'audit.jsonl'),
  };
  const client = new KalshiClient({
    baseUrl: config.baseUrl,
    apiKeyId: config.apiKeyId,
    privateKeyPem: config.privateKeyPem,
    transport,
  });
  return { config, client, tokens: new TokenStore() };
}

describe('cancel_order', () => {
  it('DELETEs the V2 single-cancel path and reports the result', async () => {
    let seen: Parameters<KalshiTransport>[0] | undefined;
    const ctx = makeCtx(async (req) => {
      seen = req;
      return { status: 200, json: { order_id: 'ORD9', reduced_by: '10.00' } };
    });
    const res = await executeCancel(ctx, 'ORD9', { confirm: proceed });
    expect(res.isError).toBeFalsy();
    expect(seen?.method).toBe('DELETE');
    expect(seen?.url).toBe(`${DEMO_BASE}/portfolio/events/orders/ORD9`);
    expect((res.content[0] as { text: string }).text).toContain('Cancelled order ORD9');
  });

  it('aborts on a declined confirmation (no DELETE)', async () => {
    let called = false;
    const ctx = makeCtx(async () => {
      called = true;
      return { status: 200, json: {} };
    });
    const res = await executeCancel(ctx, 'ORD9', { confirm: decline });
    expect(res.isError).toBe(true);
    expect(called).toBe(false);
  });
});

describe('cancel_all_orders', () => {
  const restingOrders = {
    orders: [
      {
        order_id: 'ord_resting_1',
        ticker: 'KXBTCD',
        outcome_side: 'yes',
        book_side: 'bid',
        status: 'resting',
        yes_price_dollars: '0.16',
        initial_count_fp: '10.00',
        fill_count_fp: '0.00',
        remaining_count_fp: '10.00',
      },
    ],
  };

  it('lists resting orders then batch-DELETEs them via the V2 body shape', async () => {
    let deleteBody: unknown;
    const ctx = makeCtx(async (req) => {
      if (req.url.includes('/portfolio/orders')) return { status: 200, json: restingOrders };
      if (req.url.includes('/portfolio/events/orders/batched')) {
        deleteBody = JSON.parse(req.body as string);
        return {
          status: 200,
          json: { orders: [{ order_id: 'ord_resting_1', reduced_by: '10.00' }] },
        };
      }
      return { status: 404, json: {} };
    });
    const res = await executeCancelAll(ctx, { confirm: proceed });
    expect(res.isError).toBeFalsy();
    expect(deleteBody).toEqual({ orders: [{ order_id: 'ord_resting_1' }] });
    expect((res.content[0] as { text: string }).text).toContain('cancelled 1 resting order');
  });

  it('is a no-op when there are no resting orders', async () => {
    const ctx = makeCtx(async (req) => {
      if (req.url.includes('/portfolio/orders')) return { status: 200, json: { orders: [] } };
      return { status: 404, json: {} };
    });
    const res = await executeCancelAll(ctx, { confirm: proceed });
    expect((res.content[0] as { text: string }).text).toBe('No resting orders to cancel.');
  });
});
