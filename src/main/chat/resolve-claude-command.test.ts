import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import { resolveClaudeCommand } from './resolve-claude-command.ts';
import type { ClaudeCommandLookup } from './resolve-claude-command.ts';

function lookup(
  executables: readonly string[],
  env: Record<string, string | undefined> = {},
): ClaudeCommandLookup {
  return {
    env,
    homeDirectory: '/Users/ada',
    platform: 'darwin',
    isExecutable: async (file): Promise<boolean> => {
      await Promise.resolve();
      return executables.includes(file);
    },
  };
}

describe('resolveClaudeCommand', () => {
  test('prefers BEUVE_CLAUDE_PATH, expanding ~', async ({ expect }) => {
    await expect(
      resolveClaudeCommand(
        lookup(['/Users/ada/bin/claude', '/usr/local/bin/claude'], {
          BEUVE_CLAUDE_PATH: '~/bin/claude',
        }),
      ),
    ).resolves.toStrictEqual({ kind: 'found', command: '/Users/ada/bin/claude', source: 'env' });
  });

  test('reports a broken override instead of falling back', async ({ expect }) => {
    const outcome = await resolveClaudeCommand(
      lookup(['/usr/local/bin/claude'], { BEUVE_CLAUDE_PATH: 'claude' }),
    );
    expect(outcome).toMatchObject({ kind: 'missing' });
    expect(outcome.kind === 'missing' && outcome.message).toContain('BEUVE_CLAUDE_PATH');
  });

  test('checks the installers’ locations in order before PATH', async ({ expect }) => {
    await expect(
      resolveClaudeCommand(
        lookup(['/Users/ada/.local/bin/claude', '/opt/homebrew/bin/claude', '/usr/bin/claude'], {
          PATH: '/usr/bin',
        }),
      ),
    ).resolves.toStrictEqual({
      kind: 'found',
      command: '/Users/ada/.local/bin/claude',
      source: 'known-location',
    });
    await expect(
      resolveClaudeCommand(lookup(['/Users/ada/.claude/local/claude', '/usr/local/bin/claude'])),
    ).resolves.toMatchObject({ command: '/Users/ada/.claude/local/claude' });
  });

  test('falls back to absolute PATH entries, then gives up', async ({ expect }) => {
    await expect(
      resolveClaudeCommand(
        lookup(['/opt/tools/claude', 'bin/claude'], { PATH: 'bin::/opt/tools' }),
      ),
    ).resolves.toStrictEqual({ kind: 'found', command: '/opt/tools/claude', source: 'path' });
    await expect(resolveClaudeCommand(lookup([], { PATH: '/usr/bin' }))).resolves.toMatchObject({
      kind: 'missing',
    });
  });
});
