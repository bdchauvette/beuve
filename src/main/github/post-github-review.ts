import type {
  IpcResult,
  PostGithubReviewRequest,
  PostGithubReviewResponse,
} from '#contract/ipc-contract.ts';
import type { AuthError } from '#internal/auth/auth-error.ts';
import { postPullRequestReview } from '#internal/github/post-pull-request-review.ts';
import type { GithubReviewPayload } from '#internal/ura/build-github-review.ts';
import type { CommitSha, SessionId } from '#internal/ura/ura-item.ts';
import type { UraPosting } from '#internal/ura/ura-posting.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import type { UraServices } from '../ura/create-ura-services.ts';

import type { GithubContext } from './github-context.ts';
import { failureFromGithubError } from './failure-from-github-error.ts';
import { prepareGithubReview } from './prepare-github-review.ts';

/**
 * `github:post-review` (ADR 0039, 0162): posts the prepared review as one submitted review with
 * `commit_id` = the head the items were placed on. When GitHub refuses comments, the pieces they
 * carried (those it names, else every inline one) are built into their notes' body sections and
 * the review posted once more; approving one's own pull request is `own-pull-request`, which the UI
 * offers to post as a comment instead. On success each piece is recorded where it went, so the
 * next post sends only what is new.
 */
export async function postGithubReview(
  context: GithubContext,
  ura: Pick<UraServices, 'compileArtifact' | 'listPostings' | 'recordPostings'>,
  request: PostGithubReviewRequest,
): Promise<IpcResult<PostGithubReviewResponse>> {
  const prepared = await prepareGithubReview(context, ura, request);
  if (!prepared.ok) {
    const { error } = prepared;
    if ('code' in error) {
      return err(error);
    }
    return ok(error);
  }
  const { ref, review, rebuild, preview } = prepared.value;
  const subject = `${ref.owner}/${ref.repo}#${String(ref.number)}`;
  const submit = async (
    payload: GithubReviewPayload,
  ): ReturnType<typeof postPullRequestReview<AuthError>> => {
    return context.clients.withClient(ref.host, async (client) => {
      return postPullRequestReview(client, { ref, payload });
    });
  };
  let sent = review;
  let posted = await submit(review.payload);
  if (!posted.ok && posted.error.kind === 'comments-rejected') {
    const failed = posted.error.failedCommentIndexes;
    sent = rebuild(
      review.placements.filter(({ comment }) => {
        return comment !== undefined && (failed === undefined || failed.includes(comment));
      }),
    );
    context.session.logger.info('github: comments refused, moving them into the body', {
      refused: review.payload.comments.length - sent.payload.comments.length,
    });
    posted = await submit(sent.payload);
  }
  if (!posted.ok) {
    context.session.logger.info('github: review not posted', { kind: posted.error.kind });
    return ok(failureFromGithubError(posted.error, subject));
  }
  const { htmlUrl } = posted.value;
  const postedAt = Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });
  ura.recordPostings(
    preview.sessionId,
    sent.placements.map(({ itemId, piece, placement }): UraPosting => {
      return {
        itemId,
        sessionId: preview.sessionId as SessionId,
        target: 'github',
        piece,
        url: htmlUrl,
        headSha: preview.headSha as CommitSha,
        placement,
        postedAt,
      };
    }),
  );
  return ok({
    ...preview,
    kind: 'posted',
    url: htmlUrl,
    inlineCount: sent.payload.comments.length,
    bodyCount: sent.bodySections,
    movedToBody: review.payload.comments.length - sent.payload.comments.length,
  });
}
