import { describe, it, expect } from 'vitest';
import {
  translateOrder,
  orderCostBasisCents,
  type ConversationalOrder,
} from '../src/tools/translate.js';

function order(partial: Partial<ConversationalOrder>): ConversationalOrder {
  return {
    ticker: 'T',
    action: 'buy',
    side: 'yes',
    priceCents: 30,
    count: 10,
    tif: 'limit',
    ...partial,
  };
}

describe('translateOrder — YES-leg-only truth table (all 8 combinations)', () => {
  const cases = [
    {
      action: 'buy',
      side: 'yes',
      tif: 'limit',
      book: 'bid',
      price: '0.30',
      wireTif: 'good_till_canceled',
    },
    {
      action: 'sell',
      side: 'yes',
      tif: 'limit',
      book: 'ask',
      price: '0.30',
      wireTif: 'good_till_canceled',
    },
    // NO → opposite leg, price mirrored (30¢ NO ⇒ 70¢ YES leg)
    {
      action: 'buy',
      side: 'no',
      tif: 'limit',
      book: 'ask',
      price: '0.70',
      wireTif: 'good_till_canceled',
    },
    {
      action: 'sell',
      side: 'no',
      tif: 'limit',
      book: 'bid',
      price: '0.70',
      wireTif: 'good_till_canceled',
    },
    {
      action: 'buy',
      side: 'yes',
      tif: 'market',
      book: 'bid',
      price: '0.30',
      wireTif: 'immediate_or_cancel',
    },
    {
      action: 'sell',
      side: 'yes',
      tif: 'market',
      book: 'ask',
      price: '0.30',
      wireTif: 'immediate_or_cancel',
    },
    {
      action: 'buy',
      side: 'no',
      tif: 'market',
      book: 'ask',
      price: '0.70',
      wireTif: 'immediate_or_cancel',
    },
    {
      action: 'sell',
      side: 'no',
      tif: 'market',
      book: 'bid',
      price: '0.70',
      wireTif: 'immediate_or_cancel',
    },
  ] as const;

  for (const c of cases) {
    it(`${c.action} ${c.side} ${c.tif} → ${c.book} @ ${c.price} (${c.wireTif})`, () => {
      const v2 = translateOrder(order({ action: c.action, side: c.side, tif: c.tif }));
      expect(v2.side).toBe(c.book);
      expect(v2.price).toBe(c.price);
      expect(v2.time_in_force).toBe(c.wireTif);
      expect(v2.count).toBe('10');
      expect(v2.ticker).toBe('T');
    });
  }
});

describe('orderCostBasisCents — max loss', () => {
  it('buy: you pay the named side price × count', () => {
    expect(
      orderCostBasisCents(order({ action: 'buy', side: 'yes', priceCents: 16, count: 10 })),
    ).toBe(160);
    expect(
      orderCostBasisCents(order({ action: 'buy', side: 'no', priceCents: 30, count: 10 })),
    ).toBe(300);
  });
  it('sell: you risk the complement × count (conservative opening risk)', () => {
    expect(
      orderCostBasisCents(order({ action: 'sell', side: 'yes', priceCents: 30, count: 10 })),
    ).toBe(700);
    expect(
      orderCostBasisCents(order({ action: 'sell', side: 'no', priceCents: 30, count: 10 })),
    ).toBe(700);
  });
});

describe('translateOrder — input guards', () => {
  it('rejects prices outside 1–99¢', () => {
    expect(() => translateOrder(order({ priceCents: 0 }))).toThrow(/1–99/);
    expect(() => translateOrder(order({ priceCents: 100 }))).toThrow(/1–99/);
  });
  it('rejects non-positive or fractional counts', () => {
    expect(() => translateOrder(order({ count: 0 }))).toThrow(/≥ 1/);
    expect(() => translateOrder(order({ count: 2.5 }))).toThrow(/≥ 1/);
  });
});
