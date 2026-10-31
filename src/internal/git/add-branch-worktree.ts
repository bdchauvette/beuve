import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { removeTree } from '#x/fs/remove-tree.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { canonicalWorktreeRoot } from './canonical-worktree-root.ts';
import { checkBranchName } from './check-branch-name.ts';
import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import { listWorktrees } from './list-worktrees.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import { planBranchWorktreePath } from './plan-branch-worktree-path.ts';
import { pruneWorktrees } from './prune-worktrees.ts';
import { removeFailedAdd } from './remove-failed-add.ts';
import { resolveRevision } from './resolve-revision.ts';

export interface AddBranchWorktreeRequest {
  /** Absolute directory that holds branch worktrees; created 0700 if missing. */
  readonly root: string;
  /** A local branch name, such as `review/pr-12`; checked with `check-ref-format --branch`. */
  readonly branch: string;
  /** Where a new branch starts. An existing branch keeps its own commits. */
  readonly base: CommitSha;
}

/** A writable branch worktree, and whether this call created its branch. */
export interface BranchWorktree {
  readonly path: string;
  readonly branch: string;
  readonly createdBranch: boolean;
}

/** A checkout writes every file of the tree, so it gets longer than git's default timeout. */
const checkoutTimeout = Temporal.Duration.from({ minutes: 10 });

/**
 * Checks `branch` out, writable, at its planned path under `root` (`planBranchWorktreePath`),
 * creating the branch at `base` when it doesn't exist (ADR 0088). Idempotent: a worktree already
 * there on that branch is returned as is; a registered one whose directory has gone is pruned and
 * checked out again, on the branch as it stands. Refuses a branch checked out in another worktree.
 * The directory is made owner-only (0700, ADR 0082). Hooks don't run.
 *
 * `atomic` (ADR 0079), like `addWorktree`: an abort lets the checkout finish and reports
 * `aborted`, and a failed add removes what it left.
 */
export async function addBranchWorktree(
  repository: GitRepository,
  request: AddBranchWorktreeRequest,
): Promise<Result<BranchWorktree, GitError>> {
  const branch = await checkBranchName(repository, request.branch);
  if (!branch.ok) {
    return branch;
  }
  const root = await canonicalWorktreeRoot(request.root);
  if (!root.ok) {
    return root;
  }
  const target = planBranchWorktreePath({
    root: root.value,
    repositoryRoot: repository.root,
    branch: branch.value,
  });
  if (!target.ok) {
    return target;
  }
  const placed = await placement(repository, { target: target.value, branch: branch.value });
  if (!placed.ok) {
    return placed;
  }
  if (placed.value === 'present') {
    return ok({ path: target.value, branch: branch.value, createdBranch: false });
  }
  const tip = await resolveRevision(repository, `refs/heads/${branch.value}`);
  const isNew = !tip.ok && tip.error.kind === 'unknown-revision';
  if (!isNew && !tip.ok) {
    return tip;
  }
  await removeTree(target.value);
  await mkdir(path.dirname(target.value), { recursive: true, mode: 0o700 });
  const args = ['worktree', 'add'];
  if (isNew) {
    args.push('--no-track', '-b', branch.value, '--end-of-options', target.value, request.base);
  } else {
    args.push('--end-of-options', target.value, branch.value);
  }
  const added = await repository[gitRunner].exec(args, {
    policy: { kind: 'atomic' },
    timeout: checkoutTimeout,
  });
  if (!added.ok) {
    if (added.error.kind !== 'aborted') {
      await removeFailedAdd(repository, target.value);
    }
    return added;
  }
  await chmod(target.value, 0o700);
  return ok({ path: target.value, branch: branch.value, createdBranch: isNew });
}

/** The planned path, and the branch that should be checked out there. */
interface Placement {
  readonly target: string;
  readonly branch: string;
}

/**
 * `present` when the branch is already checked out at `target`, `absent` when the path is free
 * (after pruning a record whose directory has gone), else a conflict.
 */
async function placement(
  repository: GitRepository,
  { target, branch }: Placement,
): Promise<Result<'present' | 'absent', GitError>> {
  const worktrees = await listWorktrees(repository);
  if (!worktrees.ok) {
    return worktrees;
  }
  const ref = `refs/heads/${branch}`;
  let isPrunable = false;
  for (const worktree of worktrees.value) {
    const isOnBranch = worktree.checkout.kind === 'branch' && worktree.checkout.ref === ref;
    if (worktree.prunable !== undefined) {
      isPrunable ||= worktree.path === target || isOnBranch;
      continue;
    }
    if (isOnBranch && worktree.path === target) {
      return ok('present');
    }
    if (isOnBranch || worktree.path === target) {
      return err({
        kind: 'worktree-conflict',
        path: worktree.path,
        reason: `${branch} is checked out at ${worktree.path}`,
      });
    }
  }
  if (isPrunable) {
    const pruned = await pruneWorktrees(repository);
    if (!pruned.ok) {
      return pruned;
    }
  }
  return ok('absent');
}
