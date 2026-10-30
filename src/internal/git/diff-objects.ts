import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { DiffFile } from './diff-model.ts';
import type { GitError } from './git-error.ts';
import type { CommitSha, TreeSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { parseUnifiedDiff } from './parse-unified-diff.ts';

export interface DiffObjectsOptions {
  /** Lines of context around each change. Defaults to 3. */
  readonly contextLines?: number;
  /** Limit the diff to these repository-relative paths (matched literally). */
  readonly paths?: readonly string[];
  /**
   * Compare lines ignoring all whitespace (`--ignore-all-space`, GitHub's "hide whitespace").
   * Files whose only changes are whitespace drop out of the diff; line numbers stay exact.
   */
  readonly ignoreWhitespace?: boolean;
}

/**
 * Diffs two commits or trees directly (`from` → `to`, no merge-base), with rename detection and
 * full blob names, and parses the patch. External diff drivers and textconv filters are disabled
 * so repository config can't run programs or rewrite what the reviewer sees.
 */
export async function diffObjects(
  repository: GitRepository,
  from: CommitSha | TreeSha,
  to: CommitSha | TreeSha,
  options: DiffObjectsOptions = {},
): Promise<Result<readonly DiffFile[], GitError>> {
  const contextLines = options.contextLines ?? 3;
  if (!Number.isSafeInteger(contextLines) || contextLines < 0) {
    return err({
      kind: 'invalid-argument',
      argument: String(contextLines),
      reason: 'contextLines must be a non-negative integer',
    });
  }
  const args = [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--full-index',
    '--find-renames',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    `--unified=${String(contextLines)}`,
    ...(options.ignoreWhitespace === true ? ['--ignore-all-space'] : []),
    '--end-of-options',
    from,
    to,
    '--',
    ...(options.paths ?? []),
  ];
  const output = await repository.run(args);
  if (!output.ok) {
    return output;
  }
  const parsed = parseUnifiedDiff(output.value);
  return parsed.ok
    ? ok(
        options.ignoreWhitespace === true
          ? parsed.value.filter((file) => hasVisibleChange(file))
          : parsed.value,
      )
    : err({
        kind: 'unexpected-output',
        args,
        message: `line ${String(parsed.error.line)}: ${parsed.error.message}`,
      });
}

/** Older gits print a bare header for a file whose changes `-w` hid; such a file shows nothing. */
function hasVisibleChange(file: DiffFile): boolean {
  return (
    file.status !== 'modified' ||
    file.binary ||
    file.hunks.length > 0 ||
    file.oldMode !== file.newMode
  );
}
