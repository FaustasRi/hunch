import { describe, it, expect } from 'vitest';
import { buildInstructions } from '../src/instructions.js';
import type { Config } from '../src/config.js';

const base: Config = {
  env: 'demo',
  baseUrl: 'https://demo-api.kalshi.co/trade-api/v2',
  apiKeyId: undefined,
  privateKeyPem: undefined,
  caps: { maxOrderUsd: 25, maxDailyUsd: 100, maxOpenExposureUsd: 250, disableLimits: false },
  allowSports: false,
  auditLogPath: './audit-log.jsonl',
};

describe('buildInstructions', () => {
  it('teaches the mechanics, the rails, and the miscalibration caveat', () => {
    const t = buildInstructions(base);
    expect(t).toContain('Price = probability');
    expect(t).toContain('preview_order');
    expect(t).toContain('place_order requires that token');
    expect(t).toContain('MAX_ORDER_USD=$25');
    expect(t).toContain('MAX_DAILY_USD=$100');
    expect(t).toMatch(/overconfident/);
    expect(t).toMatch(/do not recommend a position size/i);
    expect(t).toContain('DEMO');
  });

  it('reflects live mode and custom caps', () => {
    const t = buildInstructions({ ...base, env: 'live', caps: { ...base.caps, maxOrderUsd: 50 } });
    expect(t).toContain('REAL MONEY');
    expect(t).toContain('MAX_ORDER_USD=$50');
  });
});
