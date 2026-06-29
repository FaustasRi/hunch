/**
 * Kalshi RSA-PSS request signing — native node:crypto, no dependency.
 *
 * Algorithm: RSA-PSS, SHA-256, MGF1-SHA256, salt length = digest length.
 * Signed message = `${timestampMs}${METHOD}${path}`, where `path` INCLUDES the
 * `/trade-api/v2` prefix and EXCLUDES the query string.
 *
 * See docs/REFERENCES.md → "The RSA-PSS signer". This primitive is provided
 * complete; M1 wires it into the client and adds a verification test.
 */
import { sign as cryptoSign, constants } from 'node:crypto';

export interface KalshiAuthHeaders {
  'KALSHI-ACCESS-KEY': string;
  'KALSHI-ACCESS-TIMESTAMP': string;
  'KALSHI-ACCESS-SIGNATURE': string;
}

/** Returns the base64 RSA-PSS signature for one request. */
export function signKalshiRequest(
  privateKeyPem: string,
  timestampMs: string,
  method: string,
  path: string,
): string {
  const message = Buffer.from(timestampMs + method.toUpperCase() + path, 'utf8');
  // RSA-PSS, SHA-256. MGF1 defaults to the signature digest (SHA-256) in
  // OpenSSL, which is exactly Kalshi's requirement — no separate MGF1 option.
  const signature = cryptoSign('sha256', message, {
    key: privateKeyPem,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString('base64');
}

/** Builds the three KALSHI-ACCESS-* headers. `now` is injectable for tests. */
export function buildAuthHeaders(
  apiKeyId: string,
  privateKeyPem: string,
  method: string,
  path: string,
  now: () => number = Date.now,
): KalshiAuthHeaders {
  const timestampMs = now().toString();
  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-TIMESTAMP': timestampMs,
    'KALSHI-ACCESS-SIGNATURE': signKalshiRequest(privateKeyPem, timestampMs, method, path),
  };
}
