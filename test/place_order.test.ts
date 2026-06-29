import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KalshiClient, type KalshiTransport } from '../src/kalshi/client.js';
import { TokenStore, type PreviewedOrder } from '../src/safety/token.js';
import { executePlace } from '../src/tools/place_order.js';
import type { ServerContext } from '../src/context.js';
import type { Config } from '../src/config.js';
import type { ConfirmDecision } from '../src/safety/confirm.js';
import { loadFixture, routeTransport, testKey } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const positions = loadFixture('positions.json');

const previewed: PreviewedOrder = {
  conversational: {
    ticker: 'KXBTCD',
    action: 'buy',
    side: 'yes',
    priceCents: 16,
    count: 10,
    tif: 'limit',
  },
  v2: {
    ticker: 'KXBTCD',
    side: 'bid',
    price: '0.16',
    count: '10',
    time_in_force: 'good_till_canceled',
  },
  costBasisCents: 160,
  env: 'demo',
};

const proceed = async (): Promise<ConfirmDecision> => ({ proceed: true, via: 'implicit' });
const decline = async (): Promise<ConfirmDecision> => ({ proceed: false, reason: 'declined' });

function makeCtx(opts: { transport?: KalshiTransport; caps?: Config['caps'] } = {}): ServerContext {
  const auditLogPath = join(mkdtempSync(join(tmpdir(), 'hunch-audit-')), 'audit.jsonl');
  const config: Config = {
    env: 'demo',
    baseUrl: DEMO_BASE,
    apiKeyId: 'k',
    privateKeyPem: testKey(),
    caps: opts.caps ?? {
      maxOrderUsd: 25,
      maxDailyUsd: 100,
      maxOpenExposureUsd: 250,
      disableLimits: false,
    },
    allowSports: false,
    auditLogPath,
  };
  const transport =
    opts.transport ??
    routeTransport([
      {
        match: '/portfolio/events/orders',
        json: { order_id: 'ORD123', fill_count_fp: '0.00', remaining_count_fp: '10.00' },
      },
      { match: '/portfolio/positions', json: positions },
    ]);
  const client = new KalshiClient({
    baseUrl: config.baseUrl,
    apiKeyId: config.apiKeyId,
    privateKeyPem: config.privateKeyPem,
    transport,
  });
  return { config, client, tokens: new TokenStore({ now: () => 1000, genId: () => 'TKN' }) };
}

function readLog(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('place_order (executePlace)', () => {
  it('refuses without a valid token (no preview, no trade)', async () => {
    const ctx = makeCtx();
    const res = await executePlace(ctx, 'bogus-token', { confirm: proceed });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toMatch(/token/i);
  });

  it('refuses an expired token', async () => {
    let clock = 1000;
    const ctx = makeCtx();
    ctx.tokens = new TokenStore({ ttlMs: 1000, now: () => clock, genId: () => 'TKN' });
    const { token } = ctx.tokens.issue(previewed);
    clock = 1000 + 2000;
    const res = await executePlace(ctx, token, { confirm: proceed, now: () => clock });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toMatch(/expired/i);
  });

  it('places via V2 with a generated client_order_id + STP and audits ok', async () => {
    let body: Record<string, unknown> | undefined;
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders')) {
        body = JSON.parse(req.body as string);
        return {
          status: 200,
          json: { order_id: 'ORD123', fill_count_fp: '0.00', remaining_count_fp: '10.00' },
        };
      }
      if (req.url.includes('/portfolio/positions')) return { status: 200, json: positions };
      return { status: 404, json: {} };
    };
    const ctx = makeCtx({ transport });
    const { token } = ctx.tokens.issue(previewed);
    const res = await executePlace(ctx, token, {
      confirm: proceed,
      genClientOrderId: () => 'COID-1',
    });

    expect(res.isError).toBeFalsy();
    expect((res.content[0] as { text: string }).text).toContain('order_id=ORD123');
    expect(body).toEqual({
      ticker: 'KXBTCD',
      side: 'bid',
      price: '0.16',
      count: '10',
      time_in_force: 'good_till_canceled',
      client_order_id: 'COID-1',
      self_trade_prevention_type: 'taker_at_cross',
    });
    const placed = readLog(ctx.config.auditLogPath).find(
      (e) => e.event === 'place' && e.result === 'ok',
    );
    expect(placed).toMatchObject({
      orderId: 'ORD123',
      costBasisCents: 160,
      action: 'buy',
      side: 'yes',
    });
  });

  it('aborts when confirmation is declined — no POST, audit records the rejection', async () => {
    let posted = false;
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders')) posted = true;
      if (req.url.includes('/portfolio/positions')) return { status: 200, json: positions };
      return { status: 200, json: {} };
    };
    const ctx = makeCtx({ transport });
    const { token } = ctx.tokens.issue(previewed);
    const res = await executePlace(ctx, token, { confirm: decline });
    expect(res.isError).toBe(true);
    expect(posted).toBe(false);
    expect(readLog(ctx.config.auditLogPath).some((e) => e.result === 'rejected')).toBe(true);
  });

  it('re-checks caps at placement and rejects an over-cap order without POSTing', async () => {
    let posted = false;
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders')) posted = true;
      if (req.url.includes('/portfolio/positions')) return { status: 200, json: positions };
      return { status: 200, json: {} };
    };
    const ctx = makeCtx({
      transport,
      caps: { maxOrderUsd: 1, maxDailyUsd: 100, maxOpenExposureUsd: 250, disableLimits: false },
    });
    const { token } = ctx.tokens.issue(previewed); // $1.60 > $1 cap
    const res = await executePlace(ctx, token, { confirm: proceed });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toMatch(/MAX_ORDER_USD/);
    expect(posted).toBe(false);
  });

  it('audits an API failure and surfaces an actionable error', async () => {
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders')) {
        return {
          status: 400,
          json: { error: { code: 'bad_request', message: 'price too aggressive' } },
        };
      }
      if (req.url.includes('/portfolio/positions')) return { status: 200, json: positions };
      return { status: 404, json: {} };
    };
    const ctx = makeCtx({ transport });
    const { token } = ctx.tokens.issue(previewed);
    const res = await executePlace(ctx, token, { confirm: proceed });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toMatch(/price too aggressive/);
    expect(
      readLog(ctx.config.auditLogPath).some((e) => e.event === 'place' && e.result === 'error'),
    ).toBe(true);
  });
});
