import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { errorFrom } from '#x/error/error-from.ts';
import { err } from '#x/result/err.ts';
import { fromPromise } from '#x/result/from-promise.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';

/**
 * Creates a worktree root (0700, ADR 0082) if it is missing and resolves its symlinks (macOS
 * `/tmp` → `/private/tmp`), so planned paths match what git records.
 */
export async function canonicalWorktreeRoot(root: string): Promise<Result<string, GitError>> {
  if (!path.isAbsolute(root)) {
    return err({
      kind: 'invalid-argument',
      argument: root,
      reason: 'worktree root must be absolute',
    });
  }
  return fromPromise(
    (async (): Promise<string> => {
      await mkdir(root, { recursive: true, mode: 0o700 });
      return realpath(root);
    })(),
    (cause): GitError => {
      return {
        kind: 'invalid-argument',
        argument: root,
        reason: errorFrom(cause).message,
      };
    },
  );
}
