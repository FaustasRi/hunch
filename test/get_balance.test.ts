import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { KalshiClient, type KalshiTransport } from '../src/kalshi/client.js';
import { fetchBalance, normalizeBalance } from '../src/tools/get_balance.js';

const balanceFixture = JSON.parse(
  readFileSync(new URL('./fixtures/balance.json', import.meta.url), 'utf8'),
);

function testKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
}

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';

describe('normalizeBalance', () => {
  it('maps cents to USD and derives total equity', () => {
    const b = normalizeBalance({ balance: 123456, portfolio_value: 7800 });
    expect(b.cashCents).toBe(123456);
    expect(b.cashUsd).toBe('1234.56');
    expect(b.portfolioValueUsd).toBe('78.00');
    expect(b.totalUsd).toBe('1312.56');
  });

  it('omits position value when the API does not return it', () => {
    const b = normalizeBalance({ balance: 5000 });
    expect(b.cashUsd).toBe('50.00');
    expect(b.portfolioValueUsd).toBeUndefined();
    expect(b.totalUsd).toBeUndefined();
  });
});

describe('fetchBalance', () => {
  it('GETs /portfolio/balance with signed auth headers and returns a typed balance', async () => {
    let seen: Parameters<KalshiTransport>[0] | undefined;
    const transport: KalshiTransport = async (req) => {
      seen = req;
      return { status: 200, json: balanceFixture };
    };
    const client = new KalshiClient({
      baseUrl: DEMO_BASE,
      apiKeyId: 'demo-key',
      privateKeyPem: testKey(),
      transport,
      now: () => 1700000000000,
    });

    const balance = await fetchBalance(client);
    expect(balance.cashUsd).toBe('1000.00'); // fixture: balance = 100000 cents

    expect(seen?.method).toBe('GET');
    expect(seen?.url).toBe(`${DEMO_BASE}/portfolio/balance`);
    expect(seen?.headers['KALSHI-ACCESS-KEY']).toBe('demo-key');
    expect(seen?.headers['KALSHI-ACCESS-TIMESTAMP']).toBe('1700000000000');
    expect(seen?.headers['KALSHI-ACCESS-SIGNATURE']).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('maps a non-2xx response to an actionable error', async () => {
    const transport: KalshiTransport = async () => ({
      status: 401,
      json: { error: { code: 'unauthorized', message: 'invalid signature' } },
    });
    const client = new KalshiClient({
      baseUrl: DEMO_BASE,
      apiKeyId: 'k',
      privateKeyPem: testKey(),
      transport,
    });
    await expect(fetchBalance(client)).rejects.toThrow(/401/);
    await expect(fetchBalance(client)).rejects.toThrow(/invalid signature/);
  });

  it('fails with a clear missing-credentials error when no key is configured', async () => {
    const transport: KalshiTransport = async () => ({ status: 200, json: balanceFixture });
    const client = new KalshiClient({ baseUrl: DEMO_BASE, transport });
    await expect(fetchBalance(client)).rejects.toThrow(/credentials missing/i);
  });
});
