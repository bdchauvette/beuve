import { createHash } from 'node:crypto';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { BranchRef } from './branch-ref.ts';
import { isSafeBranchName } from './is-safe-branch-name.ts';

/** The refspecs that bring a followed branch and its base into the clone, and where they land. */
export interface BranchFetch {
  /** `+refs/heads/<branch>:<headRef>` and `+refs/heads/<default>:<baseRef>`, for `fetchRefs`. */
  readonly refspecs: readonly string[];
  /** `refs/beuve/branch/<key>/head`. */
  readonly headRef: string;
  /** `refs/beuve/branch/<key>/base`: the session's `baseRef`. */
  readonly baseRef: string;
}

/** A followed branch and the repository's default branch it is diffed against. */
export interface BranchFetchInput {
  readonly ref: BranchRef;
  readonly defaultBranch: string;
}

/**
 * Where a followed branch is fetched to (ADR 0112): under `refs/beuve/branch/<key>/`, where
 * `<key>` is 24 hex digits of SHA-256 over the lowercase repository and the branch, because
 * branch names nest (`a` and `a/b`) and repository names may start with a dot, neither of which
 * a ref can hold as is. Force-updating refspecs follow force-pushes. Pure.
 */
export function buildBranchFetch({
  ref,
  defaultBranch,
}: BranchFetchInput): Result<BranchFetch, string> {
  if (!isSafeBranchName(ref.branch)) {
    return err(`not a safe branch name: ${ref.branch}`);
  }
  if (!isSafeBranchName(defaultBranch)) {
    return err(`not a safe branch name: ${defaultBranch}`);
  }
  const repository = `${ref.host}/${ref.owner}/${ref.repo}`.toLowerCase();
  const key = createHash('sha256')
    .update(`${repository}\0${ref.branch}`)
    .digest('hex')
    .slice(0, 24);
  const headRef = `refs/beuve/branch/${key}/head`;
  const baseRef = `refs/beuve/branch/${key}/base`;
  return ok({
    refspecs: [`+refs/heads/${ref.branch}:${headRef}`, `+refs/heads/${defaultBranch}:${baseRef}`],
    headRef,
    baseRef,
  });
}
