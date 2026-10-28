import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServerEnvironment } from './create-server-environment.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import type { ServerDefinition } from './server-definition.ts';
import { startLanguageServer } from './start-language-server.ts';
import type { LanguageServer } from './start-language-server.ts';
import { writeFakeLanguageServer } from './testing/write-fake-language-server.ts';
import { positionEncodings } from './position-encodings.ts';

describe('startLanguageServer', { timeout: 20_000 }, () => {
  let directory: string;
  let script: string;

  beforeAll(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'beuve-fake-lsp-'));
    script = writeFakeLanguageServer(directory);
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const definition = (mode: string): ServerDefinition => ({
    id: 'fake',
    command: process.execPath,
    args: [script, mode],
    languageIds: { '.ts': 'typescript' },
    settings: { fake: { flag: true } },
    diagnosticsQuietMs: 20,
  });

  const start = async (
    mode: string,
    commandPath = process.execPath,
  ): ReturnType<typeof startLanguageServer> =>
    startLanguageServer({
      definition: definition(mode),
      root: directory as WorkspaceRoot,
      commandPath,
      env: createServerEnvironment(process.env),
    });

  it('negotiates capabilities and answers server requests read-only', async () => {
    const started = await start('normal');
    if (!started.ok) {
      throw new Error(JSON.stringify(started.error));
    }
    const server = started.value;
    expect(server.capabilities).toMatchObject({
      positionEncoding: positionEncodings.utf8,
      callHierarchy: true,
      hover: false,
    });
    const answers = await waitForAnswers(server);
    expect(answers).toEqual({
      edit: { applied: false, failureReason: 'beuve is a read-only review tool' },
      config: [true, JSON.parse('null')],
      unknown: { code: -32_601, message: 'beuve does not handle fake/unknownRequest' },
    });
    await server.shutdown();
    await expect(server.exited).resolves.toEqual({
      exitCode: 0,
      signal: undefined,
      expected: true,
    });
    await expect(server.request('test/clientAnswers', {})).resolves.toMatchObject({
      ok: false,
      error: { kind: 'server-exited' },
    });
  });

  it('reports a server that dies during initialize, with its stderr', async () => {
    const started = await start('fail-initialize');
    expect(started).toMatchObject({
      ok: false,
      error: { kind: 'server-start-failed', serverId: 'fake' },
    });
    expect(started.ok ? '' : JSON.stringify(started.error)).toContain(
      'fake server refuses to start',
    );
  });

  it('reports an executable that cannot be spawned', async () => {
    await expect(start('normal', path.join(directory, 'missing'))).resolves.toMatchObject({
      ok: false,
      error: { kind: 'server-start-failed', message: expect.stringContaining('ENOENT') as unknown },
    });
  });
});

async function waitForAnswers(server: LanguageServer): Promise<unknown> {
  const deadline = performance.now() + 10_000;
  for (;;) {
    const result = await server.request('test/clientAnswers', {});
    if (
      result.ok &&
      typeof result.value === 'object' &&
      result.value !== null &&
      Object.keys(result.value).length === 3
    ) {
      return result.value;
    }
    if (performance.now() > deadline) {
      throw new Error('the fake server never received all answers');
    }
  }
}
