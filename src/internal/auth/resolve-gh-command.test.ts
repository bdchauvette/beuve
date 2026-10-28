import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { resolveGhCommand } from './resolve-gh-command.ts';

const temporary = mkdtempSync(path.join(tmpdir(), 'beuve-resolve-gh-'));
const root = realpathSync(temporary);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function executable(...segments: string[]): string {
  const file = path.join(root, ...segments);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '#!/bin/sh\n');
  chmodSync(file, 0o755);
  return file;
}

describe('resolveGhCommand', () => {
  const homebrew = executable('opt', 'homebrew', 'bin', 'gh');
  const onPath = executable('path-a', 'gh');
  const notExecutable = path.join(root, 'plain', 'gh');
  mkdirSync(path.dirname(notExecutable), { recursive: true });
  writeFileSync(notExecutable, '');

  it('prefers BEUVE_GH_PATH', async () => {
    const result = await resolveGhCommand({
      env: { BEUVE_GH_PATH: onPath, PATH: '' },
      wellKnownPaths: [homebrew],
    });
    expect(result).toEqual({ ok: true, value: onPath });
  });

  it('fails on a broken override instead of using another gh', async () => {
    const result = await resolveGhCommand({
      env: { BEUVE_GH_PATH: notExecutable },
      wellKnownPaths: [homebrew],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'cli-not-installed', searched: [notExecutable] },
    });
  });

  it('tries well-known paths before PATH', async () => {
    const result = await resolveGhCommand({
      env: { PATH: path.dirname(onPath) },
      wellKnownPaths: [path.join(root, 'missing', 'gh'), homebrew],
    });
    expect(result).toEqual({ ok: true, value: homebrew });
  });

  it('defaults to ~/.local/bin/gh among the well-known paths', async () => {
    const home = path.join(root, 'home');
    const local = executable('home', '.local', 'bin', 'gh');
    const result = await resolveGhCommand({ env: { PATH: '' }, homeDirectory: home });
    // /opt/homebrew/bin/gh or /usr/local/bin/gh may exist on the machine running the test.
    expect(result.ok).toBe(true);
    if (result.ok && !result.value.startsWith('/opt/') && !result.value.startsWith('/usr/')) {
      expect(result.value).toBe(local);
    }
  });

  it('skips relative and non-executable PATH entries', async () => {
    const result = await resolveGhCommand({
      env: { PATH: ['.', path.dirname(notExecutable), path.dirname(onPath)].join(path.delimiter) },
      wellKnownPaths: [],
    });
    expect(result).toEqual({ ok: true, value: onPath });
  });

  it('lists what it searched when nothing is found', async () => {
    const result = await resolveGhCommand({
      env: { PATH: path.dirname(notExecutable) },
      wellKnownPaths: [path.join(root, 'missing', 'gh')],
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'cli-not-installed',
        searched: [path.join(root, 'missing', 'gh'), notExecutable],
      },
    });
  });
});
