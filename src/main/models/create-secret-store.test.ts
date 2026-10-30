import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { createSecretStore } from './create-secret-store.ts';
import { createFakeCipher } from './testing/create-fake-cipher.ts';
import { test } from '../testing/test.ts';

describe('createSecretStore', () => {
  test('stores a key encrypted in its own file and reads it back in main', async ({
    expect,
    tempDir,
  }) => {
    const filePath = path.join(tempDir, 'user-data', 'model-secrets.json');
    const store = createSecretStore({ filePath, cipher: createFakeCipher() });
    await expect(store.set('model:a', 'sk-SECRET-1')).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    await store.set('model:b', 'sk-SECRET-2');
    const onDisk = readFileSync(filePath, 'utf8');
    expect(onDisk).not.toContain('SECRET');
    expect(JSON.parse(onDisk)).toMatchObject({
      version: 1,
      secrets: { 'model:a': expect.any(String) as string },
    });
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    await expect(store.has('model:a')).resolves.toBe(true);
    await expect(store.get('model:a')).resolves.toBe('sk-SECRET-1');
    const reopened = createSecretStore({ filePath, cipher: createFakeCipher() });
    await expect(reopened.get('model:b')).resolves.toBe('sk-SECRET-2');
    await reopened.remove('model:a');
    await expect(reopened.has('model:a')).resolves.toBe(false);
    await expect(reopened.get('model:b')).resolves.toBe('sk-SECRET-2');
    await expect(reopened.status()).resolves.toBe('os');
  });

  test('treats a corrupted ciphertext as no key', async ({ expect, tempDir }) => {
    const filePath = path.join(tempDir, 'secrets.json');
    const store = createSecretStore({ filePath, cipher: createFakeCipher() });
    await store.set('model:a', 'sk-SECRET-1');
    const stored = readFileSync(filePath, 'utf8');
    writeFileSync(filePath, stored.replace(/"model:a": ?"[^"]*"/u, '"model:a":"%%not base64%%"'));

    await expect(store.has('model:a')).resolves.toBe(true);
    await expect(store.get('model:a')).resolves.toBeUndefined();
  });

  test('keeps concurrent writes', async ({ expect, tempDir }) => {
    const store = createSecretStore({
      filePath: path.join(tempDir, 'secrets.json'),
      cipher: createFakeCipher({ backend: 'basic' }),
    });
    await Promise.all(['a', 'b', 'c'].map(async (ref) => store.set(ref, `key-${ref}`)));
    await expect(
      Promise.all(['a', 'b', 'c'].map(async (ref) => store.get(ref))),
    ).resolves.toStrictEqual(['key-a', 'key-b', 'key-c']);
    await expect(store.status()).resolves.toBe('basic');
  });

  test('stores nothing without encryption', async ({ expect, tempDir }) => {
    const filePath = path.join(tempDir, 'secrets.json');
    for (const store of [
      createSecretStore({ filePath, cipher: createFakeCipher({ available: false }) }),
      createSecretStore({ filePath }),
      createSecretStore({ cipher: createFakeCipher() }),
    ]) {
      await expect(store.status()).resolves.toBe('unavailable');
      await expect(store.set('model:a', 'sk')).resolves.toMatchObject({ ok: false });
      await expect(store.get('model:a')).resolves.toBeUndefined();
    }
  });
});
