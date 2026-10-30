import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { isVersionAtLeast } from './is-version-at-least.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { parseCheckAttr } from './parse-check-attr.ts';
import type { DiffAttributes } from './parse-check-attr.ts';

/**
 * The `linguist-generated` and `diff` attributes of `paths` as `.gitattributes` at `commit`
 * says (ADR 0052), in one `git check-attr --source=<commit> -z --stdin` call, so neither the
 * working tree nor the index matters. Only paths with an attribute specified are in the map.
 * Needs git 2.40 for `--source`; older gits fail with `unsupported-git-version`.
 */
export async function readDiffAttributes(
  repository: GitRepository,
  commit: CommitSha,
  paths: readonly string[],
): Promise<Result<ReadonlyMap<string, DiffAttributes>, GitError>> {
  if (!isVersionAtLeast(repository.version, 2, 40)) {
    return err({ kind: 'unsupported-git-version', found: repository.version, required: '2.40' });
  }
  if (paths.length === 0) {
    return ok(new Map());
  }
  const output = await repository.exec(
    ['check-attr', `--source=${commit}`, '-z', '--stdin', 'linguist-generated', 'diff'],
    { input: paths.map((path) => `${path}\0`).join('') },
  );
  return output.ok ? ok(parseCheckAttr(output.value.toString('utf8'))) : output;
}
