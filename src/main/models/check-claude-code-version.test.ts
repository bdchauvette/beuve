import path from 'node:path';

import { describe } from 'vitest';

import { pinnedClaudeCodeVersion } from '#internal/llm/pinned-claude-code-version.ts';

import { checkClaudeCodeVersion } from './check-claude-code-version.ts';
import { writeVersionCommand } from './testing/write-version-command.ts';
import { test } from '../testing/test.ts';

describe('checkClaudeCodeVersion', () => {
  test.for([
    [`${pinnedClaudeCodeVersion} (Claude Code)`, true],
    ['2.1.314 (Claude Code)', true],
    ['3.0.0 (Claude Code)', true],
    ['2.1.200 (Claude Code)', false],
    ['1.9.999', false],
  ] as const)('accepts %s: %s', async ([output, isAccepted], { expect, tempDir }) => {
    const command = writeVersionCommand(tempDir, 'claude', output);
    const checked = await checkClaudeCodeVersion(command);
    expect(checked.ok).toBe(isAccepted);
  });

  test('names the versions when the CLI is too old, and a missing CLI', async ({
    expect,
    tempDir,
  }) => {
    const command = writeVersionCommand(tempDir, 'claude', '2.1.200 (Claude Code)');
    await expect(checkClaudeCodeVersion(command)).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'unsupported-version',
        command,
        version: '2.1.200',
        required: pinnedClaudeCodeVersion,
      },
    });
    const missing = path.join(tempDir, 'nowhere', 'claude');
    await expect(checkClaudeCodeVersion(missing)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'not-installed', command: missing },
    });
    const silent = writeVersionCommand(tempDir, 'quiet', 'no version here');
    await expect(checkClaudeCodeVersion(silent)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not-installed' },
    });
  });
});
