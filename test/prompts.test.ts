import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register as analyze } from '../src/prompts/analyze_market.js';
import { register as scan } from '../src/prompts/scan_opportunities.js';
import { register as review } from '../src/prompts/review_positions.js';

interface Captured {
  name: string;
  config: { title?: string; description?: string; argsSchema?: Record<string, unknown> };
  cb: (args?: Record<string, string>) => { messages: Array<{ content: { text: string } }> };
}

function capture(registerFn: (server: McpServer) => void): Captured {
  let entry: Captured | undefined;
  const stub = {
    registerPrompt: (name: string, config: Captured['config'], cb: Captured['cb']) => {
      entry = { name, config, cb };
    },
  } as unknown as McpServer;
  registerFn(stub);
  if (!entry) throw new Error('register did not call registerPrompt');
  return entry;
}

const textOf = (p: Captured, args?: Record<string, string>): string =>
  p.cb(args).messages[0]!.content.text;

describe('prompts', () => {
  it('analyze-market injects the ticker and keeps sizing with the human', () => {
    const p = capture(analyze);
    expect(p.name).toBe('analyze-market');
    const text = textOf(p, { ticker: 'KXBTCD-X' });
    expect(text).toContain('KXBTCD-X');
    expect(text).toContain('get_market_brief');
    expect(text).toMatch(/do NOT recommend a position size/i);
  });

  it('scan-opportunities adapts to an optional query', () => {
    const p = capture(scan);
    expect(p.name).toBe('scan-opportunities');
    expect(textOf(p, { query: 'fed' })).toContain('fed');
    expect(textOf(p, {})).toContain('search_markets');
  });

  it('review-positions walks the portfolio and never auto-trades', () => {
    const p = capture(review);
    expect(p.name).toBe('review-positions');
    const text = textOf(p);
    expect(text).toContain('get_positions');
    expect(text).toMatch(/do not place or cancel anything yourself/i);
  });
});
