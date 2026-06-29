import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KalshiClient, type KalshiTransport } from '../src/kalshi/client.js';
import { TokenStore, type PreviewedOrder } from '../src/safety/token.js';
import { Mutex } from '../src/safety/mutex.js';
import { DailyLedger } from '../src/safety/ledger.js';
import { executePlace } from '../src/tools/place_order.js';
import type { ServerContext } from '../src/context.js';
import type { Config } from '../src/config.js';
import type { ConfirmDecision } from '../src/safety/confirm.js';
import { loadFixture, routeTransport, testKey } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const positions = loadFixture('positions.json');

function previewed(over: Partial<PreviewedOrder> = {}): PreviewedOrder {
  return {
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
    clientOrderId: 'COID-1',
    ...over,
  };
}

const proceed = async (): Promise<ConfirmDecision> => ({ proceed: true, via: 'implicit' });
const decline = async (): Promise<ConfirmDecision> => ({ proceed: false, reason: 'declined' });

function makeCtx(
  opts: {
    transport?: KalshiTransport;
    caps?: Config['caps'];
    tokens?: TokenStore;
    auditLogPath?: string;
  } = {},
): ServerContext {
  const auditLogPath =
    opts.auditLogPath ?? join(mkdtempSync(join(tmpdir(), 'hunch-audit-')), 'audit.jsonl');
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
  return {
    config,
    client,
    tokens: opts.tokens ?? new TokenStore({ now: () => 1000, genId: () => 'TKN' }),
    placeLock: new Mutex(),
    dailyLedger: new DailyLedger(),
  };
}

function readLog(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
const textOf = (r: { content: Array<{ text?: string }> }): string => r.content[0]?.text ?? '';

describe('place_order — token gate', () => {
  it('refuses an unknown token and audits the rejection', async () => {
    const ctx = makeCtx();
    const res = await executePlace(ctx, 'bogus-token', { confirm: proceed });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/token/i);
    expect(
      readLog(ctx.config.auditLogPath).some((e) => e.event === 'place' && e.result === 'rejected'),
    ).toBe(true);
  });

  it('refuses an expired token', async () => {
    let clock = 1000;
    const tokens = new TokenStore({ ttlMs: 1000, now: () => clock, genId: () => 'TKN' });
    const ctx = makeCtx({ tokens });
    const { token } = ctx.tokens.issue(previewed());
    clock = 1000 + 2000;
    const res = await executePlace(ctx, token, { confirm: proceed, now: () => clock });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/expired/i);
    expect(
      readLog(ctx.config.auditLogPath).some((e) => e.event === 'place' && e.result === 'rejected'),
    ).toBe(true);
  });
});

describe('place_order — success path', () => {
  it('places via V2 with the token’s stable client_order_id + STP, audits ok, consumes token', async () => {
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
    const { token } = ctx.tokens.issue(previewed());
    const res = await executePlace(ctx, token, { confirm: proceed });

    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain('order_id=ORD123');
    expect(body).toEqual({
      ticker: 'KXBTCD',
      side: 'bid',
      price: '0.16',
      count: '10',
      time_in_force: 'good_till_canceled',
      client_order_id: 'COID-1',
      self_trade_prevention_type: 'taker_at_cross',
    });
    expect(readLog(ctx.config.auditLogPath).find((e) => e.result === 'ok')).toMatchObject({
      orderId: 'ORD123',
      clientOrderId: 'COID-1',
      costBasisCents: 160,
    });
    // token consumed
    expect(ctx.tokens.peek(token).ok).toBe(false);
  });

  it('does not double-audit or report failure when the fill field is malformed (render never throws)', async () => {
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders'))
        return { status: 200, json: { order_id: 'ORD9', fill_count_fp: 'oops' } };
      if (req.url.includes('/portfolio/positions')) return { status: 200, json: positions };
      return { status: 404, json: {} };
    };
    const ctx = makeCtx({ transport });
    const { token } = ctx.tokens.issue(previewed());
    const res = await executePlace(ctx, token, { confirm: proceed });
    expect(res.isError).toBeFalsy();
    const log = readLog(ctx.config.auditLogPath);
    expect(log.filter((e) => e.event === 'place')).toHaveLength(1);
    expect(log[0]?.result).toBe('ok');
  });

  it('does not report failure when the API returns a 200 with a null body (render is total)', async () => {
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders')) return { status: 200, json: null };
      if (req.url.includes('/portfolio/positions')) return { status: 200, json: positions };
      return { status: 404, json: {} };
    };
    const ctx = makeCtx({ transport });
    const { token } = ctx.tokens.issue(previewed());
    const res = await executePlace(ctx, token, { confirm: proceed });
    expect(res.isError).toBeFalsy(); // a null body must not turn a placed order into a reported failure
    expect(textOf(res)).toContain('order_id=(unknown)');
    const log = readLog(ctx.config.auditLogPath);
    expect(log.filter((e) => e.event === 'place')).toHaveLength(1);
    expect(log[0]?.result).toBe('ok');
  });

  it('still places when exposure is unreadable, noting the cap was skipped', async () => {
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders'))
        return { status: 200, json: { order_id: 'ORD123' } };
      if (req.url.includes('/portfolio/positions'))
        return { status: 500, json: { error: { message: 'boom' } } };
      return { status: 404, json: {} };
    };
    const ctx = makeCtx({ transport });
    const { token } = ctx.tokens.issue(previewed());
    const res = await executePlace(ctx, token, { confirm: proceed });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toMatch(/exposure cap not applied/i);
  });
});

