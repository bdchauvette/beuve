import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { readClaudeStatus } from './read-claude-status.ts';

describe('readClaudeStatus', () => {
  test('names the CLI it found and the version it prints', async ({ expect, tempDir }) => {
    const command = path.join(tempDir, 'claude');
    writeFileSync(command, '#!/bin/sh\necho "2.1.7 (Claude Code)"\necho extra\n');
    chmodSync(command, 0o755);
    await expect(
      readClaudeStatus({ env: { BEUVE_CLAUDE_PATH: command, PATH: '' }, homeDirectory: tempDir }),
    ).resolves.toStrictEqual({
      kind: 'found',
      command,
      source: 'env',
      version: '2.1.7 (Claude Code)',
    });
  });

  test('leaves the version out when the CLI does not answer it', async ({ expect, tempDir }) => {
    const command = path.join(tempDir, 'claude');
    writeFileSync(command, '#!/bin/sh\nexit 3\n');
    chmodSync(command, 0o755);
    await expect(
      readClaudeStatus({ env: { BEUVE_CLAUDE_PATH: command }, homeDirectory: tempDir }),
    ).resolves.toStrictEqual({ kind: 'found', command, source: 'env' });
  });
});
