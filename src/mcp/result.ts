/**
 * Shared helpers for shaping MCP tool results. Keeps the 9 tool files DRY and
 * makes every error surfaced to the model an actionable string (not a stack).
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** A successful tool result carrying a single human/LLM-readable text block. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

/** An error result. `isError: true` lets the host/model see it failed. */
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Extracts a clean message from any thrown value (Error → .message, else String). */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
