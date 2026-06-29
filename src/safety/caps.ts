/**
 * Hard caps, enforced in code, measured as cost basis = max loss (ADR-0003).
 * Caps REJECT, never clamp: an over-cap order returns a clear violation and no
 * confirmation token is issued, so it cannot be placed. Caps apply in demo too.
 *
 * Pure math: callers supply the already-computed numbers (this order's cost, the
 * rolling-24h placed total, current open exposure). DISABLE_LIMITS removes the caps
 * but is only honored together with live mode (enforced in config, M7).
 */

export interface CapsConfig {
  maxOrderUsd: number;
  maxDailyUsd: number;
  maxOpenExposureUsd: number;
  disableLimits: boolean;
}

export interface CapInputs {
  /** This order's max loss, in cents. */
  costBasisCents: number;
  /** Sum of cost basis of orders PLACED in the last rolling 24h, in cents. */
  dailyPlacedCents: number;
  /** Current open exposure across positions, in cents. */
  openExposureCents: number;
}

export interface CapCheck {
  ok: boolean;
  violations: string[];
}

const usd = (cents: number): string => (cents / 100).toFixed(2);

export function checkCaps(input: CapInputs, caps: CapsConfig): CapCheck {
  if (caps.disableLimits) return { ok: true, violations: [] };

  const violations: string[] = [];

  if (input.costBasisCents > caps.maxOrderUsd * 100) {
    violations.push(
      `order cost $${usd(input.costBasisCents)} exceeds MAX_ORDER_USD=$${caps.maxOrderUsd}`,
    );
  }

  const dailyAfter = input.dailyPlacedCents + input.costBasisCents;
  if (dailyAfter > caps.maxDailyUsd * 100) {
    violations.push(
      `24h spend would reach $${usd(dailyAfter)}, over MAX_DAILY_USD=$${caps.maxDailyUsd} ` +
        `(already $${usd(input.dailyPlacedCents)} in the last 24h)`,
    );
  }

  const exposureAfter = input.openExposureCents + input.costBasisCents;
  if (exposureAfter > caps.maxOpenExposureUsd * 100) {
    violations.push(
      `open exposure would reach $${usd(exposureAfter)}, over MAX_OPEN_EXPOSURE_USD=$${caps.maxOpenExposureUsd}`,
    );
  }

  return { ok: violations.length === 0, violations };
}
