import type {
  GithubFailureView,
  GithubReviewPreviewView,
  IpcError,
  PostGithubReviewRequest,
} from '#contract/ipc-contract.ts';
import { diffRange } from '#internal/git/diff-range.ts';
import type { PullRequestRef } from '#internal/github/pull-request.ts';
import { buildGithubReview } from '#internal/ura/build-github-review.ts';
import type { GithubReviewPayload } from '#internal/ura/build-github-review.ts';
import { reviewSummaryFrom } from '#internal/ura/review-summary-from.ts';
import type { UraArtifact, UraEntry } from '#internal/ura/ura-artifact.ts';
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

/** A review ready to post: the payload, which items it carries and where each one lands. */
export interface PreparedReview {
  readonly ref: PullRequestRef;
  readonly payload: GithubReviewPayload;
  readonly entries: readonly { readonly entry: UraEntry; readonly inline: boolean }[];
  readonly preview: GithubReviewPreviewView;
}

/**
 * Compiles the session's staged items into a GitHub review (ADR 0039) on `expectedHeadSha`, the
 * head the reviewer was shown: the artifact on it (items written on older heads re-anchored,
 * outdated ones in the body), minus items an earlier posted review carried, with
 * `commentableRanges` from the local `base...head` diff, which is the diff GitHub shows, so no
 * inline comment lands off it. A session whose head is no longer that one is `head-moved`;
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
  const posted = new Set(ura.listPostings(session.id).map((posting) => posting.itemId as string));
  const fresh = artifact.value.entries.filter((entry) => !posted.has(entry.item.id));
  const options = { commentableRanges: commentableRangesFrom(diff.value.files) };
  const unposted: UraArtifact = { ...artifact.value, entries: fresh };
  const payload = buildGithubReview(unposted, {
    ...options,
    ...(request.summary !== undefined && { summary: request.summary }),
  });
  const entries = fresh.map((entry) => {
    return {
      entry,
      inline:
        buildGithubReview({ ...artifact.value, entries: [entry] }, options).comments.length > 0,
    };
  });
  return ok({
    ref: { host: source.host, owner: source.owner, repo: source.repo, number: source.number },
    payload,
    entries,
    preview: {
      sessionId: session.id,
      headSha,
      verdict: artifact.value.verdict.value,
      summary: reviewSummaryFrom(unposted),
      inlineCount: payload.comments.length,
      bodyCount: fresh.length - payload.comments.length,
      alreadyPostedCount: artifact.value.entries.length - fresh.length,
    },
  });
}
