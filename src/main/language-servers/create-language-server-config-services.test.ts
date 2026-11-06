import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { createLanguageServerConfigServices } from './create-language-server-config-services.ts';

describe('createLanguageServerConfigServices', () => {
  test('creates an empty configuration in the first place when none exists, and opens it', async ({
    expect,
    tempDir,
    logger,
    signal,
  }) => {
    const xdg = path.join(tempDir, 'xdg/beuve/language-servers.json');
    const own = path.join(tempDir, 'user-data/language-servers.json');
    const opened: string[] = [];
    const services = createLanguageServerConfigServices({
      paths: [xdg, own],
      openPath: async (file) => {
        opened.push(file);
        await Promise.resolve();
        return '';
      },
      logger: logger.logger,
    });
    await expect(services.open()).resolves.toStrictEqual({
      ok: true,
      value: { path: xdg, created: true },
    });
    expect(opened).toStrictEqual([xdg]);
    await expect(readFile(xdg, { encoding: 'utf8', signal })).resolves.toBe('{}\n');
  });

  test('opens the file that wins when several exist, and writes nothing', async ({
    expect,
    tempDir,
    logger,
    signal,
  }) => {
    const xdg = path.join(tempDir, 'xdg.json');
    const own = path.join(tempDir, 'own.json');
    await writeFile(xdg, '{"servers":{}}', { signal });
    await writeFile(own, '{"overrides":[]}', { signal });
    const opened: string[] = [];
    const services = createLanguageServerConfigServices({
      paths: [xdg, own],
      openPath: async (file) => {
        opened.push(file);
        await Promise.resolve();
        return '';
      },
      logger: logger.logger,
    });
    await expect(services.open()).resolves.toStrictEqual({
      ok: true,
      value: { path: own, created: false },
    });
    expect(opened).toStrictEqual([own]);
    await expect(readFile(xdg, { encoding: 'utf8', signal })).resolves.toBe('{"servers":{}}');
    await expect(readFile(own, { encoding: 'utf8', signal })).resolves.toBe('{"overrides":[]}');
  });

  test('opens the one that exists, wherever it is', async ({ expect, tempDir, logger, signal }) => {
    const xdg = path.join(tempDir, 'xdg.json');
    const own = path.join(tempDir, 'missing/own.json');
    await writeFile(xdg, '{}', { signal });
    const services = createLanguageServerConfigServices({
      paths: [xdg, own],
      openPath: async () => {
        await Promise.resolve();
        return '';
      },
      logger: logger.logger,
    });
    await expect(services.open()).resolves.toMatchObject({ ok: true, value: { path: xdg } });
  });

  test('says so when the file cannot be created or opened', async ({
    expect,
    tempDir,
    logger,
    signal,
  }) => {
    const blocked = path.join(tempDir, 'blocked');
    await writeFile(blocked, 'a file where a directory is needed', { signal });
    const cannotCreate = createLanguageServerConfigServices({
      paths: [path.join(blocked, 'language-servers.json')],
      openPath: async () => {
        await Promise.resolve();
        return '';
      },
      logger: logger.logger,
    });
    await expect(cannotCreate.open()).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', message: expect.stringContaining('Could not create') as string },
    });

    await mkdir(path.join(tempDir, 'fine'));
    const cannotOpen = createLanguageServerConfigServices({
      paths: [path.join(tempDir, 'fine/language-servers.json')],
      openPath: async () => {
        await Promise.resolve();
        return 'no application is set';
      },
      logger: logger.logger,
    });
    await expect(cannotOpen.open()).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('no application is set') as string },
    });
  });
});
