/**
 * get_positions — your open positions with exposure and realized P&L. Read-only.
 * `position_fp` is signed: positive = long YES, negative = long NO. We surface only
 * non-zero positions (the "what am I holding" question); P&L is read off the
 * position, so no separate get_pnl tool (ADR-0005).
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import type { KalshiClient } from '../kalshi/client.js';
import type { KalshiMarketPosition, KalshiPositionsResponse } from '../kalshi/types.js';
import { parseFp } from '../kalshi/fixedpoint.js';
import { fmtDollars } from '../mcp/format.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';

export interface PositionView {
  ticker: string;
  /** Side held, derived from the sign of position_fp. */
  outcome: 'YES' | 'NO';
  contracts: number;
  exposureUsd: string | undefined;
  realizedPnlUsd: string | undefined;
}

export function normalizePositions(res: KalshiPositionsResponse): PositionView[] {
  return (res.market_positions ?? []).map(toPositionView).filter((v) => v.contracts !== 0);
}

function toPositionView(p: KalshiMarketPosition): PositionView {
  const signed = p.position_fp ? parseFp(p.position_fp) : 0;
  return {
    ticker: p.ticker,
    outcome: signed < 0 ? 'NO' : 'YES',
    contracts: Math.abs(signed),
    exposureUsd: p.market_exposure_dollars ? fmtDollars(p.market_exposure_dollars) : undefined,
    realizedPnlUsd: p.realized_pnl_dollars ? fmtDollars(p.realized_pnl_dollars) : undefined,
  };
}

export async function fetchPositions(
  client: KalshiClient,
  params: {
    ticker?: string | undefined;
    event_ticker?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
  } = {},
): Promise<PositionView[]> {
  const res = await client.get<KalshiPositionsResponse>('/portfolio/positions', {
    query: {
      ticker: params.ticker,
      event_ticker: params.event_ticker,
      limit: params.limit,
      cursor: params.cursor,
    },
  });
  return normalizePositions(res);
}

export function renderPositions(positions: PositionView[]): string {
  if (positions.length === 0) return 'No open positions.';
  const lines = positions.map((p) => {
    const exposure = p.exposureUsd !== undefined ? ` · exposure $${p.exposureUsd}` : '';
    const pnl = p.realizedPnlUsd !== undefined ? ` · realized P&L $${p.realizedPnlUsd}` : '';
    return `${p.ticker}  ${p.outcome} ${p.contracts}${exposure}${pnl}`;
  });
  return `${positions.length} open position(s):\n\n${lines.join('\n')}`;
}

export function register(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'get_positions',
    {
      title: 'Get open positions',
      description:
        'Your open Kalshi positions with contract count, market exposure, and realized ' +
        'P&L. Read-only. Long YES shows as YES; long NO as NO.',
      inputSchema: {
        ticker: z.string().optional().describe('Filter to one market ticker.'),
        event_ticker: z.string().optional().describe('Filter to one event.'),
        limit: z.number().int().min(1).max(1000).optional(),
        cursor: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return textResult(renderPositions(await fetchPositions(ctx.client, args)));
      } catch (err) {
        return errorResult(toErrorMessage(err));
      }
    },
  );
}
