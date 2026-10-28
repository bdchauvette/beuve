import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadMcpToken } from './load-mcp-token.ts';

const tokenPattern = /^[\w-]{43}$/u;

describe('loadMcpToken', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'beuve-token-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('creates an owner-only token once and reuses it', async () => {
    const first = await loadMcpToken(directory);
    const second = await loadMcpToken(directory);
    expect(first.ok && second.ok && first.value === second.value).toBe(true);
    const file = path.join(directory, 'mcp-token');
    const { mode } = await stat(file);
    expect(mode & 0o777).toBe(0o600);
    const contents = await readFile(file, 'utf8');
    expect(contents.trim()).toMatch(tokenPattern);
  });

  it('replaces a malformed token', async () => {
    await writeFile(path.join(directory, 'mcp-token'), 'short\n', { mode: 0o644 });
    const loaded = await loadMcpToken(directory);
    expect(loaded.ok && loaded.value !== 'short').toBe(true);
  });
});
