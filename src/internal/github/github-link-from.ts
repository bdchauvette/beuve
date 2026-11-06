import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { BranchRef } from './branch-ref.ts';
import { parseBranchRef } from './parse-branch-ref.ts';
import { parsePullRequestRef } from './parse-pull-request-ref.ts';
import type { PullRequestRef } from './pull-request.ts';

/** What a `beuve://` link asks to open: a pull request or a branch to follow. */
export type GithubLink =
  | {
      readonly kind: 'pull-request';
      readonly ref: PullRequestRef;
      /** `host/owner/repo#number`, the form `github:open-pr` takes. */
      readonly text: string;
    }
  | {
      readonly kind: 'branch';
      readonly ref: BranchRef;
      /** `host/owner/repo:branch`, the form `github:open-branch` takes. */
      readonly text: string;
    };

const scheme = 'beuve:';
const action = 'open';
const treePath = /^\/[^/]+\/[^/]+\/tree\//u;

/**
 * The pull request or branch in a `beuve://open?url=<URL>` link (ADR 0098, 0112), as from a
 * bookmarklet. Links come from web pages and other programs, so anything but `open` with exactly
 * one `url` parameter holding a plain `https://` pull request URL (see `parsePullRequestRef`) or
 * tree URL (see `parseBranchRef`) is refused; shorthands are not accepted here. Pure.
 */
export function githubLinkFrom(link: string): Result<GithubLink, string> {
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
  const targetUrl = URL.parse(target);
  if (targetUrl?.protocol !== 'https:') {
    return err('expected an https:// pull request or branch URL');
  }
  if (treePath.test(targetUrl.pathname)) {
    const branch = parseBranchRef(target);
    if (!branch.ok) {
      return branch;
    }
    const { host, owner, repo, branch: name } = branch.value;
    return ok({ kind: 'branch', ref: branch.value, text: `${host}/${owner}/${repo}:${name}` });
  }
  const parsed = parsePullRequestRef(target);
  if (!parsed.ok) {
    return err(parsed.error);
  }
  const { host, owner, repo, number } = parsed.value;
  return ok({
    kind: 'pull-request',
    ref: parsed.value,
    text: `${host}/${owner}/${repo}#${String(number)}`,
  });
}
