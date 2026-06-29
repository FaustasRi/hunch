/**
 * Confirmation tokens (ADR-0003). preview_order issues an opaque token bound to the
 * EXACT normalized order; place_order refuses without a valid, unexpired one and
 * places the stored order verbatim — so an un-previewed or drifted trade is
 * structurally impossible. Tokens are short-lived and single-use.
 *
 * Placement uses peek() → POST → remove(): the token is consumed (removed) only on a
 * resolved outcome. If a POST fails AMBIGUOUSLY (network/5xx — the order may have
 * reached the exchange), the token is KEPT so a retry replays the SAME client_order_id
 * (stored here at issue time) and Kalshi deduplicates — real idempotency, not a no-op.
 *
 * In-memory by design: one long-lived process; a token that doesn't survive a restart
 * is a feature. Clock + id generator are injectable for deterministic tests.
 */
import { randomUUID } from 'node:crypto';
import type { KalshiEnv } from '../config.js';
import type { ConversationalOrder, V2OrderRequest } from '../tools/translate.js';

export interface PreviewedOrder {
  conversational: ConversationalOrder;
  v2: V2OrderRequest;
  costBasisCents: number;
  env: KalshiEnv;
  /** Stable idempotency key, fixed at preview time so a retry replays the same order. */
  clientOrderId: string;
  /** Optional reasoning carried from preview into the placement audit entry. */
  rationale?: string | undefined;
}

export interface IssuedToken {
  token: string;
  expiresAtMs: number;
}

export type TokenLookup = { ok: true; order: PreviewedOrder } | { ok: false; error: string };

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

  /** Issue a token bound to this exact previewed order. Sweeps expired tokens first. */
  issue(order: PreviewedOrder): IssuedToken {
    this.sweep();
    const token = this.genId();
    const expiresAtMs = this.now() + this.ttlMs;
    this.records.set(token, { order, expiresAtMs });
    return { token, expiresAtMs };
  }

  /** Validate WITHOUT consuming. An expired token is removed and reported invalid. */
  peek(token: string): TokenLookup {
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
    return { ok: true, order: record.order };
  }

  /** Drop a token (call after a resolved placement: success or a definite rejection). */
  remove(token: string): void {
    this.records.delete(token);
  }

  /** Validate + consume in one step (single-use). Kept for callers that don't retry. */
  consume(token: string): TokenLookup {
    const result = this.peek(token);
    if (result.ok) this.records.delete(token);
    return result;
  }

  private sweep(): void {
    const cutoff = this.now();
    for (const [token, record] of this.records) {
      if (cutoff > record.expiresAtMs) this.records.delete(token);
    }
  }
}
