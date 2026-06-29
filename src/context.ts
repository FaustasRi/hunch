/**
 * The shared context every tool/resource/prompt receives: resolved config plus a
 * ready Kalshi client. The server factory builds one and threads it into each
 * `register(server, ctx)`. Keeping this in one place means a single client (and,
 * later, a single audit log + token store) is shared across the tool surface.
 */
import type { Config } from './config.js';
import { KalshiClient } from './kalshi/client.js';
import { TokenStore } from './safety/token.js';
import { Mutex } from './safety/mutex.js';

export interface ServerContext {
  config: Config;
  client: KalshiClient;
  /** Shared preview→place confirmation tokens (issued by preview_order; consumed by place_order). */
  tokens: TokenStore;
  /** Serializes placement so concurrent orders can't both pass a near-limit daily cap. */
  placeLock: Mutex;
}

export function createContext(config: Config): ServerContext {
  const client = new KalshiClient({
    baseUrl: config.baseUrl,
    apiKeyId: config.apiKeyId,
    privateKeyPem: config.privateKeyPem,
  });
  return { config, client, tokens: new TokenStore(), placeLock: new Mutex() };
}
