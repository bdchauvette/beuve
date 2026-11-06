import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { RemoteBranchTip } from './branch-ref.ts';
import { decodeWith } from './decode-with.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { Conditional, PullRequestPollOptions } from './get-pull-request.ts';
import type { RepositoryName } from './get-repository.ts';

/** The branches of a repository whose names start with `prefix`, such as `claude/`. */
export interface BranchPrefixQuery extends RepositoryName {
  readonly prefix: string;
}

const headsPrefix = 'refs/heads/';

const objectSchema = z.object({
  sha: z.string().regex(/^(?:[\da-f]{40}|[\da-f]{64})$/iu),
  type: z.string(),
});
const refSchema = z.object({ ref: z.string(), object: objectSchema });

const refsSchema = z.array(refSchema).transform((raw): RemoteBranchTip[] => {
  return raw
    .filter((entry) => entry.ref.startsWith(headsPrefix) && entry.object.type === 'commit')
    .map((entry) => {
      return { name: entry.ref.slice(headsPrefix.length), sha: entry.object.sha.toLowerCase() };
    });
});

/**
 * `GET /repos/{o}/{r}/git/matching-refs/heads/{prefix}` (ADR 0113): the branches whose names start
 * with `prefix`, with their tips. Conditional on `etag`: an unchanged list answers `not-modified`.
 * The prefix's segments are encoded one by one, so its slashes stay path separators and a
 * trailing slash keeps `claude/` from matching `claudette`.
 */
export async function listMatchingBranches<E>(
  client: GithubClient<E>,
  query: BranchPrefixQuery,
  options: PullRequestPollOptions = {},
): Promise<Result<Conditional<readonly RemoteBranchTip[]>, GithubError<E>>> {
  const segments = query.prefix.split('/').map((segment) => encodeURIComponent(segment));
  const response = await client.send({
    method: 'GET',
    path: `${githubPath`/repos/${query.owner}/${query.repo}/git/matching-refs/heads`}/${segments.join('/')}`,
    ...options,
  });
  if (!response.ok) {
    return response;
  }
  if (response.value.status === 304) {
    return ok({ kind: 'not-modified' });
  }
  const decoded = decodeWith(refsSchema, response.value.body);
  if (decoded.ok) {
    return ok({ kind: 'modified', value: decoded.value, etag: response.value.etag });
  }
  return err({ kind: 'unexpected-shape', reason: decoded.error });
}
