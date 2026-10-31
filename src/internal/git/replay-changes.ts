import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { findMergeBase } from './find-merge-base.ts';
import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import { isObjectId } from './is-object-id.ts';
import { isVersionAtLeast } from './is-version-at-least.ts';
import type { CommitSha, TreeSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import type { GitVersion } from './parse-git-version.ts';

/** Re-apply the changes `from` → `to` on top of `onto`. */
export interface ReplayRequest {
  readonly from: CommitSha;
  readonly to: CommitSha;
  readonly onto: CommitSha;
}

export type ReplayOutcome =
  | { readonly kind: 'clean'; readonly tree: TreeSha }
  /** `tree` contains conflict markers in `paths`. */
  | { readonly kind: 'conflicted'; readonly tree: TreeSha; readonly paths: readonly string[] }
  | { readonly kind: 'unsupported'; readonly version: GitVersion; readonly required: string };

/**
 * Synthesizes, without touching any worktree or ref, the tree that replaying `from..to` onto `onto`
 * would produce: a three-way merge of `onto` and `to` with `from` as the base, via
 * `git merge-tree --write-tree`. Git 2.40 accepts the explicit base; 2.38–2.39 can only merge with
 * the computed merge-base, so they're used only when that already equals `from`. `owned-write`
 * (ADR 0079): a stopped merge leaves only unreferenced objects, which gc drops.
 */
export async function replayChanges(
  repository: GitRepository,
  request: ReplayRequest,
): Promise<Result<ReplayOutcome, GitError>> {
  const { version } = repository;
  if (!isVersionAtLeast(version, { major: 2, minor: 38 })) {
    return ok({ kind: 'unsupported', version, required: '2.38' });
  }
  const canNameBase = isVersionAtLeast(version, { major: 2, minor: 40 });
  if (!canNameBase) {
    const implied = await findMergeBase(repository, [request.onto, request.to]);
    if (!implied.ok && implied.error.kind !== 'no-merge-base') {
      return implied;
    }
    if (!implied.ok || implied.value !== request.from) {
      return ok({ kind: 'unsupported', version, required: '2.40' });
    }
  }
  const args = ['merge-tree', '--write-tree', '--name-only', '-z', '--no-messages'];
  if (canNameBase) {
    args.push(`--merge-base=${request.from}`);
  }
  args.push('--end-of-options', request.onto, request.to);
  const output = await repository[gitRunner].run(args, { policy: { kind: 'owned-write' } });
  if (output.ok) {
    return parseMergeTreeOutput(args, output.value, false);
  }
  const { error } = output;
  if (error.kind === 'command-failed' && error.exitCode === 1) {
    return parseMergeTreeOutput(args, error.stdout, true);
  }
  return output;
}

/** `<tree>\0<conflicted path>\0…` with `--name-only -z --no-messages`. */
function parseMergeTreeOutput(
  args: readonly string[],
  stdout: string,
  isConflicted: boolean,
): Result<ReplayOutcome, GitError> {
  const [tree = '', ...rest] = stdout.split('\0');
  if (!isObjectId(tree)) {
    return err({ kind: 'unexpected-output', args, message: `not a tree id: ${tree}` });
  }
  const paths = [...new Set(rest.filter((path) => path !== ''))];
  if (isConflicted) {
    return ok({ kind: 'conflicted', tree: tree as TreeSha, paths });
  }
  return ok({ kind: 'clean', tree: tree as TreeSha });
}
