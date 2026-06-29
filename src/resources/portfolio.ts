/**
 * kalshi://portfolio — an attachable snapshot composing cash balance + open
 * positions, so a host can pin the account state into a conversation. Authenticated
 * (needs a key); without one it returns an actionable message rather than failing hard.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import type { KalshiClient } from '../kalshi/client.js';
import type { KalshiEnv } from '../config.js';
import { fetchBalance, renderBalance, type AccountBalance } from '../tools/get_balance.js';
import { fetchPositions, renderPositions, type PositionView } from '../tools/get_positions.js';
import { toErrorMessage } from '../mcp/result.js';

export function renderPortfolio(
  balance: AccountBalance,
  positions: PositionView[],
  env: KalshiEnv,
): string {
  return [
    `Portfolio (${env})`,
    '',
    renderBalance(balance, env),
    '',
    renderPositions(positions),
  ].join('\n');
}

export async function fetchPortfolio(
  client: KalshiClient,
): Promise<{ balance: AccountBalance; positions: PositionView[] }> {
  const [balance, positions] = await Promise.all([fetchBalance(client), fetchPositions(client)]);
  return { balance, positions };
}

export function register(server: McpServer, ctx: ServerContext): void {
  server.registerResource(
    'portfolio',
    'kalshi://portfolio',
    {
      title: 'Kalshi portfolio',
      description: 'Account snapshot: cash balance, position value, and open positions.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      try {
        const { balance, positions } = await fetchPortfolio(ctx.client);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/markdown',
              text: renderPortfolio(balance, positions, ctx.config.env),
            },
          ],
        };
      } catch (err) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: toErrorMessage(err) }] };
      }
    },
  );
}
