import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { resolveGhCommand } from './resolve-gh-command.ts';
import { test } from './testing/test.ts';

function executable(root: string, ...segments: string[]): string {
  const file = path.join(root, ...segments);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '#!/bin/sh\n');
  chmodSync(file, 0o755);
  return file;
}

function plainFile(root: string): string {
  const file = path.join(root, 'plain', 'gh');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '');
  return file;
}

describe('resolveGhCommand', () => {
  test('prefers BEUVE_GH_PATH', async ({ expect, tempDir: root }) => {
    const homebrew = executable(root, 'opt', 'homebrew', 'bin', 'gh');
    const onPath = executable(root, 'path-a', 'gh');
    const result = await resolveGhCommand({
      env: { BEUVE_GH_PATH: onPath, PATH: '' },
      wellKnownPaths: [homebrew],
    });
    expect(result).toStrictEqual({ ok: true, value: onPath });
  });

  test('fails on a broken override instead of using another gh', async ({
    expect,
    tempDir: root,
  }) => {
    const homebrew = executable(root, 'opt', 'homebrew', 'bin', 'gh');
    const notExecutable = plainFile(root);
    const result = await resolveGhCommand({
      env: { BEUVE_GH_PATH: notExecutable },
      wellKnownPaths: [homebrew],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'cli-not-installed', searched: [notExecutable] },
    });
  });

  test('tries well-known paths before PATH', async ({ expect, tempDir: root }) => {
    const homebrew = executable(root, 'opt', 'homebrew', 'bin', 'gh');
    const onPath = executable(root, 'path-a', 'gh');
    const result = await resolveGhCommand({
      env: { PATH: path.dirname(onPath) },
      wellKnownPaths: [path.join(root, 'missing', 'gh'), homebrew],
    });
    expect(result).toStrictEqual({ ok: true, value: homebrew });
  });

  test('defaults to ~/.local/bin/gh among the well-known paths', async ({
    expect,
    tempDir: root,
  }) => {
    const home = path.join(root, 'home');
    const local = executable(root, 'home', '.local', 'bin', 'gh');
    const result = await resolveGhCommand({ env: { PATH: '' }, homeDirectory: home });
    // /opt/homebrew/bin/gh or /usr/local/bin/gh may exist on the machine running the test.
    expect([local, '/opt/homebrew/bin/gh', '/usr/local/bin/gh']).toContain(okValueFrom(result));
  });

  test('skips relative and non-executable PATH entries', async ({ expect, tempDir: root }) => {
    const onPath = executable(root, 'path-a', 'gh');
    const notExecutable = plainFile(root);
    const result = await resolveGhCommand({
      env: { PATH: ['.', path.dirname(notExecutable), path.dirname(onPath)].join(path.delimiter) },
      wellKnownPaths: [],
    });
    expect(result).toStrictEqual({ ok: true, value: onPath });
  });

  test('lists what it searched when nothing is found', async ({ expect, tempDir: root }) => {
    const notExecutable = plainFile(root);
    const result = await resolveGhCommand({
      env: { PATH: path.dirname(notExecutable) },
      wellKnownPaths: [path.join(root, 'missing', 'gh')],
    });
    expect(result).toStrictEqual({
      ok: false,
      error: {
        kind: 'cli-not-installed',
        searched: [path.join(root, 'missing', 'gh'), notExecutable],
      },
    });
  });
});
