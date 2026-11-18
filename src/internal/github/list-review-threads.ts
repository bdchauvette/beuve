import { z } from 'zod';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import { fetchAllPages } from './fetch-all-pages.ts';
import type { GithubCallOptions, GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { PullRequestRef } from './pull-request.ts';
import type { ReviewCommentRecord } from './review-comment-record.ts';
import type { ReviewThreads } from './review-thread.ts';
import { reviewThreadsFrom } from './review-threads-from.ts';

/** A comment body is cut here: it is rendered in the diff, and it is untrusted. */
const maxBodyLength = 20_000;

const instant = z.iso.datetime({ offset: true });

const commentSchema = z
  .object({
    id: z.number().int(),
    in_reply_to_id: z.number().int().nullable().optional(),
    path: z.string(),
    side: z.enum(['LEFT', 'RIGHT']).nullable().optional(),
    subject_type: z.string().nullable().optional(),
    line: z.number().int().nullable().optional(),
    start_line: z.number().int().nullable().optional(),
    commit_id: z.string(),
    original_line: z.number().int().nullable().optional(),
    original_start_line: z.number().int().nullable().optional(),
    original_commit_id: z.string(),
    user: z.object({ login: z.string() }).nullable().optional(),
    body: z.string().nullable().optional(),
    created_at: instant,
    html_url: z.string(),
  })
  .transform((raw): ReviewCommentRecord => {
    return {
      id: raw.id,
      replyTo: raw.in_reply_to_id ?? undefined,
      path: raw.path,
      side: raw.side ?? 'RIGHT',
      isFileLevel: raw.subject_type === 'file',
      line: raw.line ?? undefined,
      startLine: raw.start_line ?? undefined,
      commitId: raw.commit_id,
      originalLine: raw.original_line ?? undefined,
      originalStartLine: raw.original_start_line ?? undefined,
      originalCommitId: raw.original_commit_id,
      author: raw.user?.login ?? 'ghost',
      body: (raw.body ?? '').slice(0, maxBodyLength),
      at: raw.created_at,
      url: raw.html_url,
    };
  });

/**
 * A pull request's line threads (ADR 0140): the review comments on its diff
 * (`GET …/pulls/{n}/comments`, up to ten pages of 100), grouped into threads. REST doesn't say
 * whether a thread is resolved, so nothing here does. The first request that fails fails the read;
 * `isTruncated` when there were more pages than were read.
 */
export async function listReviewThreads<E>(
  client: GithubClient<E>,
  ref: Omit<PullRequestRef, 'host'>,
  options: GithubCallOptions = {},
): Promise<Result<ReviewThreads, GithubError<E>>> {
  const path = `${githubPath`/repos/${ref.owner}/${ref.repo}`}${githubPath`/pulls/${ref.number}/comments`}`;
  const pages = await fetchAllPages(
    client,
    { method: 'GET', path, query: { per_page: 100 }, ...options },
    (body) => {
      return decodeWith(z.array(commentSchema), body);
    },
  );
  if (!pages.ok) {
    return pages;
  }
  return ok({
    threads: reviewThreadsFrom(pages.value.items),
    isTruncated: pages.value.isTruncated,
  });
}
