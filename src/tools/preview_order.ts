/**
 * preview_order — the read-only first half of the token-gated two-step (ADR-0003).
 * It translates the order, prices the worst-case cost (= max loss) and exposure-after,
 * runs the hard caps, and — only if they pass — issues an opaque confirmation token
 * bound to the exact normalized order. It moves NO money and places NO order; that is
 * place_order's job (M5), and it refuses without a token issued here.
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import { translateOrder, orderCostBasisCents, type ConversationalOrder } from './translate.js';
import { fetchOpenExposureCents } from './get_positions.js';
import { checkCaps, type CapCheck } from '../safety/caps.js';
import { readAuditEntries, sumPlacedCostWithin24hCents } from '../safety/audit.js';
import type { PreviewedOrder } from '../safety/token.js';
import { centsToUsd } from '../kalshi/fixedpoint.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';

const inputShape = {
  ticker: z.string().min(1).describe('Market ticker.'),
  action: z.enum(['buy', 'sell']).describe('buy or sell the named side.'),
  side: z.enum(['yes', 'no']).describe('Which outcome you are pricing.'),
  price: z
    .number()
    .int()
    .min(1)
    .max(99)
    .describe('Price in cents (= probability) of the named side.'),
  count: z.number().int().min(1).describe('Number of contracts.'),
  tif: z
    .enum(['limit', 'market'])
    .default('limit')
    .describe('limit = resting GTC (buy and walk away); market = immediate (IOC) at this price.'),
  rationale: z
    .string()
    .optional()
    .describe('Optional reasoning, recorded in the audit log when placed.'),
};

export interface PreviewArgs {
  ticker: string;
  action: 'buy' | 'sell';
  side: 'yes' | 'no';
  price: number;
  count: number;
  tif: 'limit' | 'market';
  rationale?: string | undefined;
}

export interface PreviewResult {
  previewed: PreviewedOrder;
  dailyPlacedCents: number;
  openExposureCents: number;
  exposureNote: string | undefined;
  caps: CapCheck;
}

/** Translate + price + cap-check, without issuing a token (the testable core). */
export async function buildPreview(
  ctx: ServerContext,
  args: PreviewArgs,
  now: () => number = Date.now,
): Promise<PreviewResult> {
  const conversational: ConversationalOrder = {
    ticker: args.ticker,
    action: args.action,
    side: args.side,
    priceCents: args.price,
    count: args.count,
    tif: args.tif,
  };
  const v2 = translateOrder(conversational);
  const costBasisCents = orderCostBasisCents(conversational);

  const dailyPlacedCents = sumPlacedCostWithin24hCents(
    readAuditEntries(ctx.config.auditLogPath),
    now(),
    ctx.config.env,
  );

  let openExposureCents = 0;
  let exposureNote: string | undefined;
  try {
    openExposureCents = await fetchOpenExposureCents(ctx.client);
  } catch (err) {
    // Best-effort: no key (or a read error) just means we cannot include live
    // exposure. The order/daily caps still apply, and placement needs a key anyway.
    exposureNote = `live exposure unavailable (${toErrorMessage(err)}); exposure cap not applied`;
  }

  const caps = checkCaps({ costBasisCents, dailyPlacedCents, openExposureCents }, ctx.config.caps);

  const previewed: PreviewedOrder = {
    conversational,
    v2,
    costBasisCents,
    env: ctx.config.env,
    // Fixed now so a retry of place_order (same token) replays the same id → idempotent.
    clientOrderId: randomUUID(),
    rationale: args.rationale,
  };
  return { previewed, dailyPlacedCents, openExposureCents, exposureNote, caps };
}

function renderReject(p: PreviewResult): string {
  return [
    'Order REJECTED — caps exceeded (orders are rejected, never silently shrunk):',
    ...p.caps.violations.map((v) => `  - ${v}`),
    'No confirmation token issued. Adjust size or price and preview again.',
  ].join('\n');
}

function renderPreview(p: PreviewResult, token: string, ttlSeconds: number): string {
  const o = p.previewed.conversational;
  const v2 = p.previewed.v2;
  const cost = centsToUsd(p.previewed.costBasisCents);
  const exposureAfter = centsToUsd(p.openExposureCents + p.previewed.costBasisCents);
  const dailyAfter = centsToUsd(p.dailyPlacedCents + p.previewed.costBasisCents);
  const lines = [
    `Preview (${p.previewed.env}): ${o.action} ${o.side.toUpperCase()} ${o.priceCents}¢ ×${o.count} on ${o.ticker}`,
    `Wire (V2 YES leg): side=${v2.side} price=$${v2.price} count=${v2.count} time_in_force=${v2.time_in_force}`,
    `Max loss (cost basis): $${cost}`,
    `Open exposure after: ~$${exposureAfter}` + (p.exposureNote ? `  (${p.exposureNote})` : ''),
    `24h spend after: $${dailyAfter}`,
    'Caps: OK',
    '',
    `Confirmation token: ${token}`,
    `Expires in ${ttlSeconds}s. To execute, call place_order with this token. No money moves until you do.`,
  ];
  return lines.join('\n');
}

/** Full tool behavior: preview, and on a clean cap check issue a token. */
export async function runPreview(ctx: ServerContext, args: PreviewArgs) {
  const preview = await buildPreview(ctx, args);
  if (!preview.caps.ok) return errorResult(renderReject(preview));
  const { token } = ctx.tokens.issue(preview.previewed);
  return textResult(renderPreview(preview, token, ctx.tokens.ttlSeconds));
}

export function register(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'preview_order',
    {
      title: 'Preview an order',
      description:
        'Dry-run an order: translates it to the Kalshi wire shape, computes worst-case ' +
        'cost (max loss) and exposure-after, runs the hard caps, and — if they pass — ' +
        'returns a short-lived confirmation token required by place_order. Read-only; ' +
        'moves no money. Price is the named side in cents (= probability).',
      inputSchema: inputShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return await runPreview(ctx, args);
      } catch (err) {
        return errorResult(toErrorMessage(err));
      }
    },
  );
}
