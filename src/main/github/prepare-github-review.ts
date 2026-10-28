import type {
  GithubFailureView,
  GithubReviewPreviewView,
  IpcError,
  UraVerdictView,
} from '#contract/ipc-contract.ts';
import { diffRange } from '#internal/git/diff-range.ts';
import type { PullRequestRef } from '#internal/github/pull-request.ts';
import { buildGithubReview } from '#internal/ura/build-github-review.ts';
import type { GithubReviewPayload } from '#internal/ura/build-github-review.ts';
import type { UraArtifact, UraEntry } from '#internal/ura/ura-artifact.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { UraServices } from '../ura/create-ura-services.ts';

import type { GithubContext } from './github-context.ts';
import { githubFailure } from './github-failure.ts';
import { toCommentableRanges } from './to-commentable-ranges.ts';

/** A review ready to post: the payload, which items it carries and where each one lands. */
export interface PreparedReview {
  readonly ref: PullRequestRef;
  readonly payload: GithubReviewPayload;
  readonly entries: readonly { readonly entry: UraEntry; readonly inline: boolean }[];
  readonly preview: GithubReviewPreviewView;
}

/**
 * Compiles the session's staged items into a GitHub review (ADR 0039): the artifact on the current
 * head (items written on older heads re-anchored, outdated ones in the body), minus items an
 * earlier posted review carried, with `commentableRanges` from the local `base...head` diff, which
 * is the diff GitHub shows, so no inline comment lands off it.
 */
export async function prepareGithubReview(
  context: GithubContext,
  ura: Pick<UraServices, 'compileArtifact' | 'listPostings'>,
  request: { readonly sessionId: string; readonly verdict?: UraVerdictView },
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
  const refreshed = await refreshSession(context.session, loaded.value);
  if (!refreshed.ok) {
    return refreshed;
  }
  const { repository, baseTip, session } = refreshed.value;
  const diff = await diffRange(repository, { base: baseTip, head: session.headSha });
  if (!diff.ok) {
    return gitFailure(context.session.logger, diff.error);
  }
  const artifact = await ura.compileArtifact(session.id, request.verdict);
  if (!artifact.ok) {
    return artifact;
  }
  const posted = new Set(ura.listPostings(session.id).map((posting) => posting.itemId as string));
  const fresh = artifact.value.entries.filter((entry) => !posted.has(entry.item.id));
  const options = { commentableRanges: toCommentableRanges(diff.value.files) };
  const unposted: UraArtifact = { ...artifact.value, entries: fresh };
  const payload = buildGithubReview(unposted, options);
  const entries = fresh.map((entry) => ({
    entry,
    inline: buildGithubReview({ ...artifact.value, entries: [entry] }, options).comments.length > 0,
  }));
  return ok({
    ref: { host: source.host, owner: source.owner, repo: source.repo, number: source.number },
    payload,
    entries,
    preview: {
      sessionId: session.id,
      headSha: session.headSha,
      verdict: artifact.value.verdict.value,
      inlineCount: payload.comments.length,
      bodyCount: fresh.length - payload.comments.length,
      alreadyPostedCount: artifact.value.entries.length - fresh.length,
    },
  });
}
