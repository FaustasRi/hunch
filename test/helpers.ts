/**
 * Test helpers: load JSON fixtures and build a routing MockKalshiTransport so the
 * Kalshi client can be exercised end-to-end without network or credentials.
 */
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import type { KalshiTransport, KalshiHttpResponse } from '../src/kalshi/client.js';

export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;
}

/** A throwaway RSA key so signed requests work in unit tests. */
export function testKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
}

export interface Route {
  /** First route whose substring is in the request URL wins (order specific→general). */
  match: string;
  json: unknown;
  status?: number;
}

/** Build a transport that routes by URL substring; unmatched URLs return 404. */
export function routeTransport(routes: Route[]): KalshiTransport {
  return async (req): Promise<KalshiHttpResponse> => {
    for (const route of routes) {
      if (req.url.includes(route.match)) return { status: route.status ?? 200, json: route.json };
    }
    return { status: 404, json: { error: { message: `unmocked: ${req.method} ${req.url}` } } };
  };
}
