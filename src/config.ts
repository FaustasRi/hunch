/**
 * Runtime configuration. Loaded from env (and, for secrets, macOS Keychain).
 * Extended across checkpoints — see TODO markers and docs/PLAN.md.
 */

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
  /** PEM string. TODO(M1): load from KALSHI_PRIVATE_KEY | *_PATH | Keychain. */
  privateKeyPem: string | undefined;
  caps: Caps;
  allowSports: boolean;
  auditLogPath: string;
}

const DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const PROD_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

export function loadConfig(): Config {
  const env: KalshiEnv = process.env.KALSHI_ENV === 'live' ? 'live' : 'demo';

  // TODO(M1): resolve privateKeyPem from KALSHI_PRIVATE_KEY (inline),
  //   else KALSHI_PRIVATE_KEY_PATH (read file), else macOS Keychain.
  // TODO(M7): enforce that live requires apiKeyId + key present; surface a
  //   startup banner with env + active caps; gate sports behind allowSports.

  return {
    env,
    baseUrl: env === 'live' ? PROD_BASE : DEMO_BASE,
    apiKeyId: process.env.KALSHI_API_KEY_ID,
    privateKeyPem: undefined,
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

function numEnv(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
