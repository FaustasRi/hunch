import { describe, it, expect } from 'vitest';
import { TokenStore, type PreviewedOrder } from '../src/safety/token.js';

const order: PreviewedOrder = {
  conversational: {
    ticker: 'T',
    action: 'buy',
    side: 'yes',
    priceCents: 16,
    count: 10,
    tif: 'limit',
  },
  v2: { ticker: 'T', side: 'bid', price: '0.16', count: '10', time_in_force: 'good_till_canceled' },
  costBasisCents: 160,
  env: 'demo',
};

describe('TokenStore', () => {
  it('issues a token that consumes back to the exact order — exactly once', () => {
    let n = 0;
    const store = new TokenStore({ now: () => 1000, genId: () => `tok-${++n}` });
    const { token, expiresAtMs } = store.issue(order);
    expect(token).toBe('tok-1');
    expect(expiresAtMs).toBe(1000 + 120_000);

    const first = store.consume(token);
    expect(first.ok).toBe(true);
    expect(first.ok && first.order.v2.price).toBe('0.16');

    // single-use: a second consume fails
    expect(store.consume(token).ok).toBe(false);
  });

  it('rejects an unknown token', () => {
    expect(new TokenStore().consume('nope').ok).toBe(false);
  });

  it('expires after its TTL', () => {
    let clock = 1000;
    const store = new TokenStore({ ttlMs: 5000, now: () => clock });
    const { token } = store.issue(order);
    clock = 1000 + 5001;
    const r = store.consume(token);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/expired/);
  });
});
