import type {
  GithubFailureView,
  GithubReviewPreviewView,
  IpcError,
  PostGithubReviewRequest,
} from '#contract/ipc-contract.ts';
import { diffRange } from '#internal/git/diff-range.ts';
import type { PullRequestRef } from '#internal/github/pull-request.ts';
import { permalinkFrom } from '#internal/github/permalink-from.ts';
import { buildGithubReview } from '#internal/ura/build-github-review.ts';
import type {
  GithubPermalinkTarget,
  GithubReview,
  GithubReviewOptions,
  GithubReviewPiece,
} from '#internal/ura/build-github-review.ts';
import { isUraItemPosted } from '#internal/ura/is-ura-item-posted.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { UraServices } from '../ura/create-ura-services.ts';

import type { GithubContext } from './github-context.ts';
import { githubFailure } from './github-failure.ts';
import { commentableRangesFrom } from './commentable-ranges-from.ts';

/**
 * A review ready to post: where each piece of each note lands, and the same review built again
 * with some pieces moved into the body, for when GitHub refuses their comments.
 */
export interface PreparedReview {
  readonly ref: PullRequestRef;
  readonly review: GithubReview;
  readonly rebuild: (moveToBody: readonly GithubReviewPiece[]) => GithubReview;
  readonly preview: GithubReviewPreviewView;
}

/**
 * Compiles the session's staged items into a GitHub review (ADR 0039) on `expectedHeadSha`, the
 * head the reviewer was shown: the artifact on it (items written on older heads re-anchored,
 * outdated ones in the body), minus the pieces of notes an earlier posted review carried (ADR
 * 0162), with `commentableRanges` from the local `base...head` diff, which is the diff GitHub
 * shows, so no inline comment lands off it, and permalinks to the pull request's repository. A session whose head is no longer that one is `head-moved`;
 * otherwise the diff, the artifact, `commit_id` and the preview all use that one SHA, never a
 * second read of the head (ADR 0078), and the one base tip resolved here, so a base fetched
 * meanwhile can't change the fork point the artifact names (ADR 0079).
 */
export async function prepareGithubReview(
  context: Pick<GithubContext, 'session'>,
  ura: Pick<UraServices, 'compileArtifact' | 'listPostings'>,
  request: PostGithubReviewRequest,
): Promise<Result<PreparedReview, IpcError | GithubFailureView>> {
  const loaded = loadSession(context.session, request.sessionId);
  if (!loaded.ok) {
    return loaded;
  }
  const { source } = loaded.value;
  if (source.kind !== 'github-pull-request') {
    return err(
      githubFailure('not-a-pull-request', 'Only pull request sessions can be posted to GitHub.'),
    );
  }
  if (loaded.value.headSha !== request.expectedHeadSha) {
    context.session.logger.info('github: review not posted, the head moved', {
      expected: request.expectedHeadSha,
      head: loaded.value.headSha,
    });
    return err(
      githubFailure(
        'head-moved',
        'The pull request changed since you opened this; review the new commits first.',
      ),
    );
  }
  const headSha = loaded.value.headSha;
  const refreshed = await refreshSession(context.session, loaded.value, { headSha });
  if (!refreshed.ok) {
    return refreshed;
  }
  const { repository, baseTip, session } = refreshed.value;
  const diff = await diffRange(repository, { base: baseTip, head: headSha });
  if (!diff.ok) {
    return gitFailure(context.session.logger, diff.error);
  }
  const artifact = await ura.compileArtifact(session.id, {
    headSha,
    baseTip,
    ...(request.verdict !== undefined && { verdict: request.verdict }),
  });
  if (!artifact.ok) {
    return artifact;
  }
  if (artifact.value.summary.headSha !== headSha) {
    return err({ code: 'internal', message: 'the review was compiled at another head' });
  }
  const postings = ura.listPostings(session.id);
  const options: GithubReviewOptions = {
    commentableRanges: commentableRangesFrom(diff.value.files),
    permalinkFor: (target: GithubPermalinkTarget): string => {
      return permalinkFrom({
        host: source.host,
        owner: source.owner,
        repo: source.repo,
        ...target,
      });
    },
    posted: postings,
    ...(request.summary !== undefined && { summary: request.summary }),
  };
  const compiled = artifact.value;
  const rebuild = (moveToBody: readonly GithubReviewPiece[]): GithubReview => {
    return buildGithubReview(compiled, { ...options, moveToBody });
  };
  const review = rebuild([]);
  return ok({
    ref: { host: source.host, owner: source.owner, repo: source.repo, number: source.number },
    review,
    rebuild,
    preview: {
      sessionId: session.id,
      headSha,
      verdict: compiled.verdict.value,
      inlineCount: review.payload.comments.length,
      bodyCount: review.bodySections,
      alreadyPostedCount: compiled.entries.filter((entry) => {
        return isUraItemPosted(entry.item, postings);
      }).length,
      ...(review.leftOut > 0 && { leftOutCount: review.leftOut }),
    },
  });
}
