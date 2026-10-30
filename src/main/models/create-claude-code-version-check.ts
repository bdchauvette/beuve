import { stat } from 'node:fs/promises';

import type { ModelError } from '#internal/llm/language-model.ts';
import { LruCache } from '#x/collections/lru-cache.ts';
import type { Result } from '#x/result/result.ts';

import { checkClaudeCodeVersion } from './check-claude-code-version.ts';

/** {@link checkClaudeCodeVersion}'s signature. */
export type ClaudeCodeVersionCheck = (
  command: string,
  leadingArgs?: readonly string[],
) => Promise<Result<string, ModelError>>;

/**
 * Runs `check` once per executable as it is on disk (ADR 0070): the answer is kept by path,
 * leading arguments, size and modification time, so an updated `claude` is checked again and an
 * unchanged one isn't on every request. A command that can't be read (`stat` fails) is checked
 * every time, and a `not-installed` answer is never kept, since it may be a passing timeout.
 * Concurrent requests share one run.
 */
export function createClaudeCodeVersionCheck(
  check: ClaudeCodeVersionCheck = checkClaudeCodeVersion,
): ClaudeCodeVersionCheck {
  const checked = new LruCache<string, Promise<Result<string, ModelError>>>(16);
  return async (command, leadingArgs = []): Promise<Result<string, ModelError>> => {
    const identity = await fileIdentityOf(command);
    if (identity === undefined) {
      return check(command, leadingArgs);
    }
    const key = JSON.stringify([command, leadingArgs, identity]);
    const running = checked.get(key) ?? check(command, leadingArgs);
    checked.set(key, running);
    const result = await running;
    if (!result.ok && result.error.kind === 'not-installed') {
      checked.delete(key);
    }
    return result;
  };
}

/** The file's size and modification time in nanoseconds, or `undefined` if it can't be read. */
async function fileIdentityOf(file: string): Promise<string | undefined> {
  try {
    const stats = await stat(file, { bigint: true });
    return `${String(stats.size)}:${String(stats.mtimeNs)}`;
  } catch {
    return undefined;
  }
}
