import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { decodeWith } from './decode-with.ts';
import type { GithubClient } from './github-client.ts';
import type { GithubError, GithubValidationDetail } from './github-error.ts';
import { githubPath } from './github-path.ts';
import { moveCommentsToBody } from './move-comments-to-body.ts';
import type { PullRequestRef } from './pull-request.ts';
import type { ReviewPayload } from './review-payload.ts';

export interface PostedReview {
  readonly id: number;
  readonly htmlUrl: string;
  /** `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, … */
  readonly state: string;
  /** Inline comments that were moved into the body by the fallback. */
  readonly movedToBody: number;
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

export interface PostReviewOptions {
  /**
   * `move-to-body`: when GitHub rejects inline comments, post once more with the identified comments
   * (or, as GitHub rarely says which, all of them) moved into the body. Safe to retry: a 422 means
   * nothing was created. Defaults to `fail`.
   */
  readonly onRejectedComments?: 'fail' | 'move-to-body';
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
 * on their own pull request, comments off the diff (with the optional body fallback) and a stale
 * `commit_id`; anything else stays `validation-failed`. Network errors are not retried, since the
 * review may have been created.
 */
export async function postPullRequestReview<E>(
  client: GithubClient<E>,
  ref: Omit<PullRequestRef, 'host'>,
  payload: ReviewPayload,
  options: PostReviewOptions = {},
): Promise<Result<PostedReview, PostReviewError<E>>> {
  const first = await submit(client, ref, payload, options.signal);
  if (
    first.ok ||
    first.error.kind !== 'comments-rejected' ||
    options.onRejectedComments !== 'move-to-body'
  ) {
    if (first.ok) {
      return ok({ ...first.value, movedToBody: 0 });
    }
    return first;
  }
  const failed = first.error.failedCommentIndexes;
  const fallback = moveCommentsToBody(
    payload,
    failed === undefined
      ? undefined
      : (_comment, index): boolean => {
          return failed.includes(index);
        },
  );
  const second = await submit(client, ref, fallback, options.signal);
  if (second.ok) {
    return ok({ ...second.value, movedToBody: payload.comments.length - fallback.comments.length });
  }
  return second;
}

async function submit<E>(
  client: GithubClient<E>,
  ref: Omit<PullRequestRef, 'host'>,
  payload: ReviewPayload,
  signal: AbortSignal | undefined,
): Promise<Result<Omit<PostedReview, 'movedToBody'>, PostReviewError<E>>> {
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
  if (!response.ok) {
    return err(
      response.error.kind === 'validation-failed'
        ? classifyRejection(response.error, payload)
        : response.error,
    );
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
    return {
      kind: 'comments-rejected',
      messages,
      failedCommentIndexes: identified.length === 0 ? undefined : identified,
    };
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
