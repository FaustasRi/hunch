/**
 * Runtime configuration. Loaded from env (and, for the RSA private key, macOS
 * Keychain as a fallback). Secrets never come from committed files — see AGENTS.md.
 * Extended across checkpoints (M7 adds the live-mode gating + startup banner).
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export type KalshiEnv = 'demo' | 'live';

export interface Caps {
  maxOrderUsd: number;
  maxDailyUsd: number;
  maxOpenExposureUsd: number;
  /** Only honored together with KALSHI_ENV=live (a third conscious act). */
  disableLimits: boolean;
}

export interface Config {
  env: KalshiEnv;
  baseUrl: string;
  apiKeyId: string | undefined;
  /** PEM string resolved from KALSHI_PRIVATE_KEY | *_PATH | macOS Keychain. */
  privateKeyPem: string | undefined;
  caps: Caps;
  allowSports: boolean;
  auditLogPath: string;
}

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const PROD_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

export function loadConfig(): Config {
  const env: KalshiEnv = process.env.KALSHI_ENV === 'live' ? 'live' : 'demo';

  // TODO(M7): enforce that live requires apiKeyId + key present; surface a
  //   startup banner with env + active caps; gate sports behind allowSports.

  return {
    env,
    baseUrl: env === 'live' ? PROD_BASE : DEMO_BASE,
    apiKeyId: process.env.KALSHI_API_KEY_ID,
    privateKeyPem: loadPrivateKeyPem(),
    caps: {
      maxOrderUsd: numEnv(process.env.MAX_ORDER_USD, 25),
      maxDailyUsd: numEnv(process.env.MAX_DAILY_USD, 100),
      maxOpenExposureUsd: numEnv(process.env.MAX_OPEN_EXPOSURE_USD, 250),
      disableLimits: process.env.DISABLE_LIMITS === 'true',
    },
    allowSports: process.env.ALLOW_SPORTS === 'true',
    auditLogPath: process.env.AUDIT_LOG_PATH ?? './audit-log.jsonl',
  };
}

/**
 * Resolve the RSA private key PEM, in priority order:
 *   1. KALSHI_PRIVATE_KEY (inline PEM; `\n` escapes are unescaped)
 *   2. KALSHI_PRIVATE_KEY_PATH (read the file)
 *   3. macOS Keychain (best-effort; absent off-mac or when not stored)
 * Returns undefined if none resolve — the server still boots; an authenticated
 * call then fails with an actionable "credentials missing" error.
 */
function loadPrivateKeyPem(): string | undefined {
  const inline = process.env.KALSHI_PRIVATE_KEY;
  if (inline && inline.trim()) return normalizePem(inline);

  const keyPath = process.env.KALSHI_PRIVATE_KEY_PATH;
  if (keyPath) {
    try {
      return readFileSync(keyPath, 'utf8');
    } catch {
      // Misconfigured path — warn on stderr (never stdout) and fall through.
      console.error(`[hunch] KALSHI_PRIVATE_KEY_PATH is set but unreadable: ${keyPath}`);
    }
  }

  const service = process.env.KALSHI_KEYCHAIN_SERVICE ?? 'hunch-kalshi-private-key';
  const account = process.env.KALSHI_KEYCHAIN_ACCOUNT ?? process.env.KALSHI_API_KEY_ID;
  if (account) {
    try {
      const pem = execFileSync(
        'security',
        ['find-generic-password', '-w', '-s', service, '-a', account],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      if (pem.trim()) return normalizePem(pem);
    } catch {
      // Not found, or not macOS — fine; stay undefined.
    }
  }

  return undefined;
}

/** Inline env PEMs are often single-line with literal `\n`; restore real newlines. */
function normalizePem(pem: string): string {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

function numEnv(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
