import { describe, it, expect } from 'vitest';
import { KalshiClient } from '../src/kalshi/client.js';
import { TokenStore } from '../src/safety/token.js';
import { runPreview, buildPreview } from '../src/tools/preview_order.js';
import type { ServerContext } from '../src/context.js';
import type { Config } from '../src/config.js';
import { loadFixture, routeTransport, testKey } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const positions = loadFixture('positions.json');
const NO_AUDIT = '/no/such/__hunch_no_audit__.jsonl';

function makeCtx(opts: { withKey?: boolean } = {}): ServerContext {
  const withKey = opts.withKey ?? true;
  const config: Config = {
    env: 'demo',
    baseUrl: DEMO_BASE,
    apiKeyId: withKey ? 'k' : undefined,
    privateKeyPem: withKey ? testKey() : undefined,
    caps: { maxOrderUsd: 25, maxDailyUsd: 100, maxOpenExposureUsd: 250, disableLimits: false },
    allowSports: false,
    auditLogPath: NO_AUDIT,
  };
  const client = new KalshiClient({
    baseUrl: config.baseUrl,
    apiKeyId: config.apiKeyId,
    privateKeyPem: config.privateKeyPem,
    transport: routeTransport([{ match: '/portfolio/positions', json: positions }]),
  });
  return { config, client, tokens: new TokenStore({ now: () => 1000, genId: () => 'TESTTOKEN' }) };
}

describe('preview_order', () => {
  it('issues a token and renders the wire order for buy YES — no money moves', async () => {
    const ctx = makeCtx();
    const res = await runPreview(ctx, {
      ticker: 'KXBTCD',
      action: 'buy',
      side: 'yes',
      price: 16,
      count: 10,
      tif: 'limit',
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain('Confirmation token: TESTTOKEN');
    expect(text).toContain('side=bid price=$0.16 count=10 time_in_force=good_till_canceled');
    expect(text).toContain('Max loss (cost basis): $1.60');
    // the token really is in the shared store
    expect(ctx.tokens.consume('TESTTOKEN').ok).toBe(true);
  });

  it('mirrors buy NO onto the YES ask leg', async () => {
    const ctx = makeCtx();
    const res = await runPreview(ctx, {
      ticker: 'KXBTCD',
      action: 'buy',
      side: 'no',
      price: 30,
      count: 10,
      tif: 'limit',
    });
    expect((res.content[0] as { text: string }).text).toContain('side=ask price=$0.70');
  });

  it('REJECTS an over-cap order and issues NO token', async () => {
    const ctx = makeCtx();
    const res = await runPreview(ctx, {
      ticker: 'KXBTCD',
      action: 'buy',
      side: 'yes',
      price: 50,
      count: 1000,
      tif: 'limit',
    });
    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/MAX_ORDER_USD/);
    expect(text).toContain('No confirmation token issued');
    expect(ctx.tokens.consume('TESTTOKEN').ok).toBe(false);
  });

  it('still previews without a key (exposure cap best-effort)', async () => {
    const ctx = makeCtx({ withKey: false });
    const preview = await buildPreview(ctx, {
      ticker: 'KXBTCD',
      action: 'buy',
      side: 'yes',
      price: 16,
      count: 10,
      tif: 'limit',
    });
    expect(preview.caps.ok).toBe(true);
    expect(preview.openExposureCents).toBe(0);
    expect(preview.exposureNote).toMatch(/exposure unavailable/i);
  });
});
