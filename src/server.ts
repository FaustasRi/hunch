/**
 * Builds the configured MCP server. Tools/resources/prompts are registered
 * here as checkpoints land (see docs/PLAN.md). Today: an empty, booting server.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig, type Config } from './config.js';
import { createContext } from './context.js';
import { buildInstructions } from './instructions.js';
import { register as registerGetBalance } from './tools/get_balance.js';
import { register as registerSearchMarkets } from './tools/search_markets.js';
import { register as registerGetMarketBrief } from './tools/get_market_brief.js';
import { register as registerGetPositions } from './tools/get_positions.js';
import { register as registerGetOrders } from './tools/get_orders.js';
import { register as registerPreviewOrder } from './tools/preview_order.js';
import { register as registerPlaceOrder } from './tools/place_order.js';
import { register as registerCancelOrder } from './tools/cancel_order.js';
import { register as registerCancelAllOrders } from './tools/cancel_all_orders.js';
import { register as registerMarketResource } from './resources/market.js';
import { register as registerPortfolioResource } from './resources/portfolio.js';
import { register as registerAnalyzeMarketPrompt } from './prompts/analyze_market.js';
import { register as registerScanOpportunitiesPrompt } from './prompts/scan_opportunities.js';
import { register as registerReviewPositionsPrompt } from './prompts/review_positions.js';

const NAME = 'hunch';
const VERSION = '0.0.0';

export function createServer(config: Config = loadConfig()): McpServer {
  const ctx = createContext(config);

  const server = new McpServer(
    { name: NAME, version: VERSION },
    { instructions: buildInstructions(config) },
  );

  // Registration wired up across checkpoints:
  registerGetBalance(server, ctx);
  registerSearchMarkets(server, ctx);
  registerGetMarketBrief(server, ctx);
  registerGetPositions(server, ctx);
  registerGetOrders(server, ctx);
  registerPreviewOrder(server, ctx);
  registerPlaceOrder(server, ctx);
  registerCancelOrder(server, ctx);
  registerCancelAllOrders(server, ctx);
  registerMarketResource(server, ctx);
  registerPortfolioResource(server, ctx);
  registerAnalyzeMarketPrompt(server);
  registerScanOpportunitiesPrompt(server);
  registerReviewPositionsPrompt(server);

  return server;
}