describe('place_order — rejection paths', () => {
  it('aborts on a declined confirmation (no POST, audit rejected)', async () => {
    let posted = false;
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders')) posted = true;
      if (req.url.includes('/portfolio/positions')) return { status: 200, json: positions };
      return { status: 200, json: {} };
    };
    const ctx = makeCtx({ transport });
    const { token } = ctx.tokens.issue(previewed());
    const res = await executePlace(ctx, token, { confirm: decline });
    expect(res.isError).toBe(true);
    expect(posted).toBe(false);
    expect(readLog(ctx.config.auditLogPath).some((e) => e.result === 'rejected')).toBe(true);
  });

  it('re-checks caps and rejects an over-cap order without POSTing', async () => {
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
    const { token } = ctx.tokens.issue(previewed()); // $1.60 > $1
    const res = await executePlace(ctx, token, { confirm: proceed });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/MAX_ORDER_USD/);
    expect(posted).toBe(false);
  });

  it('a DEFINITE API rejection (4xx) burns the token and audits error', async () => {
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders'))
        return { status: 400, json: { error: { code: 'bad', message: 'price too aggressive' } } };
      if (req.url.includes('/portfolio/positions')) return { status: 200, json: positions };
      return { status: 404, json: {} };
    };
    const ctx = makeCtx({ transport });
    const { token } = ctx.tokens.issue(previewed());
    const res = await executePlace(ctx, token, { confirm: proceed });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/price too aggressive/);
    expect(ctx.tokens.peek(token).ok).toBe(false); // burned
    expect(readLog(ctx.config.auditLogPath).some((e) => e.result === 'error')).toBe(true);
  });
});

describe('place_order — idempotency on ambiguous failure', () => {
  it('keeps the token on a 5xx and a retry replays the SAME client_order_id', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let attempt = 0;
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders')) {
        bodies.push(JSON.parse(req.body as string));
        attempt += 1;
        return attempt === 1
          ? { status: 503, json: 'gateway error' }
          : { status: 200, json: { order_id: 'ORD-RETRY' } };
      }
      if (req.url.includes('/portfolio/positions')) return { status: 200, json: positions };
      return { status: 404, json: {} };
    };
    const ctx = makeCtx({ transport });
    const { token } = ctx.tokens.issue(previewed());

    const first = await executePlace(ctx, token, { confirm: proceed });
    expect(first.isError).toBe(true);
    expect(textOf(first)).toMatch(/retry|idempotent/i);
    expect(ctx.tokens.peek(token).ok).toBe(true); // token KEPT

    const second = await executePlace(ctx, token, { confirm: proceed });
    expect(second.isError).toBeFalsy();
    expect(textOf(second)).toContain('ORD-RETRY');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.client_order_id).toBe('COID-1');
    expect(bodies[1]?.client_order_id).toBe('COID-1'); // identical → exchange dedupes
  });
});

describe('place_order — daily-cap TOCTOU (mutex)', () => {
  it('serializes concurrent placements so the second sees the first and the daily cap holds', async () => {
    let posts = 0;
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders')) {
        posts += 1;
        return { status: 200, json: { order_id: `ORD${posts}` } };
      }
      if (req.url.includes('/portfolio/positions'))
        return { status: 200, json: { market_positions: [] } };
      return { status: 404, json: {} };
    };
    // maxDaily $2: one $1.60 order fits, two ($3.20) do not.
    let n = 0;
    const tokens = new TokenStore({ now: () => 1000, genId: () => `TKN${++n}` });
    const ctx = makeCtx({
      transport,
      tokens,
      caps: { maxOrderUsd: 25, maxDailyUsd: 2, maxOpenExposureUsd: 250, disableLimits: false },
    });
    const t1 = ctx.tokens.issue(previewed()).token;
    const t2 = ctx.tokens.issue(previewed()).token;

    const results = await Promise.all([
      executePlace(ctx, t1, { confirm: proceed }),
      executePlace(ctx, t2, { confirm: proceed }),
    ]);

    const oks = results.filter((r) => !r.isError);
    const rejected = results.filter((r) => r.isError);
    expect(oks).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(textOf(rejected[0]!)).toMatch(/MAX_DAILY_USD/);
    expect(posts).toBe(1); // only the first ever hit the exchange
    expect(readLog(ctx.config.auditLogPath).filter((e) => e.result === 'ok')).toHaveLength(1);
  });

  it('the daily cap still holds when the audit log is UNWRITABLE (in-memory ledger backstop)', async () => {
    let posts = 0;
    const transport: KalshiTransport = async (req) => {
      if (req.url.includes('/portfolio/events/orders')) {
        posts += 1;
        return { status: 200, json: { order_id: `ORD${posts}` } };
      }
      if (req.url.includes('/portfolio/positions'))
        return { status: 200, json: { market_positions: [] } };
      return { status: 404, json: {} };
    };
    let n = 0;
    const tokens = new TokenStore({ now: () => 1000, genId: () => `TKN${++n}` });
    // Unwritable path: appendAuditEntry fails (best-effort), so the cap can't rely on the log.
    const ctx = makeCtx({
      transport,
      tokens,
      auditLogPath: '/proc/hunch-nonexistent/audit.jsonl',
      caps: { maxOrderUsd: 25, maxDailyUsd: 2, maxOpenExposureUsd: 250, disableLimits: false },
    });
    const t1 = ctx.tokens.issue(previewed()).token;
    const t2 = ctx.tokens.issue(previewed()).token;

    const r1 = await executePlace(ctx, t1, { confirm: proceed });
    const r2 = await executePlace(ctx, t2, { confirm: proceed });
    expect(r1.isError).toBeFalsy();
    expect(r2.isError).toBe(true); // ledger remembers r1 even though the log couldn't be written
    expect(textOf(r2)).toMatch(/MAX_DAILY_USD/);
    expect(posts).toBe(1);
  });
});
