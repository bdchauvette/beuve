import { describe, expect, it } from 'vitest';

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
  it('prefers BEUVE_CLAUDE_PATH, expanding ~', async () => {
    expect(
      await resolveClaudeCommand(
        lookup(['/Users/ada/bin/claude', '/usr/local/bin/claude'], {
          BEUVE_CLAUDE_PATH: '~/bin/claude',
        }),
      ),
    ).toEqual({ kind: 'found', command: '/Users/ada/bin/claude', source: 'env' });
  });

  it('reports a broken override instead of falling back', async () => {
    const outcome = await resolveClaudeCommand(
      lookup(['/usr/local/bin/claude'], { BEUVE_CLAUDE_PATH: 'claude' }),
    );
    expect(outcome).toMatchObject({ kind: 'missing' });
    expect(outcome.kind === 'missing' && outcome.message).toContain('BEUVE_CLAUDE_PATH');
  });

  it('checks the installers’ locations in order before PATH', async () => {
    expect(
      await resolveClaudeCommand(
        lookup(['/Users/ada/.local/bin/claude', '/opt/homebrew/bin/claude', '/usr/bin/claude'], {
          PATH: '/usr/bin',
        }),
      ),
    ).toEqual({ kind: 'found', command: '/Users/ada/.local/bin/claude', source: 'known-location' });
    expect(
      await resolveClaudeCommand(
        lookup(['/Users/ada/.claude/local/claude', '/usr/local/bin/claude']),
      ),
    ).toMatchObject({ command: '/Users/ada/.claude/local/claude' });
  });

  it('falls back to absolute PATH entries, then gives up', async () => {
    expect(
      await resolveClaudeCommand(
        lookup(['/opt/tools/claude', 'bin/claude'], { PATH: 'bin::/opt/tools' }),
      ),
    ).toEqual({ kind: 'found', command: '/opt/tools/claude', source: 'path' });
    expect(await resolveClaudeCommand(lookup([], { PATH: '/usr/bin' }))).toMatchObject({
      kind: 'missing',
    });
  });
});
