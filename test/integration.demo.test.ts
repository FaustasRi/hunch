/**
 * Live demo integration — gated by KALSHI_DEMO_KEY so the build loop and CI never
 * block on a key (AGENTS.md). It is READ-ONLY: it validates real RSA-PSS signing and
 * connectivity against the demo host without placing any order. The place→cancel
 * demo smoke is the human's one-time manual step (docs/PLAN.md M5).
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { KalshiClient } from '../src/kalshi/client.js';
import { fetchBalance } from '../src/tools/get_balance.js';

const hasDemoKey = Boolean(process.env.KALSHI_DEMO_KEY);

describe('demo integration (gated by KALSHI_DEMO_KEY)', () => {
  it.skipIf(!hasDemoKey)('reads the demo balance with real signing — places no order', async () => {
    const cfg = loadConfig(); // defaults to demo; never live in tests
    expect(cfg.env).toBe('demo');
    const client = new KalshiClient({
      baseUrl: cfg.baseUrl,
      apiKeyId: cfg.apiKeyId,
      privateKeyPem: cfg.privateKeyPem,
    });
    const balance = await fetchBalance(client);
    expect(typeof balance.cashCents).toBe('number');
  });
});
