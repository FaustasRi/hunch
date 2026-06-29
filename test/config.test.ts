import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, resolveDisableLimits } from '../src/config.js';

// loadConfig reads process.env; snapshot + restore the keys we touch.
const KEYS = [
  'KALSHI_ENV',
  'KALSHI_API_KEY_ID',
  'KALSHI_PRIVATE_KEY',
  'KALSHI_PRIVATE_KEY_PATH',
  'DISABLE_LIMITS',
  'MAX_ORDER_USD',
  'MAX_DAILY_USD',
  'MAX_OPEN_EXPOSURE_USD',
  'ALLOW_SPORTS',
  'AUDIT_LOG_PATH',
  'KALSHI_KEYCHAIN_SERVICE',
  'KALSHI_KEYCHAIN_ACCOUNT',
];
const ORIGINAL: Record<string, string | undefined> = {};
for (const k of KEYS) ORIGINAL[k] = process.env[k];

function reset(vars: Record<string, string> = {}): void {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}

afterEach(() => {
  for (const k of KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

describe('resolveDisableLimits — uncapping is the third act, live-only', () => {
  it('honors DISABLE_LIMITS only in live', () => {
    expect(resolveDisableLimits('demo', true)).toBe(false);
    expect(resolveDisableLimits('live', true)).toBe(true);
    expect(resolveDisableLimits('live', false)).toBe(false);
    expect(resolveDisableLimits('demo', false)).toBe(false);
  });
});

describe('loadConfig — gating matrix', () => {
  it('defaults to demo with caps enforced and no credentials', () => {
    reset();
    const c = loadConfig();
    expect(c.env).toBe('demo');
    expect(c.baseUrl).toContain('demo-api.kalshi.co');
    expect(c.caps.disableLimits).toBe(false);
    expect(c.caps.maxOrderUsd).toBe(25);
  });

  it('demo ignores DISABLE_LIMITS — caps still apply', () => {
    reset({ DISABLE_LIMITS: 'true' });
    expect(loadConfig().caps.disableLimits).toBe(false);
  });

  it('a key ALONE does not switch to live (the two-act gate)', () => {
    reset({ KALSHI_API_KEY_ID: 'k', KALSHI_PRIVATE_KEY: 'pem' });
    const c = loadConfig();
    expect(c.env).toBe('demo');
    expect(c.baseUrl).toContain('demo-api.kalshi.co');
  });

  it('live requires the env flag and points at prod', () => {
    reset({ KALSHI_ENV: 'live', KALSHI_API_KEY_ID: 'k', KALSHI_PRIVATE_KEY: 'pem' });
    const c = loadConfig();
    expect(c.env).toBe('live');
    expect(c.baseUrl).toContain('kalshi.com');
  });

  it('uncapping needs BOTH live and DISABLE_LIMITS (the third act)', () => {
    reset({
      KALSHI_ENV: 'live',
      DISABLE_LIMITS: 'true',
      KALSHI_API_KEY_ID: 'k',
      KALSHI_PRIVATE_KEY: 'pem',
    });
    expect(loadConfig().caps.disableLimits).toBe(true);
  });

  it('reads cap overrides from env', () => {
    reset({ MAX_ORDER_USD: '50', MAX_DAILY_USD: '200' });
    const c = loadConfig();
    expect(c.caps.maxOrderUsd).toBe(50);
    expect(c.caps.maxDailyUsd).toBe(200);
  });
});
