/**
 * kalshi://market/{ticker} — an attachable, always-fresh market brief. Same payload
 * as get_market_brief, exposed as an MCP resource so a host can pin live market
 * state into the conversation.
 */
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import { fetchMarketBrief, renderBrief } from '../tools/get_market_brief.js';
import { toErrorMessage } from '../mcp/result.js';

export function register(server: McpServer, ctx: ServerContext): void {
  server.registerResource(
    'market',
    new ResourceTemplate('kalshi://market/{ticker}', { list: undefined }),
    {
      title: 'Kalshi market',
      description:
        'Live brief for one market: rules, YES/NO prices, order-book depth, recent trend.',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const raw = variables.ticker;
      const ticker = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
      try {
        const brief = await fetchMarketBrief(ctx.client, ticker);
        return {
          contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderBrief(brief) }],
        };
      } catch (err) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: toErrorMessage(err) }] };
      }
    },
  );
}
