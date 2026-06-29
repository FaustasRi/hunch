import { describe, it, expect } from 'vitest';
import { checkCaps, type CapsConfig } from '../src/safety/caps.js';

const caps: CapsConfig = {
  maxOrderUsd: 25,
  maxDailyUsd: 100,
  maxOpenExposureUsd: 250,
  disableLimits: false,
};

describe('checkCaps — reject, never clamp', () => {
  it('passes an order within all caps', () => {
    expect(
      checkCaps({ costBasisCents: 1600, dailyPlacedCents: 0, openExposureCents: 0 }, caps).ok,
    ).toBe(true);
  });

  it('rejects over MAX_ORDER_USD with a clear message (not clamped)', () => {
    const r = checkCaps({ costBasisCents: 4000, dailyPlacedCents: 0, openExposureCents: 0 }, caps);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/order cost \$40\.00 exceeds MAX_ORDER_USD=\$25/);
  });

  it('rejects when the rolling-24h spend would exceed MAX_DAILY_USD', () => {
    const r = checkCaps(
      { costBasisCents: 2000, dailyPlacedCents: 9000, openExposureCents: 0 },
      caps,
    );
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/MAX_DAILY_USD=\$100/);
  });

  it('rejects when exposure-after would exceed MAX_OPEN_EXPOSURE_USD', () => {
    const r = checkCaps(
      { costBasisCents: 2000, dailyPlacedCents: 0, openExposureCents: 24000 },
      caps,
    );
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/MAX_OPEN_EXPOSURE_USD=\$250/);
  });

  it('passes exactly at a cap boundary', () => {
    expect(
      checkCaps({ costBasisCents: 2500, dailyPlacedCents: 0, openExposureCents: 0 }, caps).ok,
    ).toBe(true);
  });

  it('DISABLE_LIMITS bypasses every cap', () => {
    const r = checkCaps(
      { costBasisCents: 9_999_999, dailyPlacedCents: 0, openExposureCents: 0 },
      { ...caps, disableLimits: true },
    );
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
});
