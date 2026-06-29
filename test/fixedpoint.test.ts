import { describe, it, expect } from 'vitest';
import {
  parseDollarString,
  centsToUsd,
  dollarStringToCents,
  parseFp,
  formatCount,
} from '../src/kalshi/fixedpoint.js';

describe('centsToUsd', () => {
  it('formats integer cents as a 2-decimal dollar string', () => {
    expect(centsToUsd(0)).toBe('0.00');
    expect(centsToUsd(1)).toBe('0.01');
    expect(centsToUsd(16)).toBe('0.16');
    expect(centsToUsd(99)).toBe('0.99');
    expect(centsToUsd(100)).toBe('1.00');
    expect(centsToUsd(250)).toBe('2.50');
  });
});

describe('dollarStringToCents', () => {
  it('parses dollar strings (any decimal width) to whole cents', () => {
    expect(dollarStringToCents('0.01')).toBe(1);
    expect(dollarStringToCents('0.16')).toBe(16);
    expect(dollarStringToCents('0.1600')).toBe(16);
    expect(dollarStringToCents('0.99')).toBe(99);
    expect(dollarStringToCents('1.00')).toBe(100);
  });
  it('rounds cleanly past float noise (0.29 → 29, not 28)', () => {
    expect(dollarStringToCents('0.29')).toBe(29);
    expect(dollarStringToCents('0.07')).toBe(7);
  });
});

describe('cents ↔ dollar-string round trip', () => {
  it('survives a round trip across the full 0–100¢ range incl. edges', () => {
    for (const c of [0, 1, 7, 16, 29, 50, 84, 99, 100]) {
      expect(dollarStringToCents(centsToUsd(c))).toBe(c);
    }
  });
});

describe('parseDollarString', () => {
  it('parses fixed-point dollars to a number', () => {
    expect(parseDollarString('0.16')).toBeCloseTo(0.16, 10);
    expect(parseDollarString('1.00')).toBe(1);
  });
  it('throws on garbage', () => {
    expect(() => parseDollarString('abc')).toThrow(/invalid fixed-point dollar string/);
  });
});

describe('parseFp / formatCount', () => {
  it('parses _fp count strings', () => {
    expect(parseFp('10.00')).toBe(10);
    expect(parseFp('1234')).toBe(1234);
    expect(parseFp('0.50')).toBe(0.5);
  });
  it('throws on garbage', () => {
    expect(() => parseFp('nope')).toThrow(/invalid fixed-point count string/);
  });
  it('formats whole counts without decimals and fractional with 2', () => {
    expect(formatCount(10)).toBe('10');
    expect(formatCount(1)).toBe('1');
    expect(formatCount(10.5)).toBe('10.50');
  });
});
