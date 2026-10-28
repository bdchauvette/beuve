import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeMcpDiscovery } from './write-mcp-discovery.ts';
import type { McpDiscovery } from './write-mcp-discovery.ts';

const discovery: McpDiscovery = {
  schemaVersion: 1,
  name: 'beuve',
  transport: 'streamable-http',
  url: 'http://127.0.0.1:4000/mcp',
  token: 'secret',
  pid: 42,
  startedAt: '2026-10-28T00:00:00.000Z',
};

describe('writeMcpDiscovery', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'beuve-discovery-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes an owner-only descriptor and removes it again', async () => {
    const written = await writeMcpDiscovery(directory, discovery);
    if (!written.ok) {
      throw written.error;
    }
    const file = path.join(directory, 'mcp-server.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(discovery);
    const { mode } = await stat(file);
    expect(mode & 0o777).toBe(0o600);

    await written.value();
    await written.value();
    await expect(stat(file)).rejects.toThrow();
  });
});
