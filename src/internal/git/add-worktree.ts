import { removeTree } from '#x/fs/remove-tree.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { canonicalWorktreeRoot } from './canonical-worktree-root.ts';
import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import { listWorktrees } from './list-worktrees.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import type { Worktree } from './parse-worktree-list.ts';
import { planWorktreePath } from './plan-worktree-path.ts';
import { pruneWorktrees } from './prune-worktrees.ts';
import { removeFailedAdd } from './remove-failed-add.ts';

export interface AddWorktreeRequest {
  /** Absolute directory that holds review worktrees; created if missing. */
  readonly root: string;
  readonly commit: CommitSha;
}

/** A checkout writes every file of the tree, so it gets longer than git's default timeout. */
const checkoutTimeout = Temporal.Duration.from({ minutes: 10 });

/**
 * Checks `commit` out as a detached worktree at its deterministic path under `root` (see
 * `planWorktreePath`). Idempotent: an existing worktree at that path on that commit is returned as
 * is; a registered worktree whose directory has gone is pruned and checked out again. Hooks don't
 * run (`core.hooksPath` is disabled for every command).
 *
 * `atomic` (ADR 0079): an abort lets the checkout finish and then reports `aborted`, since a
 * checkout stopped halfway would stay registered with files missing. A directory at the path that
 * git doesn't know (left by a crash or a timeout) is beuve's own and is removed first, and a
 * failed add removes what it left, so the next add starts clean. Both removals first reopen the
 * directories a read-only checkout closed (`removeTree`).
 */
export async function addWorktree(
  repository: GitRepository,
  request: AddWorktreeRequest,
): Promise<Result<Worktree, GitError>> {
  const root = await canonicalWorktreeRoot(request.root);
  if (!root.ok) {
    return root;
  }
  const target = planWorktreePath(root.value, repository.root, request.commit);
  if (!target.ok) {
    return target;
  }
  const existing = await listWorktrees(repository);
  if (!existing.ok) {
    return existing;
  }
  const found = existing.value.find((worktree) => worktree.path === target.value);
  if (found?.prunable !== undefined) {
    const pruned = await pruneWorktrees(repository);
    if (!pruned.ok) {
      return pruned;
    }
  } else if (found !== undefined) {
    if (found.head === request.commit) {
      return ok(found);
    }
    return err({
      kind: 'worktree-conflict',
      path: target.value,
      reason: `HEAD is ${found.head ?? 'unborn'}`,
    });
  }
  await removeTree(target.value);
  const added = await repository[gitRunner].exec(
    ['worktree', 'add', '--detach', '--end-of-options', target.value, request.commit],
    { policy: { kind: 'atomic' }, timeout: checkoutTimeout },
  );
  if (!added.ok) {
    if (added.error.kind !== 'aborted') {
      await removeFailedAdd(repository, target.value);
    }
    return added;
  }
  return ok({
    path: target.value,
    head: request.commit,
    checkout: { kind: 'detached' },
    locked: undefined,
    prunable: undefined,
  });
}
