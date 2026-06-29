import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server.js';

describe('server', () => {
  it('constructs without throwing', () => {
    expect(createServer()).toBeDefined();
  });
});
