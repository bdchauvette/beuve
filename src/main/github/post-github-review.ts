import type {
  IpcResult,
  PostGithubReviewRequest,
  PostGithubReviewResponse,
} from '#contract/ipc-contract.ts';
import { postPullRequestReview } from '#internal/github/post-pull-request-review.ts';
import type { CommitSha, SessionId } from '#internal/ura/ura-item.ts';
import type { UraPosting } from '#internal/ura/ura-posting.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import type { UraServices } from '../ura/create-ura-services.ts';

import type { GithubContext } from './github-context.ts';
import { githubErrorToFailure } from './github-error-to-failure.ts';
import { prepareGithubReview } from './prepare-github-review.ts';

/**
 * `github:post-review` (ADR 0039): posts the prepared review as one submitted review with
 * `commit_id` = the head the items were placed on. Comments GitHub refuses are moved into the
 * body and the review posted once more; approving one's own pull request is `own-pull-request`,
 * which the UI offers to post as a comment instead. On success the carried items are recorded as
 * posted, so the next post sends only what is new.
 */
export async function postGithubReview(
  context: GithubContext,
  ura: Pick<UraServices, 'compileArtifact' | 'listPostings' | 'recordPostings'>,
  request: PostGithubReviewRequest,
): Promise<IpcResult<PostGithubReviewResponse>> {
  const prepared = await prepareGithubReview(context, ura, request);
  if (!prepared.ok) {
    const { error } = prepared;
    return 'code' in error ? err(error) : ok(error);
  }
  const { ref, payload, entries, preview } = prepared.value;
  const posted = await context.clients.withClient(ref.host, async (client) =>
    postPullRequestReview(client, ref, payload, { onRejectedComments: 'move-to-body' }),
  );
  if (!posted.ok) {
    context.session.logger.info('github: review not posted', { kind: posted.error.kind });
    return ok(githubErrorToFailure(posted.error, `${ref.owner}/${ref.repo}#${String(ref.number)}`));
  }
  const { htmlUrl, movedToBody } = posted.value;
  const wereAllMoved = movedToBody > 0 && movedToBody >= payload.comments.length;
  const postedAt = Temporal.Now.instant().toString({ fractionalSecondDigits: 3 });
  ura.recordPostings(
    preview.sessionId,
    entries.map(({ entry, inline }): UraPosting => ({
      itemId: entry.item.id,
      sessionId: preview.sessionId as SessionId,
      target: 'github',
      url: htmlUrl,
      headSha: preview.headSha as CommitSha,
      placement: inline && !wereAllMoved ? 'inline' : 'body',
      postedAt,
    })),
  );
  return ok({
    ...preview,
    kind: 'posted',
    url: htmlUrl,
    inlineCount: payload.comments.length - movedToBody,
    bodyCount: preview.bodyCount + movedToBody,
    movedToBody,
  });
}
