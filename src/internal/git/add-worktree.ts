import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { err } from '#x/result/err.ts';
import { fromPromise } from '#x/result/from-promise.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { listWorktrees } from './list-worktrees.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';
import type { Worktree } from './parse-worktree-list.ts';
import { planWorktreePath } from './plan-worktree-path.ts';
import { pruneWorktrees } from './prune-worktrees.ts';

export interface AddWorktreeRequest {
  /** Absolute directory that holds review worktrees; created if missing. */
  readonly root: string;
  readonly commit: CommitSha;
}

/**
 * Checks `commit` out as a detached worktree at its deterministic path under `root` (see
 * `planWorktreePath`). Idempotent: an existing worktree at that path on that commit is returned as
 * is; a registered worktree whose directory has gone is pruned and checked out again. Hooks don't run (`core.hooksPath` is disabled for every command).
 */
export async function addWorktree(
  repository: GitRepository,
  request: AddWorktreeRequest,
): Promise<Result<Worktree, GitError>> {
  const root = await canonicalRoot(request.root);
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
    return found.head === request.commit
      ? ok(found)
      : err({
          kind: 'worktree-conflict',
          path: target.value,
          reason: `HEAD is ${found.head ?? 'unborn'}`,
        });
  }
  const added = await repository.run([
    'worktree',
    'add',
    '--detach',
    '--end-of-options',
    target.value,
    request.commit,
  ]);
  if (!added.ok) {
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

/** Resolves symlinks (macOS `/tmp` → `/private/tmp`) so paths match what git records. */
async function canonicalRoot(root: string): Promise<Result<string, GitError>> {
  if (!path.isAbsolute(root)) {
    return err({
      kind: 'invalid-argument',
      argument: root,
      reason: 'worktree root must be absolute',
    });
  }
  return fromPromise(
    (async (): Promise<string> => {
      await mkdir(root, { recursive: true });
      return realpath(root);
    })(),
    (cause): GitError => ({ kind: 'invalid-argument', argument: root, reason: String(cause) }),
  );
}
