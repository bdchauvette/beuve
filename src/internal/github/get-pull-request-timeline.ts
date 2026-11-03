import { z } from 'zod';

import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import { fetchAllPages } from './fetch-all-pages.ts';
import type { Pages } from './fetch-all-pages.ts';
import type { GithubCallOptions, GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { PullRequestRef } from './pull-request.ts';
import type { ReviewVerdict } from './pull-request-review.ts';
import type {
  CommentTimelineEvent,
  CommitTimelineEvent,
  PullRequestTimeline,
  ReviewTimelineEvent,
} from './timeline-event.ts';
import { timelineFrom } from './timeline-from.ts';

/** A comment or review body is cut here: it is rendered in a narrow sidebar, and it is untrusted. */
const maxBodyLength = 20_000;

const verdicts: Readonly<Record<string, ReviewVerdict>> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
};

/** GitHub writes `Z` for most instants and an offset for a commit's author date. */
const instant = z.iso.datetime({ offset: true });

const account = z.object({ login: z.string() });
const login = account.nullable().optional();

const gitAuthor = z.object({ name: z.string().nullable().optional(), date: instant });
const gitCommit = z.object({ message: z.string(), author: gitAuthor.nullable() });

const commitSchema = z
  .object({
    sha: z.string(),
    html_url: z.string(),
    commit: gitCommit,
    author: login,
  })
  .transform((raw): CommitTimelineEvent | undefined => {
    if (raw.commit.author === null) {
      return undefined;
    }
    return {
      kind: 'commit',
      sha: raw.sha,
      headline: headlineOf(raw.commit.message),
      author: raw.author?.login ?? raw.commit.author.name ?? 'ghost',
      at: raw.commit.author.date,
      url: raw.html_url,
    };
  });

const reviewSchema = z
  .object({
    user: login,
    state: z.string(),
    body: z.string().nullable().optional(),
    submitted_at: instant.nullable().optional(),
    html_url: z.string(),
  })
  .transform((raw): ReviewTimelineEvent | undefined => {
    const verdict = verdicts[raw.state];
    if (verdict === undefined || raw.submitted_at == undefined) {
      return undefined;
    }
    const body = (raw.body ?? '').slice(0, maxBodyLength);
    // A review that only carries line comments, with no words of its own, adds nothing here.
    if (verdict === 'commented' && body.trim() === '') {
      return undefined;
    }
    return {
      kind: 'review',
      verdict,
      author: raw.user?.login ?? 'ghost',
      body,
      at: raw.submitted_at,
      url: raw.html_url,
    };
  });

const commentSchema = z
  .object({
    user: login,
    body: z.string().nullable().optional(),
    created_at: instant,
    html_url: z.string(),
  })
  .transform((raw): CommentTimelineEvent => {
    return {
      kind: 'comment',
      author: raw.user?.login ?? 'ghost',
      body: (raw.body ?? '').slice(0, maxBodyLength),
      at: raw.created_at,
      url: raw.html_url,
    };
  });

/**
 * A pull request's history, oldest first: its commits (`GET …/pulls/{n}/commits`), its submitted
 * reviews (`…/pulls/{n}/reviews`) and the comments of its conversation (`…/issues/{n}/comments`).
 * Pending reviews, states GitHub may add later, and reviews that only hold line comments are left
 * out; comments on lines of the diff belong to their reviews and are not read. The first request
 * that fails fails the whole read. `isTruncated` when any list had more pages than were read.
 */
export async function getPullRequestTimeline<E>(
  client: GithubClient<E>,
  ref: Omit<PullRequestRef, 'host'>,
  options: GithubCallOptions = {},
): Promise<Result<PullRequestTimeline, GithubError<E>>> {
  const base = githubPath`/repos/${ref.owner}/${ref.repo}`;
  const list = async <T>(
    path: string,
    schema: z.ZodType<readonly (T | undefined)[]>,
  ): Promise<Result<Pages<T>, GithubError<E>>> => {
    const pages = await fetchAllPages(
      client,
      { method: 'GET', path, query: { per_page: 100 }, ...options },
      (body) => {
        const decoded = decodeWith(schema, body);
        if (decoded.ok) {
          return ok(decoded.value.filter((item) => item !== undefined));
        }
        return decoded;
      },
    );
    return pages;
  };
  const [commits, reviews, comments] = await Promise.all([
    list(`${base}${githubPath`/pulls/${ref.number}/commits`}`, z.array(commitSchema)),
    list(`${base}${githubPath`/pulls/${ref.number}/reviews`}`, z.array(reviewSchema)),
    list(`${base}${githubPath`/issues/${ref.number}/comments`}`, z.array(commentSchema)),
  ]);
  if (!commits.ok) {
    return commits;
  }
  if (!reviews.ok) {
    return reviews;
  }
  if (!comments.ok) {
    return comments;
  }
  return ok({
    events: timelineFrom({
      commits: commits.value.items,
      reviews: reviews.value.items,
      comments: comments.value.items,
    }),
    isTruncated:
      commits.value.isTruncated || reviews.value.isTruncated || comments.value.isTruncated,
  });
}

/** The first line of a commit message, which is its title. */
function headlineOf(message: string): string {
  return message.split('\n', 1)[0]?.trim() ?? '';
}
