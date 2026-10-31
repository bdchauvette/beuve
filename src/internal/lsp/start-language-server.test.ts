import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { createServerEnvironment } from './create-server-environment.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';
import type { ServerDefinition } from './server-definition.ts';
import { startLanguageServer } from './start-language-server.ts';
import type { LanguageServer } from './start-language-server.ts';
import { positionEncodings } from './position-encodings.ts';
import { pollUntil } from './testing/poll-until.ts';
import { test } from './testing/test.ts';

describe('startLanguageServer', { timeout: 20_000 }, () => {
  test('negotiates capabilities and answers server requests read-only', async ({
    expect,
    tempDir: directory,
    fakeServerScript: script,
    signal,
  }) => {
    const server = okValueFrom(await start(directory, script, 'normal'));
    expect(server.capabilities).toMatchObject({
      positionEncoding: positionEncodings.utf8,
      callHierarchy: true,
      hover: false,
    });
    const answers = await waitForAnswers(server);
    expect(answers).toStrictEqual({
      edit: { applied: false, failureReason: 'beuve is a read-only review tool' },
      config: [true, JSON.parse('null')],
      unknown: { code: -32_601, message: 'beuve does not handle fake/unknownRequest' },
    });
    await server.shutdown();
    await expect(server.exited).resolves.toStrictEqual({
      exitCode: 0,
      signal: undefined,
      expected: true,
    });
    await expect(server.request('test/clientAnswers', {}, { signal })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'server-exited' },
    });
  });

  test('reports a server that dies during initialize, with its stderr', async ({
    expect,
    tempDir: directory,
    fakeServerScript: script,
  }) => {
    const started = await start(directory, script, 'fail-initialize');
    expect(started).toMatchObject({
      ok: false,
      error: { kind: 'server-start-failed', serverId: 'fake' },
    });
    expect(started.ok ? '' : JSON.stringify(started.error)).toContain(
      'fake server refuses to start',
    );
  });

  test('reports an executable that cannot be spawned', async ({
    expect,
    tempDir: directory,
    fakeServerScript: script,
  }) => {
    await expect(
      start(directory, script, 'normal', path.join(directory, 'missing')),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'server-start-failed', message: expect.stringContaining('ENOENT') as unknown },
    });
  });
});

function definition(script: string, mode: string): ServerDefinition {
  return {
    id: 'fake',
    command: process.execPath,
    args: [script, mode],
    languageIds: { '.ts': 'typescript' },
    settings: { fake: { flag: true } },
    diagnosticsQuiet: Temporal.Duration.from({ milliseconds: 20 }),
  };
}

async function start(
  directory: string,
  script: string,
  mode: string,
  commandPath = process.execPath,
): ReturnType<typeof startLanguageServer> {
  return startLanguageServer({
    definition: definition(script, mode),
    root: directory as WorkspaceRoot,
    commandPath,
    env: createServerEnvironment(process.env),
  });
}

async function waitForAnswers(server: LanguageServer): Promise<unknown> {
  return pollUntil('the fake server receiving all answers', async () => {
    const result = await server.request('test/clientAnswers', {});
    if (
      result.ok &&
      typeof result.value === 'object' &&
      result.value !== null &&
      Object.keys(result.value).length === 3
    ) {
      return result.value;
    }
    return;
  });
}
