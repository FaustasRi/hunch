/**
 * Confirmation tokens (ADR-0003). preview_order issues an opaque token bound to the
 * EXACT normalized order; place_order refuses without a valid, unexpired one and
 * places the stored order verbatim — so an un-previewed or drifted trade is
 * structurally impossible. Tokens are single-use and short-lived.
 *
 * In-memory by design: the MCP server is one long-lived process, and a token that
 * does not survive a restart is a feature (re-preview to reconfirm). The clock and
 * id generator are injectable for deterministic tests.
 */
import { randomUUID } from 'node:crypto';
import type { KalshiEnv } from '../config.js';
import type { ConversationalOrder, V2OrderRequest } from '../tools/translate.js';

export interface PreviewedOrder {
  conversational: ConversationalOrder;
  v2: V2OrderRequest;
  costBasisCents: number;
  env: KalshiEnv;
  /** Optional reasoning carried from preview into the placement audit entry. */
  rationale?: string | undefined;
}

export interface IssuedToken {
  token: string;
  expiresAtMs: number;
}

export type ConsumeResult = { ok: true; order: PreviewedOrder } | { ok: false; error: string };

const DEFAULT_TTL_MS = 120_000; // 2 minutes

export class TokenStore {
  private readonly records = new Map<string, { order: PreviewedOrder; expiresAtMs: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly genId: () => string;

  constructor(opts: { ttlMs?: number; now?: () => number; genId?: () => string } = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.genId = opts.genId ?? randomUUID;
  }

  get ttlSeconds(): number {
    return Math.round(this.ttlMs / 1000);
  }

  /** Issue a token bound to this exact previewed order. */
  issue(order: PreviewedOrder): IssuedToken {
    const token = this.genId();
    const expiresAtMs = this.now() + this.ttlMs;
    this.records.set(token, { order, expiresAtMs });
    return { token, expiresAtMs };
  }

  /** Validate + consume a token (single-use). Returns the bound order or a reason. */
  consume(token: string): ConsumeResult {
    const record = this.records.get(token);
    if (!record) {
      return {
        ok: false,
        error: 'invalid or unknown confirmation token — run preview_order first',
      };
    }
    if (this.now() > record.expiresAtMs) {
      this.records.delete(token);
      return { ok: false, error: 'confirmation token expired — run preview_order again' };
    }
    this.records.delete(token);
    return { ok: true, order: record.order };
  }
}
