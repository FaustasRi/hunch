/**
 * /review-positions — walk the portfolio: positions, resting orders, exposure vs caps.
 * Suggests options; never auto-trades.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function register(server: McpServer): void {
  server.registerPrompt(
    'review-positions',
    {
      title: 'Review positions',
      description:
        'Review balance, open positions, and resting orders — flag risk, suggest options, do not auto-trade.',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Review my Kalshi portfolio.\n\n` +
              `1. Call get_balance, get_positions, and get_orders.\n` +
              `2. For each position: what it is betting, the current exposure, and whether the original thesis still ` +
              `looks right at today's price (use get_market_brief if useful).\n` +
              `3. Note any resting orders and whether they still make sense.\n` +
              `4. Flag concentration or exposure that is getting close to my caps.\n\n` +
              `Suggest options (hold, trim, add, cancel a resting order) with the trade-offs — but do not place or ` +
              `cancel anything yourself. I will decide and confirm each action.`,
          },
        },
      ],
    }),
  );
}
