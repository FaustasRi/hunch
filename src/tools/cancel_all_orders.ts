/**
 * cancel_all_orders — the kill switch (ADR-0003). Lists resting orders (legacy GET
 * read) and cancels them in one V2 batch DELETE. Confirms via elicitation when
 * available and audits the outcome. No-op (and no confirm) when nothing is resting.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../context.js';
import { fetchOrders } from './get_orders.js';
import { batchCancelV2 } from '../kalshi/orders.js';
import { appendAuditEntry, makeAuditEntry } from '../safety/audit.js';
import { serverConfirmer, type Confirmer } from '../safety/confirm.js';
import { textResult, errorResult, toErrorMessage } from '../mcp/result.js';

export interface CancelAllDeps {
  confirm: Confirmer;
  now?: () => number;
}

export async function executeCancelAll(ctx: ServerContext, deps: CancelAllDeps) {
  const now = deps.now ?? Date.now;
  const path = ctx.config.auditLogPath;

  let resting;
  try {
    resting = await fetchOrders(ctx.client, { status: 'resting' });
  } catch (err) {
    return errorResult(`Could not list resting orders: ${toErrorMessage(err)}`);
  }
  if (resting.length === 0) return textResult('No resting orders to cancel.');

  const decision = await deps.confirm(
    `Kill switch: cancel ALL ${resting.length} resting order(s) in ${ctx.config.env}?`,
  );
  if (!decision.proceed) return errorResult(`Kill switch aborted — ${decision.reason}.`);

  const ids = resting.map((o) => o.orderId);
  try {
    const res = await batchCancelV2(ctx.client, ids);
    const cancelled = res.orders?.length ?? ids.length;
    appendAuditEntry(
      path,
      makeAuditEntry(
        { event: 'cancel_all', env: ctx.config.env, result: 'ok', count: cancelled },
        now,
      ),
    );
    return textResult(`Kill switch: cancelled ${cancelled} resting order(s).`);
  } catch (err) {
    appendAuditEntry(
      path,
      makeAuditEntry(
        {
          event: 'cancel_all',
          env: ctx.config.env,
          result: 'error',
          count: ids.length,
          error: toErrorMessage(err),
        },
        now,
      ),
    );
    return errorResult(`Batch cancel failed: ${toErrorMessage(err)}`);
  }
}

export function register(server: McpServer, ctx: ServerContext): void {
  const confirm = serverConfirmer(server);
  server.registerTool(
    'cancel_all_orders',
    {
      title: 'Cancel all orders (kill switch)',
      description:
        'Cancel every resting order in one batch (Kalshi V2). The safety kill switch. ' +
        'Records the outcome to the audit log.',
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        return await executeCancelAll(ctx, { confirm });
      } catch (err) {
        return errorResult(toErrorMessage(err));
      }
    },
  );
}
