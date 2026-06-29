import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server.js';
import { signKalshiRequest } from '../src/kalshi/signing.js';
import { generateKeyPairSync } from 'node:crypto';

describe('server', () => {
  it('constructs without throwing', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});

describe('signing', () => {
  it('produces a base64 RSA-PSS signature over timestamp+method+path', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const sig = signKalshiRequest(pem, '1700000000000', 'GET', '/trade-api/v2/portfolio/balance');
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);
    // base64
    expect(sig).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});
