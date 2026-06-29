/**
 * Live demo integration — gated by KALSHI_DEMO_KEY so the build loop and CI never block
 * on a key (AGENTS.md). DEMO ONLY (asserts env==='demo'; never live, never real money).
 * The order test places a tiny 1¢ × 1 resting order and ALWAYS cancels it (finally
 * cancel_all), so no resting order is ever left behind.
 *
 * Run: KALSHI_DEMO_KEY=1 KALSHI_API_KEY_ID=... KALSHI_PRIVATE_KEY_PATH=... npx vitest run test/integration.demo.test.ts
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import type { KalshiMarketsResponse } from '../src/kalshi/types.js';
import { fetchBalance } from '../src/tools/get_balance.js';
import { fetchMarketBrief, renderBrief } from '../src/tools/get_market_brief.js';
import { fetchOrders } from '../src/tools/get_orders.js';
import { runPreview } from '../src/tools/preview_order.js';
import { executePlace } from '../src/tools/place_order.js';
import { executeCancel } from '../src/tools/cancel_order.js';
import { executeCancelAll } from '../src/tools/cancel_all_orders.js';
import type { ConfirmDecision } from '../src/safety/confirm.js';

const hasDemoKey = Boolean(process.env.KALSHI_DEMO_KEY);
const proceed = async (): Promise<ConfirmDecision> => ({ proceed: true, via: 'implicit' });
const textOf = (r: { content: Array<{ text?: string }> }): string => r.content[0]?.text ?? '';

describe('demo integration (gated by KALSHI_DEMO_KEY)', () => {
  it.skipIf(!hasDemoKey)(
    'reads the demo balance with real signing — places no order',
    async () => {
      const cfg = loadConfig();
      expect(cfg.env).toBe('demo'); // never live in tests
      const ctx = createContext(cfg);
      const balance = await fetchBalance(ctx.client);
      expect(typeof balance.cashCents).toBe('number');
    },
    30_000,
  );

  it.skipIf(!hasDemoKey)(
    'full lifecycle: brief → preview → place (1¢×1) → see it → cancel (always cleans up)',
    async () => {
      const cfg = loadConfig();
      expect(cfg.env).toBe('demo'); // hard guard: demo only
      const ctx = createContext(cfg);

      // Find an open market to trade against.
      const open = await ctx.client.get<KalshiMarketsResponse>('/markets', {
        authenticated: false,
        query: { status: 'open', limit: 1 },
      });
      const ticker = open.markets?.[0]?.ticker;
      expect(ticker, 'expected at least one open demo market').toBeTruthy();
      if (!ticker) return;

      try {
        // Brief renders without throwing on real (often illiquid) data.
        expect(renderBrief(await fetchMarketBrief(ctx.client, ticker))).toContain(ticker);

        // Preview a tiny resting buy YES at the 1¢ floor (won't fill), get a token.
        const preview = await runPreview(ctx, {
          ticker,
          action: 'buy',
          side: 'yes',
          price: 1,
          count: 1,
          tif: 'limit',
        });
        expect(preview.isError).toBeFalsy();
        const token = /Confirmation token: (\S+)/.exec(textOf(preview))?.[1];
        expect(token, 'preview should issue a token').toBeTruthy();

        // Place it.
        const placed = await executePlace(ctx, token!, { confirm: proceed });
        expect(placed.isError, textOf(placed)).toBeFalsy();
        const orderId = /order_id=(\S+)/.exec(textOf(placed))?.[1];
        expect(orderId).toBeTruthy();

        // It should appear among resting orders.
        const resting = await fetchOrders(ctx.client, { status: 'resting' });
        expect(resting.some((o) => o.orderId === orderId)).toBe(true);

        // Cancel it specifically.
        if (orderId && orderId !== '(unknown)') {
          const cancelled = await executeCancel(ctx, orderId, { confirm: proceed });
          expect(cancelled.isError, textOf(cancelled)).toBeFalsy();
        }
      } finally {
        // Safety net: never leave a resting order behind.
        await executeCancelAll(ctx, { confirm: proceed });
      }
    },
    60_000,
  );
});
