/**
 * /analyze-market <ticker> — a conversation starter that grounds the model in the
 * actual market data before it opines, and explicitly keeps sizing with the human.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function register(server: McpServer): void {
  server.registerPrompt(
    'analyze-market',
    {
      title: 'Analyze a market',
      description:
        'Pull the brief for a market and reason about what it is pricing — without recommending a size.',
      argsSchema: {
        ticker: z.string().min(1).describe('Market ticker, e.g. KXBTCD-25JAN0117-T103000'),
      },
    },
    ({ ticker }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Analyze the Kalshi market ${ticker}.\n\n` +
              `1. Call get_market_brief for ${ticker} to get the rules, YES/NO prices, order-book depth, and recent trend.\n` +
              `2. State plainly what the market resolves on and what the current price implies as a probability.\n` +
              `3. Compare that to a base rate and any news worth checking. Note the spread and liquidity.\n` +
              `4. Give your honest read on whether the price looks rich, cheap, or fair — and how confident you are.\n\n` +
              `Do NOT recommend a position size or tell me to buy/sell — that decision is mine. Remember the price ` +
              `already is the market's probability, and LLMs tend to be overconfident on exactly these calls.`,
          },
        },
      ],
    }),
  );
}
