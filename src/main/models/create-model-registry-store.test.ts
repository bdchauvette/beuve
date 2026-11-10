import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { createModelRegistryStore } from './create-model-registry-store.ts';
import { defaultModelRegistry } from './default-model-registry.ts';
import type { ModelEntry } from './model-registry.ts';
import { test } from '../testing/test.ts';

function ollama(): ModelEntry {
  return {
    id: 'openai-1',
    label: 'Local Qwen',
    kind: 'openai-compatible',
    model: 'qwen3:8b',
    baseUrl: 'http://localhost:11434/v1',
    tools: false,
    apiKeyRef: 'model:openai-1',
  };
}

describe('createModelRegistryStore', () => {
  test('starts with the Claude Code entry for every role', async ({ expect, tempDir }) => {
    const store = createModelRegistryStore(path.join(tempDir, 'settings.json'));
    await expect(store.read()).resolves.toStrictEqual(defaultModelRegistry);
    await expect(createModelRegistryStore().read()).resolves.toStrictEqual(defaultModelRegistry);
  });

  test('persists entries and roles under models, keeping the other settings', async ({
    expect,
    tempDir,
  }) => {
    const file = path.join(tempDir, 'settings.json');
    writeFileSync(file, JSON.stringify({ preferredEditor: 'zed' }));
    const store = createModelRegistryStore(file);
    const saved = await store.update((current) => {
      return ok({
        entries: [...current.entries, ollama()],
        roles: { ...current.roles, verify: 'openai-1' },
      });
    });
    expect(saved.ok).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(onDisk['preferredEditor']).toBe('zed');
    expect(onDisk['models']).toMatchObject({ roles: { verify: 'openai-1', chat: 'claude-code' } });
    const reread = await createModelRegistryStore(file).read();
    expect(reread.entries).toStrictEqual([...defaultModelRegistry.entries, ollama()]);
    expect(reread.roles.verify).toBe('openai-1');
  });

  test('stores nothing when the change fails', async ({ expect, tempDir }) => {
    const file = path.join(tempDir, 'settings.json');
    const store = createModelRegistryStore(file);
    await expect(store.update(() => err('no'))).resolves.toStrictEqual({ ok: false, error: 'no' });
    await expect(store.read()).resolves.toStrictEqual(defaultModelRegistry);
  });

  test('reads a damaged registry leniently', async ({ expect, tempDir }) => {
    const file = path.join(tempDir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        models: {
          entries: [
            ollama(),
            { ...ollama(), label: 'Duplicate id' },
            { id: 'bad', kind: 'openai-compatible', label: 'No URL', model: 'x', tools: false },
            { id: 'evil', kind: 'claude-code-cli', label: 'x', command: 'rm -rf /' },
            'not an entry',
          ],
          roles: { chat: 'openai-1', review: 'missing', verify: 42 },
        },
      }),
    );
    const registry = await createModelRegistryStore(file).read();
    expect(registry.entries.map((entry) => entry.id)).toStrictEqual(['claude-code', 'openai-1']);
    expect(registry.roles).toStrictEqual({
      chat: 'openai-1',
      review: 'claude-code',
      verify: 'claude-code',
      summarize: 'claude-code',
      compact: 'claude-code',
      draft: 'claude-code',
    });
  });
});
