import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import type { ModelTestView } from '#contract/ipc-contract.ts';
import { okValueFrom } from '#testing/ok-value-from.ts';

import { createModelRegistryStore } from './create-model-registry-store.ts';
import { createModelServices } from './create-model-services.ts';
import type { ModelServices } from './create-model-services.ts';
import { createSecretStore } from './create-secret-store.ts';
import { createFakeCipher } from './testing/create-fake-cipher.ts';
import { writeVersionCommand } from './testing/write-version-command.ts';
import { test } from '../testing/test.ts';

function services(
  tempDir: string,
  logger: Parameters<typeof createModelServices>[0]['logger'],
  testModel: (id: string) => Promise<ModelTestView> = async (): Promise<ModelTestView> => {
    await Promise.resolve();
    return { outcome: 'ok', elapsedMs: 12, model: 'fake' };
  },
): ModelServices {
  let next = 0;
  return createModelServices({
    registry: createModelRegistryStore(path.join(tempDir, 'settings.json')),
    secrets: createSecretStore({
      filePath: path.join(tempDir, 'model-secrets.json'),
      cipher: createFakeCipher(),
    }),
    testModel,
    hasBundledClaudeCode: true,
    newId: (): string => {
      next += 1;
      return String(next);
    },
    logger,
  });
}

describe('createModelServices', () => {
  test('adds, edits, assigns and removes entries, falling roles back to Claude Code', async ({
    expect,
    tempDir,
    logger,
  }) => {
    const models = services(tempDir, logger.logger);
    const listed = okValueFrom(await models.list());
    expect(listed).toStrictEqual({
      entries: [
        {
          id: 'claude-code',
          label: 'Claude Code (your login)',
          kind: 'claude-code-cli',
          hasApiKey: false,
          isRemote: false,
          isDefault: true,
        },
      ],
      roles: {
        chat: 'claude-code',
        review: 'claude-code',
        verify: 'claude-code',
        summarize: 'claude-code',
        compact: 'claude-code',
      },
      keyStorage: 'os',
      hasBundledClaudeCode: true,
    });
    const added = okValueFrom(
      await models.save({
        label: 'Gateway',
        kind: 'openai-compatible',
        model: 'gpt-x',
        baseUrl: 'https://llm.example.com/v1',
        tools: false,
      }),
    );
    expect(added.entries[1]).toMatchObject({ id: 'openai-1', isRemote: true, hasApiKey: false });
    const local = okValueFrom(
      await models.save({
        id: 'openai-1',
        label: 'Local',
        kind: 'openai-compatible',
        model: 'qwen3:8b',
        baseUrl: 'http://localhost:11434/v1',
        tools: true,
      }),
    );
    expect(local.entries[1]).toMatchObject({ label: 'Local', isRemote: false });
    expect(okValueFrom(await models.setRole('verify', 'openai-1')).roles.verify).toBe('openai-1');
    await expect(models.setRole('chat', 'nope')).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
    const removed = okValueFrom(await models.remove('openai-1'));
    expect(removed.entries.map((entry) => entry.id)).toStrictEqual(['claude-code']);
    expect(removed.roles.verify).toBe('claude-code');
    await expect(models.remove('claude-code')).resolves.toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
    await expect(
      models.save({
        id: 'claude-code',
        label: 'x',
        kind: 'openai-compatible',
        model: 'm',
        baseUrl: 'http://localhost/v1',
        tools: false,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'refused' } });
    await expect(
      models.save({ id: 'ghost', label: 'x', kind: 'claude-code-cli' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });

  test('keeps keys write-only: views say set or not set, files never hold them in clear', async ({
    expect,
    tempDir,
    logger,
  }) => {
    const models = services(tempDir, logger.logger);
    await models.save({
      label: 'API key',
      kind: 'claude-agent-sdk',
      executable: { source: 'bundled' },
    });
    const withKey = okValueFrom(
      await models.setKey({ id: 'claude-1', apiKey: 'sk-ant-VERY-SECRET' }),
    );
    expect(withKey.entries[1]).toMatchObject({ id: 'claude-1', hasApiKey: true });
    expect(JSON.stringify(withKey)).not.toContain('VERY-SECRET');
    expect(readFileSync(path.join(tempDir, 'settings.json'), 'utf8')).not.toContain('VERY-SECRET');
    expect(readFileSync(path.join(tempDir, 'model-secrets.json'), 'utf8')).not.toContain(
      'VERY-SECRET',
    );
    expect(logger.lines.map((line) => JSON.stringify(line)).join('\n')).not.toContain(
      'VERY-SECRET',
    );
    const edited = okValueFrom(
      await models.save({
        id: 'claude-1',
        label: 'Renamed',
        kind: 'claude-agent-sdk',
        executable: { source: 'bundled' },
      }),
    );
    expect(edited.entries[1]).toMatchObject({ label: 'Renamed', hasApiKey: true });
    const without = okValueFrom(await models.removeKey('claude-1'));
    expect(without.entries[1]).toMatchObject({ hasApiKey: false });
    await expect(models.setKey({ id: 'claude-code', apiKey: 'sk' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
  });

  test('refuses an installed Claude Code older than the SDK needs, suggesting Bundled', async ({
    expect,
    tempDir,
    logger,
  }) => {
    const old = writeVersionCommand({
      directory: tempDir,
      name: 'claude',
      output: '2.1.100 (Claude Code)',
    });
    const saved = await services(tempDir, logger.logger).save({
      label: 'Old CLI',
      kind: 'claude-agent-sdk',
      executable: { source: 'installed', path: old },
    });
    expect(saved).toMatchObject({
      ok: false,
      error: {
        code: 'refused',
        message: expect.stringContaining('switch the executable to Bundled') as string,
      },
    });
  });

  test('lists a server’s models, sending an entry’s key only to its own URL', async ({
    expect,
    tempDir,
    logger,
    openAiApi,
  }) => {
    const api = await openAiApi({ models: ['qwen3:8b'] });
    const other = await openAiApi({ models: ['other'] });
    const models = services(tempDir, logger.logger);
    await models.save({
      label: 'Local',
      kind: 'openai-compatible',
      model: 'qwen3:8b',
      baseUrl: api.baseUrl,
      tools: false,
    });
    await models.setKey({ id: 'openai-1', apiKey: 'sk-local' });
    await expect(
      models.listRemote({ baseUrl: api.baseUrl, id: 'openai-1' }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { models: ['qwen3:8b'] },
    });
    await models.listRemote({ baseUrl: other.baseUrl, id: 'openai-1' });
    expect(api.requests[0]?.authorization).toBe('Bearer sk-local');
    expect(other.requests[0]?.authorization).toBeUndefined();
  });

  test('tests an entry through the chat and refuses an unknown one', async ({
    expect,
    tempDir,
    logger,
  }) => {
    const asked: string[] = [];
    const models = services(tempDir, logger.logger, async (id): Promise<ModelTestView> => {
      asked.push(id);
      await Promise.resolve();
      return {
        outcome: 'failed',
        elapsedMs: 3,
        errorKind: 'not-authenticated',
        message: 'Not signed in: bad key',
      };
    });
    await expect(models.test('claude-code')).resolves.toStrictEqual({
      ok: true,
      value: {
        outcome: 'failed',
        elapsedMs: 3,
        errorKind: 'not-authenticated',
        message: 'Not signed in: bad key',
      },
    });
    await expect(models.test('nope')).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
    expect(asked).toStrictEqual(['claude-code']);
  });
});
