/**
 * get_balance — cash balance + open-position value for the active environment.
 * Read-only; moves no money. The pure core (`normalizeBalance`) and the fetch
 * (`fetchBalance`) are exported for unit tests against a mocked transport.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import type { KalshiClient } from '../kalshi/client.js';
import type { KalshiBalanceResponse } from '../kalshi/types.js';
import { centsToUsd } from '../kalshi/fixedpoint.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';

export interface AccountBalance {
  cashCents: number;
  cashUsd: string;
  /** Value of open positions, when the API returns it. */
  portfolioValueCents: number | undefined;
  portfolioValueUsd: string | undefined;
  /** Cash + position value, when position value is present. */
  totalUsd: string | undefined;
}

export function normalizeBalance(raw: KalshiBalanceResponse): AccountBalance {
  const cashCents = raw.balance;
  const balance: AccountBalance = {
    cashCents,
    cashUsd: centsToUsd(cashCents),
    portfolioValueCents: undefined,
    portfolioValueUsd: undefined,
    totalUsd: undefined,
  };
  if (typeof raw.portfolio_value === 'number') {
    balance.portfolioValueCents = raw.portfolio_value;
    balance.portfolioValueUsd = centsToUsd(raw.portfolio_value);
    balance.totalUsd = centsToUsd(cashCents + raw.portfolio_value);
  }
  return balance;
}

export async function fetchBalance(client: KalshiClient): Promise<AccountBalance> {
  const raw = await client.get<KalshiBalanceResponse>('/portfolio/balance');
  return normalizeBalance(raw);
}

function renderBalance(b: AccountBalance, env: string): string {
  const lines = [`Account balance (${env}):`, `  Cash available: $${b.cashUsd}`];
  if (b.portfolioValueUsd !== undefined && b.totalUsd !== undefined) {
    lines.push(`  Position value: $${b.portfolioValueUsd}`);
    lines.push(`  Total equity:   $${b.totalUsd}`);
  }
  return lines.join('\n');
}

export function register(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'get_balance',
    {
      title: 'Get account balance',
      description:
        'Returns your Kalshi cash balance and open-position value for the active ' +
        'environment (demo by default). Read-only; moves no money.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const balance = await fetchBalance(ctx.client);
        return textResult(renderBalance(balance, ctx.config.env));
      } catch (err) {
        return errorResult(toErrorMessage(err));
      }
    },
  );
}
