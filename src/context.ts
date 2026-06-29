/**
 * The shared context every tool/resource/prompt receives: resolved config plus a
 * ready Kalshi client. The server factory builds one and threads it into each
 * `register(server, ctx)`. Keeping this in one place means a single client (and,
 * later, a single audit log + token store) is shared across the tool surface.
 */
import type { Config } from './config.js';
import { KalshiClient } from './kalshi/client.js';

export interface ServerContext {
  config: Config;
  client: KalshiClient;
}

export function createContext(config: Config): ServerContext {
  const client = new KalshiClient({
    baseUrl: config.baseUrl,
    apiKeyId: config.apiKeyId,
    privateKeyPem: config.privateKeyPem,
  });
  return { config, client };
}
