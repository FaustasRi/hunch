/**
 * Write confirmation (ADR-0003). If the host supports MCP elicitation, ask the user
 * to confirm the action; otherwise the preview→place token (for placements) / the
 * explicit tool call (for cancels) IS the gate. Critically: never hang and never
 * auto-execute silently. An elicitation transport error falls back to "proceed"
 * because the order was already explicitly previewed/requested — but an explicit
 * decline always aborts.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export type ConfirmDecision =
  { proceed: true; via: 'elicitation' | 'implicit' } | { proceed: false; reason: string };

export type Confirmer = (message: string) => Promise<ConfirmDecision>;

export async function confirmWrite(server: McpServer, message: string): Promise<ConfirmDecision> {
  let supportsElicitation = false;
  try {
    supportsElicitation = Boolean(server.server.getClientCapabilities()?.elicitation);
  } catch {
    supportsElicitation = false;
  }
  if (!supportsElicitation) return { proceed: true, via: 'implicit' };

  try {
    const result = await server.server.elicitInput(
      {
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: { type: 'boolean', description: 'Confirm and execute this action' },
          },
          required: ['confirm'],
        },
      },
      // Bound the wait so a host that advertises elicitation but never replies cannot
      // hang the tool call — on timeout we fall through to the catch (token/explicit gate).
      { timeout: 120_000 },
    );
    if (result.action === 'accept' && result.content?.confirm === true) {
      return { proceed: true, via: 'elicitation' };
    }
    return { proceed: false, reason: `not confirmed (${result.action})` };
  } catch {
    // Elicitation was advertised but failed at runtime — fall back to the gate.
    return { proceed: true, via: 'implicit' };
  }
}

/** Bind a confirmer to a server (the closure each write tool passes into its core). */
export function serverConfirmer(server: McpServer): Confirmer {
  return (message) => confirmWrite(server, message);
}
