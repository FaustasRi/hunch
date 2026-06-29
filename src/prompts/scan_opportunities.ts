/**
 * /scan-opportunities [query] — surface a few markets worth a look, with reasoning,
 * not a "buy this" list. The human picks what (if anything) to trade.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function register(server: McpServer): void {
  server.registerPrompt(
    'scan-opportunities',
    {
      title: 'Scan for opportunities',
      description:
        'Search open markets and reason about a few candidates — surfacing, not picking.',
      argsSchema: {
        query: z
          .string()
          .optional()
          .describe('Optional topic/text to focus the scan (e.g. "fed", "bitcoin").'),
      },
    },
    ({ query }) => {
      const focus = query ? ` Focus on markets related to "${query}".` : '';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Scan Kalshi for markets worth a closer look.${focus}\n\n` +
                `1. Use search_markets (status "open"${query ? `, query "${query}"` : ''}) to list candidates.\n` +
                `2. For the few most interesting, call get_market_brief and read the rules, price, and trend.\n` +
                `3. Surface any where the price looks like it diverges from a sensible base rate, or where a clear ` +
                `catalyst is coming — and explain the reasoning for each.\n\n` +
                `Present this as analysis I can act on, not a list of "buy these". You are surfacing; I decide what ` +
                `to trade and how much. Don't forget you may be miscalibrated, and fees + spread make this negative-sum.`,
            },
          },
        ],
      };
    },
  );
}
