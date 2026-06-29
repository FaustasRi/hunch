/**
 * Thin, typed Kalshi REST client.
 *
 * - Signs authenticated requests (RSA-PSS) and assembles the KALSHI-ACCESS-* headers.
 * - The base URL (demo vs prod) is chosen in config; this client just uses it.
 * - HTTP is injected via a `transport` so unit tests run fully mocked — no network,
 *   no real key, never blocking on a Kalshi credential (see AGENTS.md hard rules).
 * - NEVER logs secrets: it does not log requests at all. Errors are mapped to
 *   actionable strings that never include the signature or key.
 */
import { buildAuthHeaders } from './signing.js';

export interface KalshiHttpResponse {
  status: number;
  /** Parsed JSON body (or the raw string if not JSON; undefined for empty bodies). */
  json: unknown;
}

/** The single HTTP seam. Default uses global fetch; tests inject a mock. */
export type KalshiTransport = (req: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}) => Promise<KalshiHttpResponse>;

export interface KalshiClientOptions {
  baseUrl: string;
  apiKeyId?: string | undefined;
  privateKeyPem?: string | undefined;
  transport?: KalshiTransport;
  /** Injectable clock for deterministic signing in tests. */
  now?: () => number;
}

export interface KalshiRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /**
   * Authenticated calls (portfolio, orders) are signed and require credentials.
   * Defaults to true. Public market-data reads pass `false` so the server is
   * usable with zero credentials (browse markets before setting up a key).
   */
  authenticated?: boolean;
}

/** Thrown for missing credentials or any non-2xx response; message is model-actionable. */
export class KalshiApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'KalshiApiError';
  }
}

export class KalshiClient {
  readonly baseUrl: string;
  private readonly apiKeyId: string | undefined;
  private readonly privateKeyPem: string | undefined;
  private readonly transport: KalshiTransport;
  private readonly now: () => number;

  constructor(opts: KalshiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKeyId = opts.apiKeyId;
    this.privateKeyPem = opts.privateKeyPem;
    this.transport = opts.transport ?? fetchTransport;
    this.now = opts.now ?? Date.now;
  }

  /** True when both an API key id and a private key are present. */
  hasCredentials(): boolean {
    return Boolean(this.apiKeyId && this.privateKeyPem);
  }

  get<T>(path: string, opts: Omit<KalshiRequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('GET', path, opts);
  }

  post<T>(path: string, body: unknown, opts: Omit<KalshiRequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('POST', path, { ...opts, body });
  }

  delete<T>(path: string, opts: KalshiRequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, opts);
  }

  private async request<T>(method: string, path: string, opts: KalshiRequestOptions): Promise<T> {
    const authenticated = opts.authenticated ?? true;
    // The signed path INCLUDES /trade-api/v2 and EXCLUDES the query string.
    const signedPath = new URL(this.baseUrl + path).pathname;
    const url = this.baseUrl + path + buildQuery(opts.query);

    const headers: Record<string, string> = { Accept: 'application/json' };
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    if (authenticated) {
      if (!this.apiKeyId || !this.privateKeyPem) {
        throw new KalshiApiError(
          0,
          'Kalshi credentials missing: set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY ' +
            '(or KALSHI_PRIVATE_KEY_PATH). Demo keys are created at demo.kalshi.co.',
        );
      }
      Object.assign(
        headers,
        buildAuthHeaders(this.apiKeyId, this.privateKeyPem, method, signedPath, this.now),
      );
    }

    const res = await this.transport({ url, method, headers, body });
    if (res.status < 200 || res.status >= 300) {
      throw new KalshiApiError(res.status, formatApiError(res, method, signedPath));
    }
    return res.json as T;
  }
}

function buildQuery(query: KalshiRequestOptions['query']): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

const MAX_DETAIL_LEN = 200;

function formatApiError(res: KalshiHttpResponse, method: string, path: string): string {
  const detail = extractErrorMessage(res.json);
  const base = `Kalshi API ${res.status} on ${method} ${path}`;
  const hint = statusHint(res.status);
  return [detail ? `${base}: ${detail}` : base, hint].filter(Boolean).join(' ');
}

/** A short, actionable nudge for the common failure statuses. */
function statusHint(status: number): string {
  if (status === 401 || status === 403)
    return '(check the API key id + private key, and that your clock is correct — signatures are time-sensitive.)';
  if (status === 429) return '(rate limited — back off and retry.)';
  if (status >= 500) return '(Kalshi-side error — retry shortly.)';
  return '';
}

/**
 * Pull a message out of Kalshi's `{ error: { code, message } }` or `{ message }` shapes.
 * A non-JSON body (e.g. an HTML gateway page on a 5xx) is summarized, never dumped — an
 * unbounded body would be useless to the model and a context-budget bomb.
 */
function extractErrorMessage(json: unknown): string | undefined {
  if (typeof json === 'string') return summarizeNonJson(json);
  if (!json || typeof json !== 'object') return undefined;
  const obj = json as Record<string, unknown>;
  if (obj.error && typeof obj.error === 'object') {
    const err = obj.error as Record<string, unknown>;
    const code = typeof err.code === 'string' ? err.code : undefined;
    const message = typeof err.message === 'string' ? err.message : undefined;
    const joined = [code, message].filter(Boolean).join(' — ');
    return joined ? truncate(joined) : undefined;
  }
  return typeof obj.message === 'string' ? truncate(obj.message) : undefined;
}

function summarizeNonJson(body: string): string | undefined {
  const trimmed = body.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith('<')) return `<non-JSON response, ${trimmed.length} bytes>`;
  return truncate(trimmed);
}

function truncate(s: string): string {
  return s.length > MAX_DETAIL_LEN ? `${s.slice(0, MAX_DETAIL_LEN)}…` : s;
}

/** Max wall-clock for one Kalshi request before aborting (live path only). */
const REQUEST_TIMEOUT_MS = 30_000;

/** Default transport over global fetch (Node 20+). Never used in unit tests. */
const fetchTransport: KalshiTransport = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(req.body === undefined ? {} : { body: req.body }),
  });
  const text = await res.text();
  let json: unknown;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
};
