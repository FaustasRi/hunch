/**
 * place_order — the only path that commits money. Structurally gated (ADR-0003):
 *   1. requires a valid, unexpired confirmation token from preview_order (no token →
 *      no trade; raw orders are refused);
 *   2. the whole read-spend → cap-check → POST → audit sequence runs under a mutex, so
 *      concurrent placements can't both pass a near-limit daily cap (TOCTOU);
 *   3. re-runs caps with fresh, env-scoped daily spend + open exposure;
 *   4. confirms via elicitation when supported (token gate otherwise; never hangs);
 *   5. places via the V2 namespace ONLY with the token's stable client_order_id;
 *   6. consumes the token only on a RESOLVED outcome — an ambiguous POST failure keeps
 *      the token so a retry replays the same client_order_id and Kalshi deduplicates;
 *   7. writes an audit entry for every outcome (ok / rejected / error).
 * It places the order BOUND TO THE TOKEN verbatim, so it cannot drift from the preview.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import type {
  CreateOrderBody,
  CreateOrderV2Response,
  SelfTradePrevention,
} from '../kalshi/types.js';
import { createOrderV2 } from '../kalshi/orders.js';
import { KalshiApiError } from '../kalshi/client.js';
import { fetchOpenExposureCents } from './get_positions.js';
import { checkCaps } from '../safety/caps.js';
import {
  appendAuditEntry,
  makeAuditEntry,
  type AuditEntry,
  type AuditResult,
} from '../safety/audit.js';
import { dailyPlacedCents } from '../safety/ledger.js';
import type { PreviewedOrder } from '../safety/token.js';
import { serverConfirmer, type Confirmer } from '../safety/confirm.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';

// Required by V2 create. taker_at_cross cancels the taker leg if it would cross our own
// resting order (safest; a resting GTC order is unaffected).
const STP: SelfTradePrevention = 'taker_at_cross';

export interface PlaceDeps {
  confirm: Confirmer;
  now?: () => number;
}

/** A POST may have reached the exchange (network/5xx/429) → keep the token for an
 * idempotent retry. A definite client-side rejection (4xx, missing creds) → burn it. */
function isAmbiguousFailure(err: unknown): boolean {
  if (err instanceof KalshiApiError) return err.status === 429 || err.status >= 500;
  return true; // non-API error (e.g. network throw) — the request may have been sent
}

function safeFp(s: string | undefined): number | undefined {
  if (typeof s !== 'string' || s.length === 0) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
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
    clientOrderId: order.clientOrderId,
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
  via: 'elicitation' | 'implicit',
  exposureNote: string | undefined,
): string {
  const c = order.conversational;
  const filled = safeFp(res?.fill_count_fp) ?? res?.fill_count;
  const remaining = safeFp(res?.remaining_count_fp) ?? res?.remaining_count;
  const fillLine =
    filled !== undefined || remaining !== undefined
      ? ` filled ${filled ?? 0}, remaining ${remaining ?? '?'}.`
      : '';
  const confirmNote =
    via === 'elicitation' ? '' : ' (no host confirm dialog; preview token was the gate)';
  const expo = exposureNote ? `\nNote: ${exposureNote}` : '';
  return (
    `Order placed (${order.env}): ${c.action} ${c.side.toUpperCase()} ${c.priceCents}¢ ×${c.count} on ${c.ticker}.\n` +
    `order_id=${res?.order_id ?? '(unknown)'} client_order_id=${order.clientOrderId}.${fillLine}${confirmNote}${expo}`
  );
}

