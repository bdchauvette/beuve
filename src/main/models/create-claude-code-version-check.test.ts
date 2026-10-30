import path from 'node:path';

import { describe } from 'vitest';

import type { ModelError } from '#internal/llm/language-model.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { createClaudeCodeVersionCheck } from './create-claude-code-version-check.ts';
import type { ClaudeCodeVersionCheck } from './create-claude-code-version-check.ts';
import { writeVersionCommand } from './testing/write-version-command.ts';
import { test } from '../testing/test.ts';

/** A check that answers `answer` and records each command it ran for. */
function countingCheck(answer: () => Result<string, ModelError>): {
  readonly check: ClaudeCodeVersionCheck;
  readonly runs: string[];
} {
  const runs: string[] = [];
  return {
    runs,
    check: async (command): Promise<Result<string, ModelError>> => {
      runs.push(command);
      await Promise.resolve();
      return answer();
    },
  };
}

describe('createClaudeCodeVersionCheck', () => {
  test('checks an executable once until it changes on disk', async ({ expect, tempDir }) => {
    const { check, runs } = countingCheck(() => ok('2.1.314'));
    const cached = createClaudeCodeVersionCheck(check);
    const claude = writeVersionCommand(tempDir, 'claude', '2.1.314 (Claude Code)');
    const answers = await Promise.all([cached(claude), cached(claude)]);
    await expect(cached(claude)).resolves.toStrictEqual(ok('2.1.314'));
    expect(answers).toStrictEqual([ok('2.1.314'), ok('2.1.314')]);
    expect(runs).toStrictEqual([claude]);

    writeVersionCommand(tempDir, 'claude', '2.1.400 (Claude Code), updated');
    await cached(claude);
    expect(runs).toStrictEqual([claude, claude]);
    const other = writeVersionCommand(tempDir, 'other', '2.1.314 (Claude Code)');
    await cached(other);
    expect(runs).toStrictEqual([claude, claude, other]);
  });

  test('keeps no answer for a missing file or a command that did not answer', async ({
    expect,
    tempDir,
  }) => {
    const missing = path.join(tempDir, 'nowhere', 'claude');
    const { check, runs } = countingCheck(() => err({ kind: 'not-installed', command: missing }));
    const cached = createClaudeCodeVersionCheck(check);
    await cached(missing);
    await cached(missing);
    const silent = writeVersionCommand(tempDir, 'claude', 'no version');
    await cached(silent);
    await cached(silent);
    expect(runs).toStrictEqual([missing, missing, silent, silent]);
  });

  test('runs the real check by default', async ({ expect, tempDir }) => {
    const claude = writeVersionCommand(tempDir, 'claude', '2.1.200 (Claude Code)');
    await expect(createClaudeCodeVersionCheck()(claude)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'unsupported-version', version: '2.1.200' },
    });
  });
});
