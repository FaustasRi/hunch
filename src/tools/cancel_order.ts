/**
 * cancel_order — cancel one resting order via the V2 namespace (ADR-0004).
 * Destructive but risk-reducing; confirms via elicitation when available and audits
 * the outcome. Idempotent: cancelling an already-gone order is harmless.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import { cancelOrderV2 } from '../kalshi/orders.js';
import { appendAuditEntry, makeAuditEntry } from '../safety/audit.js';
import { serverConfirmer, type Confirmer } from '../safety/confirm.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';

export interface CancelDeps {
  confirm: Confirmer;
  now?: () => number;
}

export async function executeCancel(ctx: ServerContext, orderId: string, deps: CancelDeps) {
  const now = deps.now ?? Date.now;
  const path = ctx.config.auditLogPath;

  const decision = await deps.confirm(`Cancel order ${orderId} (${ctx.config.env})?`);
  if (!decision.proceed) {
    appendAuditEntry(
      path,
      makeAuditEntry(
        {
          event: 'cancel',
          env: ctx.config.env,
          result: 'rejected',
          orderId,
          error: `not confirmed: ${decision.reason}`,
        },
        now,
      ),
    );
    return errorResult(`Cancel aborted — ${decision.reason}.`);
  }

  try {
    const res = await cancelOrderV2(ctx.client, orderId);
    appendAuditEntry(
      path,
      makeAuditEntry({ event: 'cancel', env: ctx.config.env, result: 'ok', orderId }, now),
    );
    const removed = res.reduced_by ? `${res.reduced_by} contract(s)` : 'the remaining quantity';
    return textResult(`Cancelled order ${orderId} — removed ${removed}.`);
  } catch (err) {
    appendAuditEntry(
      path,
      makeAuditEntry(
        {
          event: 'cancel',
          env: ctx.config.env,
          result: 'error',
          orderId,
          error: toErrorMessage(err),
        },
        now,
      ),
    );
    return errorResult(`Cancel failed: ${toErrorMessage(err)}`);
  }
}

export function register(server: McpServer, ctx: ServerContext): void {
  const confirm = serverConfirmer(server);
  server.registerTool(
    'cancel_order',
    {
      title: 'Cancel an order',
      description:
        'Cancel one resting order by its order_id (Kalshi V2). Records the outcome to the audit log.',
      inputSchema: {
        order_id: z.string().min(1).describe('The order_id to cancel (from get_orders).'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_id }) => {
      try {
        return await executeCancel(ctx, order_id, { confirm });
      } catch (err) {
        return errorResult(toErrorMessage(err));
      }
    },
  );
}
