/**
 * get_orders — your resting / recent orders. Read-only, on the legacy GET
 * /portfolio/orders path (mutation never uses legacy — ADR-0004). Direction is read
 * from the canonical outcome_side (yes/no) + book_side (bid/ask), falling back to the
 * deprecated side/action. "Did it fill?" is folded in via fill_count_fp (no separate
 * fills tool — ADR-0005).
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import type { KalshiClient } from '../kalshi/client.js';
import type { KalshiOrder, KalshiOrdersResponse } from '../kalshi/types.js';
import { dollarStringToCents, parseFp } from '../kalshi/fixedpoint.js';
import { fmtCentsPrice } from '../mcp/format.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';

const STATUS = ['resting', 'canceled', 'executed'] as const;

export interface OrderView {
  orderId: string;
  ticker: string;
  /** undefined when the API returned neither canonical book_side nor deprecated action. */
  verb: 'buy' | 'sell' | undefined;
  outcome: 'YES' | 'NO' | undefined;
  type: string | undefined;
  priceCents: number | undefined;
  initial: number;
  filled: number;
  remaining: number;
  status: string | undefined;
}

export function normalizeOrder(o: KalshiOrder): OrderView {
  const bookSide =
    o.book_side ?? (o.action === 'sell' ? 'ask' : o.action === 'buy' ? 'bid' : undefined);
  const outcomeRaw = o.outcome_side ?? o.side;
  // Don't fabricate a direction — a mislabeled buy/sell or yes/no is dangerous.
  const outcome = outcomeRaw === 'no' ? 'NO' : outcomeRaw === 'yes' ? 'YES' : undefined;
  const verb = bookSide === 'ask' ? 'sell' : bookSide === 'bid' ? 'buy' : undefined;
  const priceStr =
    outcome === 'YES' ? o.yes_price_dollars : outcome === 'NO' ? o.no_price_dollars : undefined;
  return {
    orderId: o.order_id,
    ticker: o.ticker,
    verb,
    outcome,
    type: o.type,
    priceCents: priceStr ? dollarStringToCents(priceStr) : undefined,
    initial: o.initial_count_fp ? parseFp(o.initial_count_fp) : 0,
    filled: o.fill_count_fp ? parseFp(o.fill_count_fp) : 0,
    remaining: o.remaining_count_fp ? parseFp(o.remaining_count_fp) : 0,
    status: o.status,
  };
}

export async function fetchOrders(
  client: KalshiClient,
  params: {
    ticker?: string | undefined;
    status?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
  } = {},
): Promise<OrderView[]> {
  const res = await client.get<KalshiOrdersResponse>('/portfolio/orders', {
    query: {
      ticker: params.ticker,
      status: params.status,
      limit: params.limit,
      cursor: params.cursor,
    },
  });
  return (res.orders ?? []).map(normalizeOrder);
}

export function renderOrders(orders: OrderView[]): string {
  if (orders.length === 0) return 'No orders.';
  const lines = orders.map((o) => {
    const dir = `${o.verb ?? '?'} ${o.outcome ?? '?'}`;
    const price = o.priceCents !== undefined ? ` ${fmtCentsPrice(o.priceCents)}` : '';
    const type = o.type ? ` ${o.type}` : '';
    const status = o.status ? ` [${o.status}]` : '';
    return `${o.ticker}  ${dir}${type}${price} ×${o.initial}${status} filled ${o.filled}/${o.initial} · id ${o.orderId}`;
  });
  return `${orders.length} order(s):\n\n${lines.join('\n')}`;
}

export function register(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'get_orders',
    {
      title: 'Get orders',
      description:
        'Your resting and recent Kalshi orders with direction, price (cents), fill ' +
        'progress, and status (resting/canceled/executed). Read-only. Filter by ticker ' +
        'or status.',
      inputSchema: {
        ticker: z.string().min(1).optional().describe('Filter to one market ticker.'),
        status: z.enum(STATUS).optional().describe('Filter by order status.'),
        limit: z.number().int().min(1).max(1000).optional().describe('Page size (1–1000).'),
        cursor: z.string().optional().describe('Pagination cursor from a previous response.'),
      },

      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return textResult(renderOrders(await fetchOrders(ctx.client, args)));
      } catch (err) {
        return errorResult(toErrorMessage(err));
      }
    },
  );
}
