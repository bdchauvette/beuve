import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { findServerCommand } from './find-server-command.ts';

describe('findServerCommand', () => {
  test('prefers search directories over PATH, skipping non-executables', async ({
    expect,
    tempDir: directory,
  }) => {
    executable(path.join(directory, 'first/srv'), 0o644);
    const second = executable(path.join(directory, 'second/srv'));
    executable(path.join(directory, 'on-path/srv'));
    const result = await findServerCommand({
      serverId: 's',
      command: 'srv',
      searchDirectories: [path.join(directory, 'first'), path.join(directory, 'second')],
      pathVariable: path.join(directory, 'on-path'),
    });
    expect(result).toStrictEqual({ ok: true, value: second });
  });

  test('falls back to absolute PATH entries only, and lists what it searched', async ({
    expect,
    tempDir: directory,
  }) => {
    const onPath = executable(path.join(directory, 'on-path/srv'));
    const pathVariable = ['relative', path.join(directory, 'on-path')].join(path.delimiter);
    await expect(
      findServerCommand({ serverId: 's', command: 'srv', searchDirectories: [], pathVariable }),
    ).resolves.toStrictEqual({ ok: true, value: onPath });
    await expect(
      findServerCommand({ serverId: 's', command: 'other', searchDirectories: [], pathVariable }),
    ).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'server-not-found',
        serverId: 's',
        command: 'other',
        searched: [path.join(directory, 'on-path', 'other')],
      },
    });
  });

  test('checks absolute commands and refuses relative paths', async ({
    expect,
    tempDir: directory,
  }) => {
    const absolute = executable(path.join(directory, 'bin/srv'));
    await expect(
      findServerCommand({
        serverId: 's',
        command: absolute,
        searchDirectories: [],
        pathVariable: undefined,
      }),
    ).resolves.toStrictEqual({ ok: true, value: absolute });
    await expect(
      findServerCommand({
        serverId: 's',
        command: 'bin/srv',
        searchDirectories: [directory],
        pathVariable: undefined,
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'server-not-found', searched: [] } });
  });
});

function executable(file: string, mode = 0o755): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '#!/bin/sh\n');
  chmodSync(file, mode);
  return file;
}
