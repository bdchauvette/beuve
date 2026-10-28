import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findServerCommand } from './find-server-command.ts';

describe('findServerCommand', () => {
  let directory: string;
  const executable = (relative: string, mode = 0o755): string => {
    const file = path.join(directory, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '#!/bin/sh\n');
    chmodSync(file, mode);
    return file;
  };

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'beuve-find-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('prefers search directories over PATH, skipping non-executables', async () => {
    executable('first/srv', 0o644);
    const second = executable('second/srv');
    executable('on-path/srv');
    const result = await findServerCommand({
      serverId: 's',
      command: 'srv',
      searchDirectories: [path.join(directory, 'first'), path.join(directory, 'second')],
      pathVariable: path.join(directory, 'on-path'),
    });
    expect(result).toEqual({ ok: true, value: second });
  });

  it('falls back to absolute PATH entries only, and lists what it searched', async () => {
    const onPath = executable('on-path/srv');
    const pathVariable = ['relative', path.join(directory, 'on-path')].join(path.delimiter);
    await expect(
      findServerCommand({ serverId: 's', command: 'srv', searchDirectories: [], pathVariable }),
    ).resolves.toEqual({ ok: true, value: onPath });
    await expect(
      findServerCommand({ serverId: 's', command: 'other', searchDirectories: [], pathVariable }),
    ).resolves.toEqual({
      ok: false,
      error: {
        kind: 'server-not-found',
        serverId: 's',
        command: 'other',
        searched: [path.join(directory, 'on-path', 'other')],
      },
    });
  });

  it('checks absolute commands and refuses relative paths', async () => {
    const absolute = executable('bin/srv');
    await expect(
      findServerCommand({
        serverId: 's',
        command: absolute,
        searchDirectories: [],
        pathVariable: undefined,
      }),
    ).resolves.toEqual({ ok: true, value: absolute });
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
