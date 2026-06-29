/**
 * Startup banner — printed to STDERR at boot (stdout is the JSON-RPC channel).
 * It states the resolved environment and the active caps as the truth (not the raw
 * env vars), and raises the deliberate-act caveats: going live, uncapped limits,
 * sports legality. Never prints secrets.
 */
import type { Config } from './config.js';
import { hasCredentials } from './config.js';

function host(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** Lines warning about deliberate, higher-risk states. Empty in the safe default. */
export function caveats(config: Config): string[] {
  const lines: string[] = [];
  if (config.env === 'live') {
    lines.push('LIVE MODE — orders use REAL MONEY on your Kalshi account.');
    if (!hasCredentials(config)) {
      lines.push(
        '  • No API key + private key found: live calls will fail until both are provided.',
      );
    }
    lines.push(
      '  • Jurisdiction caveat: prediction-market (and especially sports) trading legality is ' +
        'US-state-dependent. You are responsible for compliance in your location.',
    );
    if (!config.allowSports) {
      lines.push(
        '  • Sports markets are NOT auto-blocked (ALLOW_SPORTS not set): per-market gating is ' +
          'not enforced in v1 — sports legality is your responsibility.',
      );
    }
  }
  if (config.caps.disableLimits) {
    lines.push('CAUTION: limits are DISABLED — no order/daily/exposure caps are enforced.');
  }
  return lines;
}

export function startupBanner(config: Config): string {
  const limits = config.caps.disableLimits
    ? 'DISABLED'
    : `order $${config.caps.maxOrderUsd} · daily $${config.caps.maxDailyUsd} · exposure $${config.caps.maxOpenExposureUsd}`;
  const lines = [
    `[hunch] env=${config.env} host=${host(config.baseUrl)}`,
    `[hunch] caps: ${limits}`,
    `[hunch] credentials: ${hasCredentials(config) ? 'present' : 'none (reads of public market data still work)'}`,
    ...caveats(config).map((c) => `[hunch] ${c}`),
  ];
  return lines.join('\n');
}
