import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '../testing/test.ts';
import { loadMcpToken } from './load-mcp-token.ts';

describe('loadMcpToken', () => {
  test('creates an owner-only token once and reuses it', async ({ expect, tempDir, signal }) => {
    const first = await loadMcpToken(tempDir);
    const second = await loadMcpToken(tempDir);
    expect(first.ok && second.ok && first.value === second.value).toBe(true);
    const file = path.join(tempDir, 'mcp-token');
    const { mode } = await stat(file);
    expect(mode & 0o777).toBe(0o600);
    const contents = await readFile(file, { encoding: 'utf8', signal });
    expect(contents.trim()).toMatch(/^[\w-]{43}$/u);
  });

  test('replaces a malformed, loose token with an owner-only one', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const file = path.join(tempDir, 'mcp-token');
    await writeFile(file, 'short\n', { mode: 0o644, signal });
    const loaded = await loadMcpToken(tempDir);
    expect(loaded.ok && loaded.value !== 'short').toBe(true);
    const { mode } = await stat(file);
    expect(mode & 0o777).toBe(0o600);
    await expect(readdir(tempDir)).resolves.toStrictEqual(['mcp-token']);
  });
});