async function placeInner(ctx: ServerContext, token: string, deps: PlaceDeps) {
  const now = deps.now ?? Date.now;
  const path = ctx.config.auditLogPath;

  // 1. Token gate — validate WITHOUT consuming (so an ambiguous failure can retry).
  const peeked = ctx.tokens.peek(token);
  if (!peeked.ok) {
    appendAuditEntry(
      path,
      makeAuditEntry(
        { event: 'place', env: ctx.config.env, result: 'rejected', error: peeked.error },
        now,
      ),
    );
    return errorResult(peeked.error);
  }
  const order = peeked.order;

  // 2. Re-check caps with fresh, env-scoped daily spend (audit log + in-memory ledger,
  //    so the cap holds even if the audit log can't be written) + open exposure.
  const daily = dailyPlacedCents(path, ctx.dailyLedger, now(), ctx.config.env);
  let openExposureCents = 0;
  let exposureNote: string | undefined;
  try {
    openExposureCents = await fetchOpenExposureCents(ctx.client);
  } catch (err) {
    exposureNote = `exposure cap not applied — positions unavailable (${toErrorMessage(err)})`;
  }
  const caps = checkCaps(
    { costBasisCents: order.costBasisCents, dailyPlacedCents: daily, openExposureCents },
    ctx.config.caps,
  );
  if (!caps.ok) {
    ctx.tokens.remove(token); // a capped order shouldn't be retryable as-is
    appendAuditEntry(
      path,
      makeAuditEntry(
        auditFields(order, 'rejected', { error: caps.violations.join('; '), note: exposureNote }),
        now,
      ),
    );
    return errorResult(
      `Order REJECTED — caps exceeded:\n${caps.violations.map((v) => `  - ${v}`).join('\n')}`,
    );
  }

  // 3. Confirm (elicitation if supported; otherwise the token was the gate).
  const decision = await deps.confirm(confirmMessage(order));
  if (!decision.proceed) {
    ctx.tokens.remove(token);
    appendAuditEntry(
      path,
      makeAuditEntry(
        auditFields(order, 'rejected', { error: `not confirmed: ${decision.reason}` }),
        now,
      ),
    );
    return errorResult(`Order not placed — ${decision.reason}.`);
  }

  // 4. Place via the V2 namespace only, with the token's stable client_order_id.
  const body: CreateOrderBody = {
    ...order.v2,
    client_order_id: order.clientOrderId,
    self_trade_prevention_type: STP,
  };
  let res: CreateOrderV2Response;
  try {
    res = await createOrderV2(ctx.client, body);
  } catch (err) {
    if (isAmbiguousFailure(err)) {
      // Keep the token: the order MAY have landed; a retry replays the same id.
      appendAuditEntry(
        path,
        makeAuditEntry(
          auditFields(order, 'error', { error: `ambiguous: ${toErrorMessage(err)}` }),
          now,
        ),
      );
      return errorResult(
        `Order may not have been placed (${toErrorMessage(err)}). It MAY have reached the exchange — ` +
          `check get_orders. You can retry place_order with the SAME token; the client_order_id makes the retry idempotent.`,
      );
    }
    ctx.tokens.remove(token); // definite rejection — burn it
    appendAuditEntry(
      path,
      makeAuditEntry(auditFields(order, 'error', { error: toErrorMessage(err) }), now),
    );
    // "not placed" (not "rejected by Kalshi") — covers definite 4xx AND missing creds,
    // which never reached the exchange.
    return errorResult(`Order not placed: ${toErrorMessage(err)}`);
  }

  // 5. Success — consume the token, record the spend in-memory (cap backstop), audit ok,
  //    then render (render never throws, even on a null/odd response body).
  ctx.tokens.remove(token);
  ctx.dailyLedger.record({
    tsMs: now(),
    costCents: order.costBasisCents,
    clientOrderId: order.clientOrderId,
    env: order.env,
  });
  appendAuditEntry(
    path,
    makeAuditEntry(auditFields(order, 'ok', { orderId: res?.order_id, note: exposureNote }), now),
  );
  return textResult(renderPlaced(order, res, decision.via, exposureNote));
}

export function executePlace(ctx: ServerContext, token: string, deps: PlaceDeps) {
  // Serialize placement so concurrent calls can't both pass a near-limit daily cap.
  return ctx.placeLock.run(() => placeInner(ctx, token, deps));
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
      // Money-committing → destructive, so hosts that highlight destructive actions flag it.
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
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
