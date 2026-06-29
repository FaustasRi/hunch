import { describe, it, expect } from 'vitest';
import { startupBanner, caveats } from '../src/banner.js';
import type { Config } from '../src/config.js';

const demo: Config = {
  env: 'demo',
  baseUrl: 'https://demo-api.kalshi.co/trade-api/v2',
  apiKeyId: undefined,
  privateKeyPem: undefined,
  caps: { maxOrderUsd: 25, maxDailyUsd: 100, maxOpenExposureUsd: 250, disableLimits: false },
  allowSports: false,
  auditLogPath: './audit-log.jsonl',
};
const live: Config = {
  ...demo,
  env: 'live',
  baseUrl: 'https://api.elections.kalshi.com/trade-api/v2',
};

describe('startupBanner', () => {
  it('demo default states env + caps with no alarming caveats', () => {
    const b = startupBanner(demo);
    expect(b).toContain('env=demo');
    expect(b).toContain('demo-api.kalshi.co');
    expect(b).toContain('order $25');
    expect(b).not.toContain('REAL MONEY');
    expect(caveats(demo)).toEqual([]);
  });

  it('live surfaces real-money, jurisdiction, and sports-gated caveats', () => {
    const b = startupBanner(live);
    expect(b).toContain('env=live');
    expect(b).toContain('REAL MONEY');
    expect(b).toMatch(/Jurisdiction caveat/);
    expect(b).toMatch(/Sports markets are gated/);
  });

  it('warns when live lacks credentials, not when present', () => {
    expect(startupBanner(live)).toMatch(/live calls will fail/);
    expect(startupBanner({ ...live, apiKeyId: 'k', privateKeyPem: 'p' })).not.toMatch(
      /live calls will fail/,
    );
  });

  it('flags disabled limits loudly', () => {
    const c: Config = {
      ...live,
      apiKeyId: 'k',
      privateKeyPem: 'p',
      caps: { ...live.caps, disableLimits: true },
    };
    expect(startupBanner(c)).toMatch(/limits are DISABLED/);
  });

  it('never prints secrets', () => {
    const b = startupBanner({
      ...live,
      apiKeyId: 'SECRET-KEY-ID-123',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMIID...\n-----END PRIVATE KEY-----',
    });
    expect(b).not.toContain('SECRET-KEY-ID-123');
    expect(b).not.toContain('BEGIN PRIVATE KEY');
  });
});
