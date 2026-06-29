import { describe, it, expect } from 'vitest';
import { KalshiClient, type KalshiTransport } from '../src/kalshi/client.js';
import { testKey } from './helpers.js';

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';

function client(transport: KalshiTransport): KalshiClient {
  return new KalshiClient({
    baseUrl: DEMO_BASE,
    apiKeyId: 'k',
    privateKeyPem: testKey(),
    transport,
  });
}

describe('KalshiClient error mapping', () => {
  it('summarizes a non-JSON (HTML) error body instead of dumping it (no context bomb)', async () => {
    const html = `<html>${'x'.repeat(5000)}</html>`;
    const c = client(async () => ({ status: 503, json: html }));
    await expect(c.get('/portfolio/balance')).rejects.toThrow(/non-JSON response/);
    const err = await c.get('/portfolio/balance').catch((e) => (e as Error).message);
    expect(err.length).toBeLessThan(200);
    expect(err).not.toContain('xxxxxxxxxx');
  });

  it('caps an over-long JSON message', async () => {
    const c = client(async () => ({ status: 400, json: { error: { message: 'y'.repeat(1000) } } }));
    const err = await c.get('/x').catch((e) => (e as Error).message);
    expect(err.length).toBeLessThan(260);
    expect(err).toContain('…');
  });

  it('adds an actionable hint on 401 (key/clock) and 429 (back off)', async () => {
    const c401 = client(async () => ({
      status: 401,
      json: { error: { message: 'unauthorized' } },
    }));
    await expect(c401.get('/x')).rejects.toThrow(/clock|key/i);
    const c429 = client(async () => ({ status: 429, json: { error: { message: 'slow down' } } }));
    await expect(c429.get('/x')).rejects.toThrow(/rate limited|back off/i);
  });

  it('reports missing credentials clearly without hitting the network', async () => {
    let called = false;
    const c = new KalshiClient({
      baseUrl: DEMO_BASE,
      transport: async () => {
        called = true;
        return { status: 200, json: {} };
      },
    });
    await expect(c.get('/portfolio/balance')).rejects.toThrow(/credentials missing/i);
    expect(called).toBe(false);
  });
});
