/**
 * place_order — the only path that commits money. Structurally gated (ADR-0003):
 *   1. requires a valid, unexpired confirmation token from preview_order (no token →
 *      no trade; raw orders are refused);
 *   2. re-runs the caps with fresh daily/exposure (defense in depth);
 *   3. confirms via elicitation when the host supports it (token gate otherwise);
 *   4. places via the V2 namespace ONLY, with a client_order_id for idempotent retry;
 *   5. writes an audit entry for the outcome.
 * It places the order BOUND TO THE TOKEN verbatim, so it cannot drift from the preview.
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import type {
  CreateOrderBody,
  CreateOrderV2Response,
  SelfTradePrevention,
} from '../kalshi/types.js';
import { createOrderV2 } from '../kalshi/orders.js';
import { fetchOpenExposureCents } from './get_positions.js';
import { checkCaps } from '../safety/caps.js';
import {
  readAuditEntries,
  sumPlacedCostWithin24hCents,
  appendAuditEntry,
  makeAuditEntry,
  type AuditEntry,
  type AuditResult,
} from '../safety/audit.js';
import type { PreviewedOrder } from '../safety/token.js';
import { serverConfirmer, type Confirmer } from '../safety/confirm.js';
import { parseFp } from '../kalshi/fixedpoint.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';

// Default self-trade prevention: cancel the taker leg if it would cross our own
// resting order (safest; a resting GTC order is unaffected). Required by V2 create.
const STP: SelfTradePrevention = 'taker_at_cross';

export interface PlaceDeps {
  confirm: Confirmer;
  genClientOrderId?: () => string;
  now?: () => number;
}

function auditFields(
  order: PreviewedOrder,
  result: AuditResult,
  extra: Partial<AuditEntry> = {},
): Omit<AuditEntry, 'ts'> {
  const c = order.conversational;
  return {
    event: 'place',
    env: order.env,
    result,
    ticker: c.ticker,
    action: c.action,
    side: c.side,
    priceCents: c.priceCents,
    count: c.count,
    costBasisCents: order.costBasisCents,
    rationale: order.rationale,
    ...extra,
  };
}

function confirmMessage(order: PreviewedOrder): string {
  const c = order.conversational;
  const cost = (order.costBasisCents / 100).toFixed(2);
  return (
    `Place ${order.env.toUpperCase()} order: ${c.action} ${c.side.toUpperCase()} ${c.priceCents}¢ ` +
    `×${c.count} on ${c.ticker} (max loss $${cost})?`
  );
}

function renderPlaced(
  order: PreviewedOrder,
  res: CreateOrderV2Response,
  clientOrderId: string,
  via: 'elicitation' | 'implicit',
): string {
  const c = order.conversational;
  const filled = res.fill_count_fp ? parseFp(res.fill_count_fp) : res.fill_count;
  const remaining = res.remaining_count_fp ? parseFp(res.remaining_count_fp) : res.remaining_count;
  const fillLine =
    filled !== undefined || remaining !== undefined
      ? ` filled ${filled ?? 0}, remaining ${remaining ?? '?'}.`
      : '';
  const confirmNote =
    via === 'elicitation' ? '' : ' (no host confirm dialog; preview token was the gate)';
  return (
    `Order placed (${order.env}): ${c.action} ${c.side.toUpperCase()} ${c.priceCents}¢ ×${c.count} on ${c.ticker}.\n` +
    `order_id=${res.order_id ?? '(unknown)'} client_order_id=${clientOrderId}.${fillLine}${confirmNote}`
  );
}

export async function executePlace(ctx: ServerContext, token: string, deps: PlaceDeps) {
  const now = deps.now ?? Date.now;
  const genClientOrderId = deps.genClientOrderId ?? randomUUID;
  const path = ctx.config.auditLogPath;

  // 1. Token gate — single-use; no/expired token → no trade.
  const consumed = ctx.tokens.consume(token);
  if (!consumed.ok) return errorResult(consumed.error);
  const order = consumed.order;

  // 2. Re-check caps with fresh daily spend + open exposure.
  const dailyPlacedCents = sumPlacedCostWithin24hCents(readAuditEntries(path), now());
  let openExposureCents = 0;
  try {
    openExposureCents = await fetchOpenExposureCents(ctx.client);
  } catch {
    // Best-effort; if exposure is unreadable we still enforce order + daily caps.
  }
  const caps = checkCaps(
    { costBasisCents: order.costBasisCents, dailyPlacedCents, openExposureCents },
    ctx.config.caps,
  );
  if (!caps.ok) {
    appendAuditEntry(
      path,
      makeAuditEntry(auditFields(order, 'rejected', { error: caps.violations.join('; ') }), now),
    );
    return errorResult(
      `Order REJECTED — caps exceeded:\n${caps.violations.map((v) => `  - ${v}`).join('\n')}`,
    );
  }

  // 3. Confirm (elicitation if supported; otherwise the token was the gate).
  const decision = await deps.confirm(confirmMessage(order));
  if (!decision.proceed) {
    appendAuditEntry(
      path,
      makeAuditEntry(
        auditFields(order, 'rejected', { error: `not confirmed: ${decision.reason}` }),
        now,
      ),
    );
    return errorResult(`Order not placed — ${decision.reason}.`);
  }

  // 4. Place via the V2 namespace only; idempotent via client_order_id.
  const clientOrderId = genClientOrderId();
  const body: CreateOrderBody = {
    ...order.v2,
    client_order_id: clientOrderId,
    self_trade_prevention_type: STP,
  };
  try {
    const res = await createOrderV2(ctx.client, body);
    appendAuditEntry(
      path,
      makeAuditEntry(auditFields(order, 'ok', { orderId: res.order_id, clientOrderId }), now),
    );
    return textResult(renderPlaced(order, res, clientOrderId, decision.via));
  } catch (err) {
    appendAuditEntry(
      path,
      makeAuditEntry(
        auditFields(order, 'error', { clientOrderId, error: toErrorMessage(err) }),
        now,
      ),
    );
    return errorResult(`Order placement failed: ${toErrorMessage(err)}`);
  }
}

export function register(server: McpServer, ctx: ServerContext): void {
  const confirm = serverConfirmer(server);
  server.registerTool(
    'place_order',
    {
      title: 'Place an order',
      description:
        'Execute an order previewed by preview_order. Requires the confirmation token ' +
        'it returned (a raw, un-previewed order is refused). Places the exact previewed ' +
        'order via the Kalshi V2 API, re-checks caps, and records it to the audit log. ' +
        'Demo by default — going live needs KALSHI_ENV=live plus a live key.',
      inputSchema: {
        token: z
          .string()
          .min(1)
          .describe('Confirmation token from preview_order (short-lived, single-use).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ token }) => {
      try {
        return await executePlace(ctx, token, { confirm });
      } catch (err) {
        return errorResult(toErrorMessage(err));
      }
    },
  );
}
