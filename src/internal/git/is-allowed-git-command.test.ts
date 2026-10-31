import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe } from 'vitest';

import { execGit } from './exec-git.ts';
import { isAllowedGitCommand } from './is-allowed-git-command.ts';
import { streamGit } from './stream-git.ts';
import { test } from './testing/test.ts';

/** beuve never pushes, and its `review/` branches stay local (ADR 0088). */
describe('isAllowedGitCommand', () => {
  test.for([
    ['push'],
    ['push', 'origin', 'review/pr-1'],
    ['-c', 'a=b', 'push'],
    ['send-pack', 'origin'],
    ['http-push', 'origin'],
    ['remote', 'add', 'x', 'y'],
    ['credential', 'fill'],
    ['-C', '/tmp', 'push'],
    ['--git-dir=x', 'push'],
    [],
  ])('refuses %j', (args, { expect }) => {
    expect(isAllowedGitCommand(args)).toBe(false);
  });

  test('allows the typed operations’ commands, with `-c` options first', ({ expect }) => {
    expect(isAllowedGitCommand(['worktree', 'add', '--detach'])).toBe(true);
    expect(isAllowedGitCommand(['-c', 'user.name=beuve', 'commit-tree', 'x'])).toBe(true);
    expect(isAllowedGitCommand(['fetch', '--no-tags', 'origin'])).toBe(true);
  });

  test('execGit and streamGit refuse a push before starting git', async ({
    expect,
    repo,
    signal,
  }) => {
    const push = ['push', 'origin', 'review/pr-1'];
    const refused = {
      ok: false,
      error: {
        kind: 'invalid-argument',
        argument: 'push',
        reason: 'not a git subcommand beuve runs',
      },
    };
    const missing = path.join(repo.scratch(), 'no-such-git');
    const request = { cwd: repo.directory, args: push, gitBinary: missing, signal };
    await expect(execGit({ ...request, policy: { kind: 'atomic' } })).resolves.toStrictEqual(
      refused,
    );
    await expect(
      streamGit({ ...request, policy: { kind: 'read' }, onStdout: () => 'more' }),
    ).resolves.toStrictEqual(refused);
  });

  test('no typed operation names push', async ({ expect }) => {
    await expect(sourcesNamingPush(import.meta.dirname)).resolves.toStrictEqual([
      'is-allowed-git-command.ts',
    ]);
  });
});

/** The git domain's source files (tests aside) holding a quoted `push`. */
async function sourcesNamingPush(directory: string): Promise<readonly string[]> {
  const names = await readdir(directory);
  const sources = names.filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  const naming: string[] = [];
  const ordered = sources.toSorted((left, right) => left.localeCompare(right));
  for (const name of ordered) {
    const text = await readFile(path.join(directory, name), 'utf8');
    if (/['"`]push['"`]/u.test(text)) {
      naming.push(name);
    }
  }
  return naming;
}
