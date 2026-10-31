import path from 'node:path';
import process from 'node:process';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';
import { ok } from '#x/result/ok.ts';

import { createModelRegistryStore } from './create-model-registry-store.ts';
import type { ModelRegistryStore } from './create-model-registry-store.ts';
import { createSecretStore } from './create-secret-store.ts';
import type { SecretStore } from './create-secret-store.ts';
import type { ModelEntry } from './model-registry.ts';
import { resolveLanguageModel } from './resolve-language-model.ts';
import type { ModelResolverDeps } from './resolve-language-model.ts';
import { createFakeCipher } from './testing/create-fake-cipher.ts';
import { writeVersionCommand } from './testing/write-version-command.ts';
import { test } from '../testing/test.ts';

async function registryWith(
  entries: readonly ModelEntry[],
  roles: Partial<Record<'chat' | 'review' | 'verify' | 'summarize' | 'compact', string>> = {},
): Promise<ModelRegistryStore> {
  const registry = createModelRegistryStore();
  await registry.update((current) => {
    return ok({ entries: [...current.entries, ...entries], roles: { ...current.roles, ...roles } });
  });
  return registry;
}

function agentSdkEntry(
  id: string,
  executable: Extract<ModelEntry, { kind: 'claude-agent-sdk' }>['executable'],
): ModelEntry {
  return { id, label: id, kind: 'claude-agent-sdk', executable };
}

function deps(
  registry: ModelRegistryStore,
  secrets: SecretStore,
  logger: ModelResolverDeps['logger'],
  claude: ModelResolverDeps['claude'] = {},
): ModelResolverDeps {
  return { registry, secrets, claude, logger };
}

describe('resolveLanguageModel', () => {
  test('gives every role the Claude Code CLI by default, with its capabilities', async ({
    expect,
    logger,
  }) => {
    const resolverDeps = deps(createModelRegistryStore(), createSecretStore({}), logger.logger, {
      command: process.execPath,
    });
    const resolved = okValueFrom(await resolveLanguageModel({ role: 'verify' }, resolverDeps));
    expect(resolved.entry.id).toBe('claude-code');
    expect(resolved.name).toBe('Claude Code');
    expect(resolved.model.capabilities).toStrictEqual({
      tools: true,
      checkout: true,
      structuredOutput: 'native',
      contextWindowTokens: undefined,
      streaming: true,
    });
  });

  test('builds the role’s OpenAI-compatible entry with its key and a safe context window', async ({
    expect,
    logger,
    tempDir,
  }) => {
    const secrets = createSecretStore({
      filePath: path.join(tempDir, 'secrets.json'),
      cipher: createFakeCipher(),
    });
    await secrets.set('model:openai-1', 'sk-local');
    const registry = await registryWith(
      [
        {
          id: 'openai-1',
          label: 'Local Qwen',
          kind: 'openai-compatible',
          model: 'qwen3:8b',
          baseUrl: 'http://127.0.0.1:9/v1',
          tools: true,
          apiKeyRef: 'model:openai-1',
        },
      ],
      { verify: 'openai-1' },
    );
    const verifier = okValueFrom(
      await resolveLanguageModel({ role: 'verify' }, deps(registry, secrets, logger.logger)),
    );
    expect(verifier.name).toBe('Local Qwen');
    expect(verifier.model.capabilities).toMatchObject({ tools: true, contextWindowTokens: 32_768 });
    const chat = await resolveLanguageModel(
      { role: 'chat' },
      deps(registry, secrets, logger.logger, { command: process.execPath }),
    );
    expect(okValueFrom(chat).entry.id).toBe('claude-code');
  });

  test('checks an installed Claude Code for the Agent SDK and suggests Bundled', async ({
    expect,
    logger,
    tempDir,
  }) => {
    const old = writeVersionCommand(tempDir, 'claude-old', '2.1.200 (Claude Code)');
    const current = writeVersionCommand(tempDir, 'claude-new', '2.1.400 (Claude Code)');
    const registry = await registryWith([
      agentSdkEntry('old', { source: 'installed', path: old }),
      agentSdkEntry('new', { source: 'installed', path: current }),
      agentSdkEntry('gone', { source: 'installed', path: path.join(tempDir, 'missing') }),
      agentSdkEntry('bundled', { source: 'bundled' }),
    ]);
    const resolverDeps = deps(registry, createSecretStore({}), logger.logger);
    await expect(resolveLanguageModel({ entryId: 'old' }, resolverDeps)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unsupported-version', version: '2.1.200', command: old },
    });
    expect(okValueFrom(await resolveLanguageModel({ entryId: 'new' }, resolverDeps)).name).toBe(
      'Claude Code',
    );
    await expect(resolveLanguageModel({ entryId: 'gone' }, resolverDeps)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-installed' },
    });
    expect(
      okValueFrom(await resolveLanguageModel({ entryId: 'bundled' }, resolverDeps)).entry.kind,
    ).toBe('claude-agent-sdk');
    await expect(resolveLanguageModel({ entryId: 'nope' }, resolverDeps)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'invalid-request', reason: 'no model named nope' },
    });
  });
});
