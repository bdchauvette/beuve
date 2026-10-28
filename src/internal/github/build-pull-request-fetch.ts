import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

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
  if (input.baseBranch !== undefined && !isBranchName(input.baseBranch)) {
    return err(`not a safe branch name: ${input.baseBranch}`);
  }
  const prefix = `refs/beuve/pr/${String(input.number)}`;
  const headRef = `${prefix}/head`;
  const baseRef = input.baseBranch === undefined ? undefined : `${prefix}/base`;
  return ok({
    args: [
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      '--end-of-options',
      input.remote,
      `+refs/pull/${String(input.number)}/head:${headRef}`,
      ...(input.baseBranch === undefined ? [] : [`+refs/heads/${input.baseBranch}:${prefix}/base`]),
    ],
    headRef,
    baseRef,
  });
}

const remoteName = /^[\w.-]+$/;
const branchCharacters = /^[\w./-]+$/;

function isRemote(remote: string): boolean {
  if (remote.startsWith('https://')) {
    try {
      const url = new URL(remote);
      return url.username === '' && url.password === '' && url.search === '' && url.hash === '';
    } catch {
      return false;
    }
  }
  return remoteName.test(remote) && !remote.startsWith('-') && !remote.startsWith('.');
}

/** A conservative subset of `git check-ref-format --branch`. */
function isBranchName(name: string): boolean {
  return (
    branchCharacters.test(name) &&
    !name.startsWith('-') &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock') &&
    !name.includes('..') &&
    !name.includes('//') &&
    name.split('/').every((segment) => !segment.startsWith('.'))
  );
}
