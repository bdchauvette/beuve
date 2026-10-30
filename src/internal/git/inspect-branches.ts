import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import type { GitRepository } from './open-repository.ts';

/** A local or remote-tracking branch, by its short name (`main`, `origin/main`). */
export interface Branch {
  readonly name: string;
  readonly isRemote: boolean;
  /** The tip's committer date, ISO 8601. */
  readonly committedAt: string;
}

/** What a reviewer needs to pick a base and a head: the branches and sensible defaults. */
export interface BranchInspection {
  /** The checked-out branch; absent on a detached head. */
  readonly current?: string;
  /** `origin/HEAD`'s target, else `main` or `master` if one exists. */
  readonly defaultBase?: string;
  /** Most recently committed first, at most `limit`. */
  readonly branches: readonly Branch[];
}

const fieldSeparator = '\u{1F}';
const branchPrefix = /^refs\/(?:heads|remotes)\//u;

/**
 * Lists local and remote-tracking branches newest first and works out the current branch and a
 * default base, for suggesting refs when opening a local session. Remote `HEAD` symrefs are left
 * out of the list.
 */
export async function inspectBranches(
  repository: GitRepository,
  limit = 200,
): Promise<Result<BranchInspection, GitError>> {
  const listed = await repository.run([
    'for-each-ref',
    '--sort=-committerdate',
    `--count=${String(limit)}`,
    `--format=%(refname)${fieldSeparator}%(committerdate:iso-strict)${fieldSeparator}%(symref)`,
    'refs/heads',
    'refs/remotes',
  ]);
  if (!listed.ok) {
    return listed;
  }
  const branches = parseBranches(listed.value);
  const current = await readSymbolicRef(repository, 'HEAD');
  const originHead = await readSymbolicRef(repository, 'refs/remotes/origin/HEAD');
  const defaultBase =
    originHead ?? ['main', 'master'].find((name) => branches.some((b) => b.name === name));
  return ok({
    ...(current !== undefined && { current }),
    ...(defaultBase !== undefined && { defaultBase }),
    branches,
  });
}

function parseBranches(output: string): Branch[] {
  return output.split('\n').flatMap((line): Branch[] => {
    const [refname = '', committedAt = '', symref = ''] = line.split(fieldSeparator);
    if (refname === '' || symref !== '') {
      return [];
    }
    const isRemote = refname.startsWith('refs/remotes/');
    const name = refname.replace(branchPrefix, '');
    return [{ name, isRemote, committedAt }];
  });
}

async function readSymbolicRef(
  repository: GitRepository,
  ref: string,
): Promise<string | undefined> {
  const read = await repository.run(['symbolic-ref', '--quiet', '--short', ref]);
  const name = read.ok ? read.value.trim() : '';
  return name === '' ? undefined : name;
}
