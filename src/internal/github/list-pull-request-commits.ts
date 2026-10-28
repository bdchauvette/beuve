import { z } from 'zod';

import type { Result } from '#pkg/result/result.ts';

import { decodeWith } from './decode-with.ts';
import { fetchAllPages } from './fetch-all-pages.ts';
import type { Pages } from './fetch-all-pages.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { PullRequestRef } from './pull-request.ts';

export interface PullRequestCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  /** The full message; its first line is the subject. */
  readonly message: string;
  readonly authorName: string | undefined;
  readonly authoredAt: string | undefined;
}

const sha = z
  .string()
  .regex(/^(?:[\da-f]{40}|[\da-f]{64})$/i)
  .transform((value) => value.toLowerCase());

const authorSchema = z.object({ name: z.string().optional(), date: z.string().optional() });
const parentSchema = z.object({ sha });
const detailSchema = z.object({ message: z.string(), author: authorSchema.nullable() });

const pageSchema = z.array(
  z
    .object({ sha, parents: z.array(parentSchema), commit: detailSchema })
    .transform((raw): PullRequestCommit => ({
      sha: raw.sha,
      parents: raw.parents.map((parent) => parent.sha),
      message: raw.commit.message,
      authorName: raw.commit.author?.name,
      authoredAt: raw.commit.author?.date,
    })),
);

/**
 * `GET /repos/{o}/{r}/pulls/{n}/commits`, oldest first. GitHub returns at most 250 commits here,
 * so `isTruncated` is also set when exactly 250 came back. beuve diffs locally (ADR 0035); this is
 * for showing the stack of revisions.
 */
export async function listPullRequestCommits<E>(
  client: GithubClient<E>,
  ref: Omit<PullRequestRef, 'host'>,
  signal?: AbortSignal,
): Promise<Result<Pages<PullRequestCommit>, GithubError<E>>> {
  const pages = await fetchAllPages(
    client,
    {
      method: 'GET',
      path: githubPath`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/commits`,
      query: { per_page: 100 },
      ...(signal !== undefined && { signal }),
    },
    (body) => decodeWith(pageSchema, body),
    3,
  );
  if (!pages.ok) {
    return pages;
  }
  return {
    ok: true,
    value: {
      items: pages.value.items,
      isTruncated: pages.value.isTruncated || pages.value.items.length >= 250,
    },
  };
}
