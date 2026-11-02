import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { parsePullRequestRef } from './parse-pull-request-ref.ts';
import type { PullRequestRef } from './pull-request.ts';

/** A pull request asked for by a `beuve://` link. */
export interface PullRequestLink {
  readonly ref: PullRequestRef;
  /** `host/owner/repo#number`, the form `github:open-pr` takes. */
  readonly text: string;
}

const scheme = 'beuve:';
const action = 'open';

/**
 * The pull request in a `beuve://open?url=<pull request URL>` link (ADR 0098), as from a
 * bookmarklet. Links come from web pages and other programs, so anything but `open` with exactly
 * one `url` parameter holding a plain `https://` pull request URL (see `parsePullRequestRef`)
 * is refused; the shorthand `owner/repo#n` is not accepted here. Pure.
 */
export function pullRequestLinkFrom(link: string): Result<PullRequestLink, string> {
  const url = URL.parse(link.trim());
  if (url?.protocol !== scheme) {
    return err('not a beuve:// link');
  }
  if (url.hostname !== action || url.username !== '' || url.port !== '') {
    return err(`unknown beuve:// action: ${url.hostname}`);
  }
  const targets = url.searchParams.getAll('url');
  const [target] = targets;
  if (target === undefined || targets.length !== 1) {
    return err('expected exactly one url parameter');
  }
  if (URL.parse(target)?.protocol !== 'https:') {
    return err('expected an https:// pull request URL');
  }
  const parsed = parsePullRequestRef(target);
  if (!parsed.ok) {
    return err(parsed.error);
  }
  const { host, owner, repo, number } = parsed.value;
  return ok({ ref: parsed.value, text: `${host}/${owner}/${repo}#${String(number)}` });
}
