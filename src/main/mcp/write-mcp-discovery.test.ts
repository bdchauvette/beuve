import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from '../testing/test.ts';
import { writeMcpDiscovery } from './write-mcp-discovery.ts';
import type { McpDiscovery } from './write-mcp-discovery.ts';

function discovery(): McpDiscovery {
  return {
    schemaVersion: 1,
    name: 'beuve',
    transport: 'streamable-http',
    url: 'http://127.0.0.1:4000/mcp',
    token: 'secret',
    pid: 42,
    startedAt: '2026-10-28T00:00:00.000Z',
  };
}

describe('writeMcpDiscovery', () => {
  test('writes an owner-only descriptor and removes it again', async ({
    expect,
    tempDir,
    signal,
  }) => {
    const remove = okValueFrom(await writeMcpDiscovery(tempDir, discovery()));
    const file = path.join(tempDir, 'mcp-server.json');
    expect(JSON.parse(await readFile(file, { encoding: 'utf8', signal }))).toStrictEqual(
      discovery(),
    );
    const { mode } = await stat(file);
    expect(mode & 0o777).toBe(0o600);

    await remove();
    await remove();
    await expect(stat(file)).rejects.toThrow('ENOENT');
  });
});
