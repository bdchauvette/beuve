import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { describeClaudeStatus } from './describe-claude-status.ts';

describe('describeClaudeStatus', () => {
  test('names the version and where the CLI was found', ({ expect }) => {
    expect(
      describeClaudeStatus({
        kind: 'found',
        command: '/opt/homebrew/bin/claude',
        source: 'known-location',
        version: '2.1.7 (Claude Code)',
      }),
    ).toStrictEqual({
      tone: 'ok',
      text: '2.1.7 (Claude Code)',
      detail: '/opt/homebrew/bin/claude (from its install location)',
    });
    expect(
      describeClaudeStatus({ kind: 'found', command: 'claude', source: 'path' }),
    ).toMatchObject({
      tone: 'muted',
    });
  });

  test('passes on how to fix a missing CLI', ({ expect }) => {
    expect(describeClaudeStatus({ kind: 'missing', message: 'Install it.' })).toStrictEqual({
      tone: 'warn',
      text: 'Claude Code not found',
      detail: 'Install it.',
    });
  });
});
