import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError, GithubValidationDetail } from './github-error.ts';
import { githubPath } from './github-path.ts';
import type { PullRequestRef } from './pull-request.ts';
import type { ReviewPayload } from './review-payload.ts';

export interface PostedReview {
  readonly id: number;
  readonly htmlUrl: string;
  /** `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, … */
  readonly state: string;
}

export type PostReviewError<E> =
  | GithubError<E>
  | {
      /** GitHub refuses APPROVE and REQUEST_CHANGES from a pull request's author; offer COMMENT. */
      readonly kind: 'cannot-review-own-pull-request';
      readonly event: ReviewPayload['event'];
      readonly message: string;
    }
  | {
      /** Some inline comment isn't on a line of the pull request's diff (or its path is wrong). */
      readonly kind: 'comments-rejected';
      readonly messages: readonly string[];
      /** The comments GitHub's message identifies, when it does; usually it doesn't. */
      readonly failedCommentIndexes: readonly number[] | undefined;
    }
  | {
      /** `commit_id` isn't a commit of this pull request (e.g. a force-push dropped it). */
      readonly kind: 'stale-commit';
      readonly commitId: string;
      readonly message: string;
    };

/** A review for a pull request: where it goes and what it says. */
export interface ReviewSubmission {
  readonly ref: Omit<PullRequestRef, 'host'>;
  readonly payload: ReviewPayload;
}

export interface PostReviewOptions {
  readonly signal?: AbortSignal | undefined;
}

const reviewSchema = z.object({ id: z.number(), html_url: z.string(), state: z.string() });

const ownPullRequest = /own pull request/i;
const commentProblem =
  /pull_request_review_thread|part of the diff|line could not be resolved|path is invalid|diff hunk|start_line|line must be/i;
const staleCommit = /commit_id|not part of the pull request|no commit found/i;

/**
 * Submits a review in one request (`POST /repos/{o}/{r}/pulls/{n}/reviews`, not a pending one), so
 * a review is all or nothing. 422s become typed errors: the author approving or requesting changes
 * on their own pull request, comments off the diff (with the indexes GitHub's message names, so
 * the caller can place them elsewhere and post again: a 422 created nothing) and a stale
 * `commit_id`; anything else stays `validation-failed`. Nothing is retried; after a network error
 * the review may have been created.
 */
export async function postPullRequestReview<E>(
  client: GithubClient<E>,
  { ref, payload }: ReviewSubmission,
  options: PostReviewOptions = {},
): Promise<Result<PostedReview, PostReviewError<E>>> {
  const { signal } = options;
  const response = await client.send({
    method: 'POST',
    path: githubPath`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`,
    body: {
      commit_id: payload.commit_id,
      event: payload.event,
      body: payload.body,
      comments: payload.comments,
    },
    ...(signal !== undefined && { signal }),
  });
  if (!response.ok && response.error.kind === 'validation-failed') {
    return err(classifyRejection(response.error, payload));
  }
  if (!response.ok) {
    return err(response.error);
  }
  const decoded = decodeWith(reviewSchema, response.value.body);
  if (decoded.ok) {
    return ok({
      id: decoded.value.id,
      htmlUrl: decoded.value.html_url,
      state: decoded.value.state,
    });
  }
  return err({ kind: 'unexpected-shape', reason: decoded.error });
}

function classifyRejection<E>(
  error: Extract<GithubError<E>, { kind: 'validation-failed' }>,
  payload: ReviewPayload,
): PostReviewError<E> {
  const messages = [error.message, ...error.errors.map((detail) => describeDetail(detail))].filter(
    (text) => {
      return text !== '';
    },
  );
  if (messages.some((text) => ownPullRequest.test(text))) {
    return {
      kind: 'cannot-review-own-pull-request',
      event: payload.event,
      message: messages.find((text) => ownPullRequest.test(text)) ?? error.message,
    };
  }
  if (payload.comments.length > 0 && messages.some((text) => commentProblem.test(text))) {
    const identified: number[] = [];
    for (const [index, comment] of payload.comments.entries()) {
      if (messages.some((text) => text.includes(comment.path))) {
        identified.push(index);
      }
    }
    if (identified.length === 0) {
      return { kind: 'comments-rejected', messages, failedCommentIndexes: undefined };
    }
    return { kind: 'comments-rejected', messages, failedCommentIndexes: identified };
  }
  if (messages.some((text) => staleCommit.test(text))) {
    return { kind: 'stale-commit', commitId: payload.commit_id, message: messages.join('; ') };
  }
  return error;
}

function describeDetail(detail: GithubValidationDetail): string {
  return [detail.field, detail.message ?? detail.code]
    .filter((part) => part !== undefined)
    .join(': ');
}
