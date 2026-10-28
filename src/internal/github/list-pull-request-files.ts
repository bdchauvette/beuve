import { z } from 'zod';

import type { Result } from '#pkg/result/result.ts';

import { decodeWith } from './decode-with.ts';
import { fetchAllPages } from './fetch-all-pages.ts';
import type { Pages } from './fetch-all-pages.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { PullRequestRef } from './pull-request.ts';

export interface PullRequestFile {
  readonly path: string;
  /** The path before a rename. */
  readonly previousPath: string | undefined;
  readonly status:
    'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  readonly additions: number;
  readonly deletions: number;
  /** GitHub sent a patch; it omits it for binary and very large files. */
  readonly hasPatch: boolean;
}

const pageSchema = z.array(
  z
    .object({
      filename: z.string(),
      previous_filename: z.string().optional(),
      status: z.enum(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
      patch: z.string().optional(),
    })
    .transform((raw): PullRequestFile => ({
      path: raw.filename,
      previousPath: raw.previous_filename,
      status: raw.status,
      additions: raw.additions,
      deletions: raw.deletions,
      hasPatch: raw.patch !== undefined,
    })),
);

/**
 * `GET /repos/{o}/{r}/pulls/{n}/files`: paths and counts only, the patches are dropped (beuve diffs
 * locally, ADR 0035). GitHub lists at most 3000 files; `maxPages` (default 30) of 100 covers that.
 */
export async function listPullRequestFiles<E>(
  client: GithubClient<E>,
  ref: Omit<PullRequestRef, 'host'>,
  options: { readonly maxPages?: number; readonly signal?: AbortSignal } = {},
): Promise<Result<Pages<PullRequestFile>, GithubError<E>>> {
  return fetchAllPages(
    client,
    {
      method: 'GET',
      path: githubPath`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files`,
      query: { per_page: 100 },
      ...(options.signal !== undefined && { signal: options.signal }),
    },
    (body) => decodeWith(pageSchema, body),
    options.maxPages ?? 30,
  );
}
