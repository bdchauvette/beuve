import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { GitRepository } from './open-repository.ts';

export interface FetchRefsOptions {
  /** Kill git after this long. Defaults to 2 minutes, since it talks to the network. */
  readonly timeout?: Temporal.Duration;
  /** Kills the fetch when it aborts (`aborted`). */
  readonly signal?: AbortSignal | undefined;
}

const defaultTimeout = Temporal.Duration.from({ minutes: 2 });
const maxRefspecs = 32;
const remoteName = /^[\w.-]{1,200}$/u;
const refspecPattern = /^(\+?)(refs\/[^:]+):(refs\/[^:]+)$/u;
const refCharacters = /^[\w./-]+$/u;
const ownedPrefix = 'refs/beuve/';

/**
 * Fetches `refspecs` (`[+]refs/<src>:refs/beuve/<dst>`) from `remote` (a configured remote's name
 * or a credential-free `https://` URL) without a shell: no tags, no `FETCH_HEAD`, no submodules,
 * no auto-gc, no remote-tracking updates (`--refmap=`), `--end-of-options` before the remote and
 * a timeout. Destinations must lie under `refs/beuve/`, so a fetch never moves the user's branches
 * or remote-tracking refs.
 * Credentials come from the user's own git configuration; git never prompts.
 *
 * `owned-write` (ADR 0079): it writes objects and `refs/beuve/` only, and on the SIGTERM an abort
 * sends, git removes its ref locks and temporary packs itself. Refs a stopped fetch did update
 * are caches its callers verify against the API before use, so nothing more needs undoing.
 */
export async function fetchRefs(
  repository: GitRepository,
  remote: string,
  refspecs: readonly string[],
  options: FetchRefsOptions = {},
): Promise<Result<void, GitError>> {
  const invalid = remoteProblem(remote) ?? refspecsProblem(refspecs);
  if (invalid !== undefined) {
    return err({ kind: 'invalid-argument', argument: invalid.argument, reason: invalid.reason });
  }
  const args = [
    'fetch',
    '--quiet',
    '--no-tags',
    '--no-write-fetch-head',
    '--no-recurse-submodules',
    '--no-auto-gc',
    // No opportunistic update of `refs/remotes/<remote>/*` from the configured refspec.
    '--refmap=',
    '--end-of-options',
    remote,
    ...refspecs,
  ];
  const fetched = await repository[gitRunner].exec(args, {
    policy: { kind: 'owned-write' },
    timeout: options.timeout ?? defaultTimeout,
    signal: options.signal,
  });
  if (fetched.ok) {
    return ok(undefined);
  }
  return fetched;
}

interface Problem {
  readonly argument: string;
  readonly reason: string;
}

function remoteProblem(remote: string): Problem | undefined {
  if (remote.startsWith('https://')) {
    const url = URL.parse(remote);
    if (url === null) {
      return { argument: remote, reason: 'not a URL' };
    }
    if (url.username === '' && url.password === '' && url.search === '' && url.hash === '') {
      return undefined;
    }
    return {
      argument: remote,
      reason: 'remote URLs may not carry credentials, a query or a fragment',
    };
  }
  if (remoteName.test(remote) && !remote.startsWith('-') && !remote.startsWith('.')) {
    return undefined;
  }
  return { argument: remote, reason: 'not a remote name or https URL' };
}

function refspecsProblem(refspecs: readonly string[]): Problem | undefined {
  if (refspecs.length === 0 || refspecs.length > maxRefspecs) {
    return {
      argument: String(refspecs.length),
      reason: `expected 1 to ${String(maxRefspecs)} refspecs`,
    };
  }
  for (const refspec of refspecs) {
    const match = refspecPattern.exec(refspec);
    const source = match?.[2] ?? '';
    const destination = match?.[3] ?? '';
    if (match === null || !isSafeRef(source) || !isSafeRef(destination)) {
      return { argument: refspec, reason: 'expected [+]refs/<source>:refs/<destination>' };
    }
    if (!destination.startsWith(ownedPrefix)) {
      return { argument: refspec, reason: `destinations must lie under ${ownedPrefix}` };
    }
  }
  return undefined;
}

/** A conservative subset of `git check-ref-format`: no globs, `..`, `@{`, or dot-led segments. */
function isSafeRef(ref: string): boolean {
  return (
    refCharacters.test(ref) &&
    !ref.endsWith('/') &&
    !ref.endsWith('.') &&
    !ref.endsWith('.lock') &&
    !ref.includes('..') &&
    !ref.includes('//') &&
    ref.split('/').every((segment) => segment !== '' && !segment.startsWith('.'))
  );
}
