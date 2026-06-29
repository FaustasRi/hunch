/**
 * Builds the configured MCP server. Tools/resources/prompts are registered
 * here as checkpoints land (see docs/PLAN.md). Today: an empty, booting server.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { register as registerGetBalance } from './tools/get_balance.js';

const NAME = 'hunch';
const VERSION = '0.0.0';

export function createServer(): McpServer {
  const config = loadConfig();
  const ctx = createContext(config);

  const server = new McpServer(
    { name: NAME, version: VERSION },
    {
      // TODO(M6): replace with the full domain primer — cents = probability,
      // $1/$0 settlement, fees, the active caps, and the miscalibration caveat
      // ("Hunch surfaces price/news/base-rate; the human decides size").
      instructions:
        `Hunch exposes Kalshi prediction markets over MCP. Environment: ${config.env} ` +
        `(demo = fake money). Prices are probabilities quoted in cents. ` +
        `Trades are demo-default and capped; you confirm every order.`,
    },
  );

  // Registration wired up across checkpoints:
  registerGetBalance(server, ctx);
  //   M2: registerSearchMarkets / registerGetMarketBrief / market resource
  //   M3: registerGetPositions / registerGetOrders / portfolio resource
  //   M4: registerPreviewOrder
  //   M5: registerPlaceOrder / registerCancelOrder / registerCancelAllOrders
  //   M6: prompts

  return server;
}
