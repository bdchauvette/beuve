import { constants } from 'node:fs';
import { cp } from 'node:fs/promises';
import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import { isObjectId } from './is-object-id.ts';
import type { TreeSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';

/**
 * The tree a working tree holds right now, uncommitted and untracked (not ignored) files
 * included, as a tree object: `git add -A` and `git write-tree` on a temporary index in
 * `scratch` (an empty directory the caller owns and removes), seeded from a copy of the
 * worktree's own index so unchanged files aren't hashed again. The worktree's real index, its
 * branch and its files are never touched, and nothing is committed (ADR 0088). `repository` is
 * opened at the worktree. `owned-write`: it writes only unreferenced objects, which gc drops.
 */
export async function snapshotWorktree(
  repository: GitRepository,
  scratch: string,
): Promise<Result<TreeSha, GitError>> {
  if (!path.isAbsolute(scratch)) {
    return err({ kind: 'invalid-argument', argument: scratch, reason: 'path must be absolute' });
  }
  const runner = repository[gitRunner];
  const own = await runner.run(['rev-parse', '--path-format=absolute', '--git-path', 'index'], {
    policy: { kind: 'read' },
  });
  if (!own.ok) {
    return own;
  }
  const indexFile = path.join(scratch, 'index');
  await seedIndex({ from: own.value.trim(), to: indexFile });
  const added = await runner.exec(['add', '--all', '--', '.'], {
    policy: { kind: 'owned-write' },
    indexFile,
  });
  if (!added.ok) {
    return added;
  }
  const written = await runner.exec(['write-tree'], { policy: { kind: 'owned-write' }, indexFile });
  if (!written.ok) {
    return written;
  }
  const tree = written.value.toString('utf8').trim();
  if (!isObjectId(tree)) {
    return err({ kind: 'unexpected-output', args: ['write-tree'], message: tree });
  }
  return ok(tree as TreeSha);
}

/** The worktree's index, and where its copy goes. */
interface IndexCopy {
  readonly from: string;
  readonly to: string;
}

/**
 * Copies the worktree's index as the starting point, keeping its modification time: git trusts an
 * entry's cached stat only when the file changed before the index was written (its "racy git"
 * check), so a copy with a fresh time would hide an edit made in the same second as the checkout.
 * Without an index, git starts from empty and hashes every file.
 */
async function seedIndex({ from, to }: IndexCopy): Promise<void> {
  try {
    await cp(from, to, { preserveTimestamps: true, mode: constants.COPYFILE_EXCL });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
