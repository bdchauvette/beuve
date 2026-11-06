import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { normalizeHostname } from '#x/net/normalize-hostname.ts';
import type { BranchRef } from './branch-ref.ts';
import { isSafeBranchName } from './is-safe-branch-name.ts';

const ownerPattern = /^[a-z\d](?:[a-z\d-]{0,38})$/iu;
const repoPattern = /^[\w.-]{1,100}$/u;
const webUrl = /^https?:\/\//iu;
const segmentPattern = /^[^\s#/:]+$/u;

/** Where the branch is looked for when the text names no host. */
export interface BranchRefOptions {
  /** Defaults to `github.com`. */
  readonly defaultHost?: string;
}

/**
 * A branch from what a user pastes (ADR 0112): a tree URL (`https://github.com/o/r/tree/claude/x`,
 * where everything after `tree/` is the branch; GitHub Enterprise hosts too) or the shorthand
 * `owner/repo:branch` (on `defaultHost`) or `host/owner/repo:branch`. Owner and repository names
 * follow GitHub's rules and the branch {@link isSafeBranchName}, so all are safe in API paths and
 * refspecs. Pure.
 */
export function parseBranchRef(
  text: string,
  { defaultHost = 'github.com' }: BranchRefOptions = {},
): Result<BranchRef, string> {
  const input = text.trim();
  let parts: BranchRef | string;
  if (webUrl.test(input)) {
    parts = fromUrl(input);
  } else {
    parts = fromShorthand(input, { defaultHost });
  }
  if (typeof parts === 'string') {
    return err(parts);
  }
  const host = normalizeHostname(parts.host);
  if (host === undefined) {
    return err(`not a GitHub host: ${parts.host}`);
  }
  if (!ownerPattern.test(parts.owner) || parts.owner.includes('--')) {
    return err(`not a GitHub owner: ${parts.owner}`);
  }
  if (!repoPattern.test(parts.repo) || parts.repo === '.' || parts.repo === '..') {
    return err(`not a GitHub repository name: ${parts.repo}`);
  }
  if (!isSafeBranchName(parts.branch)) {
    return err(`beuve can’t follow a branch named ${parts.branch}`);
  }
  return ok({ host, owner: parts.owner, repo: parts.repo, branch: parts.branch });
}

function fromUrl(input: string): BranchRef | string {
  const url = URL.parse(input);
  if (url === null) {
    return 'not a URL';
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '') {
    return 'branch URLs must be plain https://';
  }
  const [owner, repo, kind, ...branch] = url.pathname
    .split('/')
    .filter((segment) => segment !== '');
  if (owner === undefined || repo === undefined || kind !== 'tree' || branch.length === 0) {
    return 'expected https://<host>/<owner>/<repo>/tree/<branch>';
  }
  const names = branch.map((segment) => decodedSegment(segment));
  if (names.includes(undefined)) {
    return 'the branch name is not valid percent-encoding';
  }
  return { host: url.hostname, owner, repo, branch: names.join('/') };
}

function decodedSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function fromShorthand(
  input: string,
  { defaultHost }: Required<BranchRefOptions>,
): BranchRef | string {
  const usage = 'expected a branch URL, owner/repo:branch or host/owner/repo:branch';
  const colon = input.indexOf(':');
  if (colon === -1) {
    return usage;
  }
  const segments = input.slice(0, colon).split('/');
  if (segments.some((segment) => !segmentPattern.test(segment))) {
    return usage;
  }
  const branch = input.slice(colon + 1);
  const [first = '', second = '', third] = segments;
  if (segments.length === 2) {
    return { host: defaultHost, owner: first, repo: second, branch };
  }
  if (third !== undefined && segments.length === 3) {
    return { host: first, owner: second, repo: third, branch };
  }
  return usage;
}
