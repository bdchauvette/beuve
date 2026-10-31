import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { normalizeHostname } from '#x/net/normalize-hostname.ts';
import type { PullRequestRef } from './pull-request.ts';

const ownerPattern = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const repoPattern = /^[\w.-]{1,100}$/;
const webUrl = /^https?:\/\//i;
const segmentPattern = /^[^\s#/]+$/;
const numberPattern = /^\d{1,10}$/;

/**
 * A pull request from what a user pastes: a web URL (`https://github.com/o/r/pull/123`, with any
 * trailing `/files`, query or fragment; GitHub Enterprise hosts too) or the shorthand
 * `owner/repo#123` (on `defaultHost`) or `host/owner/repo#123`. Owner and repository names are
 * checked against GitHub's character rules, so they are safe in API paths and refspecs. Pure.
 */
export function parsePullRequestRef(
  text: string,
  defaultHost = 'github.com',
): Result<PullRequestRef, string> {
  const input = text.trim();
  const parts = webUrl.test(input) ? fromUrl(input) : fromShorthand(input, defaultHost);
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
  const number = numberPattern.test(parts.number) ? Number(parts.number) : 0;
  if (!Number.isSafeInteger(number) || number < 1) {
    return err(`not a pull request number: ${parts.number}`);
  }
  return ok({ host, owner: parts.owner, repo: parts.repo, number });
}

interface Parts {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: string;
}

function fromUrl(input: string): Parts | string {
  const url = URL.parse(input);
  if (url === null) {
    return 'not a URL';
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '') {
    return 'pull request URLs must be plain https://';
  }
  const [owner, repo, kind, number] = url.pathname.split('/').filter((segment) => segment !== '');
  return owner === undefined || repo === undefined || kind !== 'pull' || number === undefined
    ? 'expected https://<host>/<owner>/<repo>/pull/<number>'
    : { host: url.hostname, owner, repo, number };
}

function fromShorthand(input: string, defaultHost: string): Parts | string {
  const usage = 'expected a pull request URL, owner/repo#number or host/owner/repo#number';
  const [path = '', number, ...extra] = input.split('#');
  const segments = path.split('/');
  if (number === undefined || extra.length > 0 || segments.some((s) => !segmentPattern.test(s))) {
    return usage;
  }
  const [first = '', second = '', third] = segments;
  if (segments.length === 2) {
    return { host: defaultHost, owner: first, repo: second, number };
  }
  if (third !== undefined && segments.length === 3) {
    return { host: first, owner: second, repo: third, number };
  }
  return usage;
}
