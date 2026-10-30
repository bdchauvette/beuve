import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { isVersionAtLeast } from './is-version-at-least.ts';
import type { CommitSha, TreeSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { parseCommitSha } from './parse-commit-sha.ts';
import { replayChanges } from './replay-changes.ts';
import type { ReplayOutcome } from './replay-changes.ts';

/** One commit to re-apply: its change `parent` → `commit`. */
export interface ReplayStep {
  readonly parent: CommitSha;
  readonly commit: CommitSha;
}

/**
 * Re-applies `steps` one by one on top of `onto`, like a rebase that never touches a ref or a
 * worktree: each step is a `merge-tree` three-way merge with the step's parent as the base. Git
 * 2.43 merges only commits, so every intermediate tree is wrapped in a dangling commit object
 * (`commit-tree`, fixed identity), left for gc like `merge-tree`'s own trees. Stops at the first
 * conflicted step. Needs git 2.40 (`--merge-base`); an empty `steps` replays to `onto`'s tree.
 */
export async function replayCommits(
  repository: GitRepository,
  onto: CommitSha,
  steps: readonly ReplayStep[],
): Promise<Result<ReplayOutcome, GitError>> {
  if (!isVersionAtLeast(repository.version, 2, 40)) {
    return ok({ kind: 'unsupported', version: repository.version, required: '2.40' });
  }
  let current = onto;
  let outcome: ReplayOutcome | undefined;
  for (const [index, step] of steps.entries()) {
    const replayed = await replayChanges(repository, {
      from: step.parent,
      to: step.commit,
      onto: current,
    });
    if (!replayed.ok || replayed.value.kind !== 'clean') {
      return replayed;
    }
    outcome = replayed.value;
    if (index === steps.length - 1) {
      continue;
    }
    const wrapped = await wrapTree(repository, replayed.value.tree, current);
    if (!wrapped.ok) {
      return wrapped;
    }
    current = wrapped.value;
  }
  if (outcome !== undefined) {
    return ok(outcome);
  }
  const tree = await repository.run([
    'rev-parse',
    '--verify',
    '--end-of-options',
    onto + '^{tree}',
  ]);
  return tree.ok ? ok({ kind: 'clean', tree: tree.value.trim() as TreeSha }) : tree;
}

async function wrapTree(
  repository: GitRepository,
  tree: TreeSha,
  parent: CommitSha,
): Promise<Result<CommitSha, GitError>> {
  const args = [
    '-c',
    'user.name=beuve',
    '-c',
    'user.email=beuve@localhost',
    'commit-tree',
    '-p',
    parent,
    '-m',
    'beuve replay',
    '--end-of-options',
    tree,
  ];
  const output = await repository.run(args);
  if (!output.ok) {
    return output;
  }
  const sha = parseCommitSha(output.value.trim());
  return sha === undefined
    ? err({ kind: 'unexpected-output', args, message: `not a commit id: ${output.value}` })
    : ok(sha);
}
