import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { isSafeBranchName } from './is-safe-branch-name.ts';

export interface PullRequestFetch {
  /** `git` arguments, for main to run through the git domain's runner (no shell). */
  readonly args: readonly string[];
  /** Where the head lands: `refs/beuve/pr/<n>/head`. */
  readonly headRef: string;
  /** Where the base branch lands, when `baseBranch` was given: `refs/beuve/pr/<n>/base`. */
  readonly baseRef: string | undefined;
}

export interface PullRequestFetchInput {
  readonly number: number;
  /** A configured remote name, or the base repository's HTTPS URL (`buildGithubRemoteUrl`). */
  readonly remote: string;
  /** The pull request's base branch name, e.g. `main`. */
  readonly baseBranch?: string;
}

/**
 * How to bring a pull request's head into the local repository (ADR 0035): GitHub keeps every
 * pull request's head, forks included, at `refs/pull/<n>/head` in the base repository, so one
 * fetch from there works for all of them. Force-updating refspecs follow force-pushes; the refs
 * live under `refs/beuve/` so they never collide with the user's branches. After fetching, main
 * should check the head ref resolves to the SHA GitHub reported. Pure.
 */
export function buildPullRequestFetch(
  input: PullRequestFetchInput,
): Result<PullRequestFetch, string> {
  if (!Number.isSafeInteger(input.number) || input.number < 1) {
    return err(`not a pull request number: ${String(input.number)}`);
  }
  if (!isRemote(input.remote)) {
    return err(`not a remote name or https URL: ${input.remote}`);
  }
  if (input.baseBranch !== undefined && !isSafeBranchName(input.baseBranch)) {
    return err(`not a safe branch name: ${input.baseBranch}`);
  }
  const prefix = `refs/beuve/pr/${String(input.number)}`;
  const headRef = `${prefix}/head`;
  const args = [
    'fetch',
    '--no-tags',
    '--no-write-fetch-head',
    '--end-of-options',
    input.remote,
    `+refs/pull/${String(input.number)}/head:${headRef}`,
  ];
  if (input.baseBranch === undefined) {
    return ok({ args, headRef, baseRef: undefined });
  }
  const baseRef = `${prefix}/base`;
  args.push(`+refs/heads/${input.baseBranch}:${baseRef}`);
  return ok({ args, headRef, baseRef });
}

const remoteName = /^[\w.-]+$/;

function isRemote(remote: string): boolean {
  if (remote.startsWith('https://')) {
    const url = URL.parse(remote);
    return (
      url !== null &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  }
  return remoteName.test(remote) && !remote.startsWith('-') && !remote.startsWith('.');
}
