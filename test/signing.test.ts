import { describe, it, expect } from 'vitest';
import {
  generateKeyPairSync,
  verify as cryptoVerify,
  constants,
  type KeyObject,
} from 'node:crypto';
import { signKalshiRequest, buildAuthHeaders } from '../src/kalshi/signing.js';

function makeKeys(): { privatePem: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privatePem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), publicKey };
}

/** Verify an RSA-PSS/SHA-256 signature the same way Kalshi's server would. */
function verifySig(publicKey: KeyObject, message: string, sigB64: string): boolean {
  return cryptoVerify(
    'sha256',
    Buffer.from(message, 'utf8'),
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    },
    Buffer.from(sigB64, 'base64'),
  );
}

describe('signKalshiRequest', () => {
  it('produces a base64 RSA-PSS signature that verifies over timestamp+METHOD+path', () => {
    const { privatePem, publicKey } = makeKeys();
    const ts = '1700000000000';
    const path = '/trade-api/v2/portfolio/balance';
    const sig = signKalshiRequest(privatePem, ts, 'GET', path);
    expect(sig).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(verifySig(publicKey, ts + 'GET' + path, sig)).toBe(true);
  });

  it('does not verify against a different path, method, or timestamp', () => {
    const { privatePem, publicKey } = makeKeys();
    const ts = '1700000000000';
    const sig = signKalshiRequest(privatePem, ts, 'GET', '/trade-api/v2/portfolio/balance');
    expect(verifySig(publicKey, ts + 'GET' + '/trade-api/v2/portfolio/positions', sig)).toBe(false);
    expect(verifySig(publicKey, ts + 'POST' + '/trade-api/v2/portfolio/balance', sig)).toBe(false);
    expect(
      verifySig(publicKey, '1700000000001' + 'GET' + '/trade-api/v2/portfolio/balance', sig),
    ).toBe(false);
  });

  it('uppercases the method before signing', () => {
    const { privatePem, publicKey } = makeKeys();
    const ts = '1700000000000';
    const sig = signKalshiRequest(privatePem, ts, 'get', '/trade-api/v2/portfolio/balance');
    expect(verifySig(publicKey, ts + 'GET' + '/trade-api/v2/portfolio/balance', sig)).toBe(true);
  });
});

describe('buildAuthHeaders', () => {
  it('returns the three KALSHI-ACCESS-* headers with an injected clock + verifying signature', () => {
    const { privatePem, publicKey } = makeKeys();
    const headers = buildAuthHeaders(
      'key-abc',
      privatePem,
      'GET',
      '/trade-api/v2/portfolio/balance',
      () => 1700000000000,
    );
    expect(headers['KALSHI-ACCESS-KEY']).toBe('key-abc');
    expect(headers['KALSHI-ACCESS-TIMESTAMP']).toBe('1700000000000');
    expect(
      verifySig(
        publicKey,
        '1700000000000GET/trade-api/v2/portfolio/balance',
        headers['KALSHI-ACCESS-SIGNATURE'],
      ),
    ).toBe(true);
  });
});
