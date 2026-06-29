import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KalshiClient, type KalshiTransport } from '../src/kalshi/client.js';
import { TokenStore } from '../src/safety/token.js';
import { Mutex } from '../src/safety/mutex.js';
import { DailyLedger } from '../src/safety/ledger.js';
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
  return {
    config,
    client,
    tokens: new TokenStore(),
    placeLock: new Mutex(),
    dailyLedger: new DailyLedger(),
  };
}

const textOf = (r: { content: Array<{ text?: string }> }): string => r.content[0]?.text ?? '';
function readLog(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('cancel_order', () => {
  it('DELETEs the V2 single-cancel path and audits ok', async () => {
    let seen: Parameters<KalshiTransport>[0] | undefined;
    const ctx = makeCtx(async (req) => {
      seen = req;
      return { status: 200, json: { order_id: 'ORD9', reduced_by: '10.00' } };
    });
    const res = await executeCancel(ctx, 'ORD9', { confirm: proceed });
    expect(res.isError).toBeFalsy();
    expect(seen?.method).toBe('DELETE');
    expect(seen?.url).toBe(`${DEMO_BASE}/portfolio/events/orders/ORD9`);
    expect(textOf(res)).toContain('Cancelled order ORD9');
    expect(readLog(ctx.config.auditLogPath).find((e) => e.event === 'cancel')).toMatchObject({
      result: 'ok',
      orderId: 'ORD9',
    });
  });

  it('audits a declined confirmation and does not DELETE', async () => {
    let called = false;
    const ctx = makeCtx(async () => {
      called = true;
      return { status: 200, json: {} };
    });
    const res = await executeCancel(ctx, 'ORD9', { confirm: decline });
    expect(res.isError).toBe(true);
    expect(called).toBe(false);
    expect(
      readLog(ctx.config.auditLogPath).some((e) => e.event === 'cancel' && e.result === 'rejected'),
    ).toBe(true);
  });

  it('audits an API error', async () => {
    const ctx = makeCtx(async () => ({ status: 404, json: { error: { message: 'not found' } } }));
    const res = await executeCancel(ctx, 'GONE', { confirm: proceed });
    expect(res.isError).toBe(true);
    expect(
      readLog(ctx.config.auditLogPath).some((e) => e.event === 'cancel' && e.result === 'error'),
    ).toBe(true);
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

  it('lists resting orders then batch-DELETEs them, auditing ok', async () => {
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
    expect(textOf(res)).toContain('cancelled 1 resting order');
    expect(readLog(ctx.config.auditLogPath).find((e) => e.event === 'cancel_all')).toMatchObject({
      result: 'ok',
      count: 1,
    });
  });

  it('is a no-op when nothing is resting', async () => {
    const ctx = makeCtx(async (req) => {
      if (req.url.includes('/portfolio/orders')) return { status: 200, json: { orders: [] } };
      return { status: 404, json: {} };
    });
    const res = await executeCancelAll(ctx, { confirm: proceed });
    expect(textOf(res)).toBe('No resting orders to cancel.');
  });

  it('audits when listing resting orders fails', async () => {
    const ctx = makeCtx(async (req) => {
      if (req.url.includes('/portfolio/orders'))
        return { status: 500, json: { error: { message: 'down' } } };
      return { status: 404, json: {} };
    });
    const res = await executeCancelAll(ctx, { confirm: proceed });
    expect(res.isError).toBe(true);
    expect(
      readLog(ctx.config.auditLogPath).some(
        (e) => e.event === 'cancel_all' && e.result === 'error',
      ),
    ).toBe(true);
  });

  it('audits a declined kill switch', async () => {
    const ctx = makeCtx(async (req) => {
      if (req.url.includes('/portfolio/orders')) return { status: 200, json: restingOrders };
      return { status: 404, json: {} };
    });
    const res = await executeCancelAll(ctx, { confirm: decline });
    expect(res.isError).toBe(true);
    expect(
      readLog(ctx.config.auditLogPath).some(
        (e) => e.event === 'cancel_all' && e.result === 'rejected',
      ),
    ).toBe(true);
  });

  it('audits a batch-cancel API failure', async () => {
    const ctx = makeCtx(async (req) => {
      if (req.url.includes('/portfolio/orders')) return { status: 200, json: restingOrders };
      if (req.url.includes('/portfolio/events/orders/batched'))
        return { status: 500, json: { error: { message: 'down' } } };
      return { status: 404, json: {} };
    });
    const res = await executeCancelAll(ctx, { confirm: proceed });
    expect(res.isError).toBe(true);
    expect(
      readLog(ctx.config.auditLogPath).some(
        (e) => e.event === 'cancel_all' && e.result === 'error',
      ),
    ).toBe(true);
  });
});
