import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type {
  BeuveApi,
  CiStatusView,
  GithubAuthStatusView,
  GithubReviewPreviewView,
  OpenPullRequestRequest,
  PullRequestSessionView,
  PullRequestUpdatedView,
  RemoteBranchUpdatedView,
  RemoteBranchView,
  UraItemView,
  UraVerdictView,
} from '#contract/ipc-contract.ts';

import type { OpenFailure } from './beuve-open-panel.ts';
import { describeReviewPreview } from './describe-review-preview.ts';
import type { StatusNotice } from './describe-editor-open.ts';
import type { GithubPostState, GithubPreviewState } from './github-post-state.ts';
import { parseOpenQuery } from './parse-open-query.ts';
import { pullRequestLabelFrom } from './pull-request-label-from.ts';
import type { ReviewRef } from './review-ref.ts';
import type { TimelineState } from './timeline-state.ts';

/** Post the staged review to GitHub, with this verdict over the derived one. */
export interface GithubPostDetail {
  readonly verdict?: UraVerdictView | undefined;
  /** The summary the reviewer wrote; absent when they left it blank. */
  readonly summary?: string | undefined;
}

/** The staged review of a pull request session, whose change makes the post preview stale. */
export interface StagedReview {
  readonly items: readonly UraItemView[];
  /** The verdict the review would post: the chosen one, else the derived one. */
  readonly verdict: UraVerdictView;
}

/** What the GitHub flows need from the window around them. */
export interface GithubEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
  /** The open review, if there is one. */
  readonly review: () => ReviewRef | undefined;
  /** The open review's staged items and verdict, when it is a pull request session. */
  readonly staged: () => StagedReview | undefined;
  readonly notify: (notice: StatusNotice) => void;
  readonly refreshSessions: () => Promise<void>;
  readonly selectSession: (sessionId: string) => Promise<void>;
  /** Shows or closes the open dialog, which carries a pull request's failure. */
  readonly setOpenDialog: (isOpen: boolean) => void;
  /** Polling found the pull request changed, so other reviewers' comments may have too (ADR 0140). */
  readonly pullRequestChanged?: (sessionId: string) => void;
}

interface GithubSnapshot {
  readonly pullRequest: PullRequestSessionView | undefined;
  /** The open remote-branch session's branch (ADR 0112). */
  readonly branch: RemoteBranchView | undefined;
  readonly ci: CiStatusView | undefined;
  /** The open pull request's activity (ADR 0110). */
  readonly timeline: TimelineState | undefined;
  readonly auth: GithubAuthStatusView | undefined;
  readonly post: GithubPostState;
  readonly preview: GithubPreviewState;
  readonly isOpening: boolean;
  readonly failure: OpenFailure | undefined;
  /** The open session, when polling found new commits the review doesn't show yet. */
  readonly newCommitsIn: string | undefined;
}

/** What the shown preview was asked for. */
interface PreviewKey {
  readonly sessionId: string;
  readonly headSha: string;
  readonly items: readonly UraItemView[];
  readonly verdict: UraVerdictView;
}

/** Where polling found new commits: the session, and the pull request or branch it names. */
interface NewCommits {
  readonly sessionId: string;
  readonly name: string;
}

const initial: GithubSnapshot = {
  pullRequest: undefined,
  branch: undefined,
  ci: undefined,
  timeline: undefined,
  auth: undefined,
  post: { kind: 'idle' },
  preview: { kind: 'none' },
  isOpening: false,
  failure: undefined,
  newCommitsIn: undefined,
};

/**
 * The window's GitHub state and flows (ADR 0037 to 0040, 0078): opening a pull request, the open
 * one's metadata, stack and CI (kept fresh by `github:pr-updated` and `github:ci-status` while the
 * host is connected), who beuve posts as, and posting a review, with a preview of what it sends
 * kept fresh as the staged items, the verdict and the head change. The open
 * review and the session list come in through the {@link GithubEnvironment}; the host re-renders
 * when a getter's value changes.
 */
export class GithubController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: GithubEnvironment;
  private snapshot: GithubSnapshot = initial;
  /** The `requestId` of the `github:open-pr` in flight, for `request:cancel`. */
  private requestId: string | undefined;
  /** Counts timeline reads, so an older answer never replaces a newer one. */
  private timelineRead = 0;
  /** Counts preview reads, likewise. */
  private previewRead = 0;
  /** What the current preview was asked for; `undefined` until one is. */
  private previewedFor: PreviewKey | undefined;
  private unsubscribes: (() => void)[] = [];

  constructor(host: ReactiveControllerHost, environment: GithubEnvironment) {
    this.host = host;
    this.environment = environment;
    host.addController(this);
  }

  /**
   * Polling found a change. A new head is only announced: reloading under the reviewer would
   * throw away a note being written and the place they were reading, so the review reloads when
   * they choose Show New Commits ({@link showNewCommits}).
   */
  private applyUpdate(event: PullRequestUpdatedView): void {
    void this.environment.refreshSessions();
    if (event.sessionId !== this.environment.review()?.sessionId) {
      return;
    }
    const { ci } = this.snapshot;
    const attention = event.attention ?? this.snapshot.pullRequest?.attention;
    this.patch({
      pullRequest: {
        sessionId: event.sessionId,
        pullRequest: event.pullRequest,
        stack: event.stack,
        ...(ci !== undefined && { ci }),
        ...(attention !== undefined && { attention }),
      },
    });
    void this.loadTimeline(event.sessionId);
    this.environment.pullRequestChanged?.(event.sessionId);
    if (!event.headMoved) {
      return;
    }
    this.invalidatePost();
    this.announceNewCommits({
      sessionId: event.sessionId,
      name: `#${String(event.pullRequest.number)}`,
    });
  }

  /**
   * Polling found a followed branch changed (ADR 0112). A promotion reloads the session, which
   * now opens as its pull request; a new head is announced, as for a pull request.
   */
  private applyBranchUpdate(event: RemoteBranchUpdatedView): void {
    void this.environment.refreshSessions();
    if (event.sessionId !== this.environment.review()?.sessionId) {
      return;
    }
    this.patch({ branch: event.branch });
    const name = event.branch.branch;
    if (event.promoted) {
      const { pullRequest } = event.branch;
      let text = `${name} has a pull request now; this review continues as its pull request.`;
      if (pullRequest !== undefined) {
        text = `${name} has a pull request now; this review continues as ${pullRequestLabelFrom(event.branch, pullRequest)}.`;
      }
      this.environment.notify({ tone: 'info', text });
      void this.environment.selectSession(event.sessionId);
      return;
    }
    if (event.branch.state === 'gone') {
      this.environment.notify({
        tone: 'info',
        text: `${name} is gone from GitHub; the review keeps its last head.`,
      });
      return;
    }
    if (!event.headMoved) {
      return;
    }
    this.announceNewCommits({ sessionId: event.sessionId, name });
  }

  private announceNewCommits({ sessionId, name }: NewCommits): void {
    this.patch({ newCommitsIn: sessionId });
    this.environment.notify({
      tone: 'info',
      text: `New commits on ${name}.`,
      action: { label: 'Show', command: 'show-new-commits' },
    });
  }

  /** Main refused because the head moved: say so quietly and show the new commits. */
  private headMoved(sessionId: string): void {
    this.patch({ post: { kind: 'head-moved' } });
    void this.environment.selectSession(sessionId);
  }

  private patch(change: Partial<GithubSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.host.requestUpdate();
  }

  hostConnected(): void {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      this.unsubscribes = [];
      return;
    }
    this.unsubscribes = [
      bridge.on('github:pr-updated', (event) => {
        this.applyUpdate(event);
      }),
      bridge.on('github:ci-status', ({ sessionId, ci }) => {
        if (sessionId === this.environment.review()?.sessionId) {
          this.patch({ ci });
        }
      }),
      bridge.on('github:branch-updated', (event) => {
        this.applyBranchUpdate(event);
      }),
    ];
  }

  hostDisconnected(): void {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes = [];
  }

  /** The open pull request session's metadata and stack; absent for local sessions. */
  get pullRequest(): PullRequestSessionView | undefined {
    return this.snapshot.pullRequest;
  }

  /** The open remote-branch session's branch; absent for other sessions. */
  get branch(): RemoteBranchView | undefined {
    return this.snapshot.branch;
  }

  get ci(): CiStatusView | undefined {
    return this.snapshot.ci;
  }

  /** The open pull request's commits, reviews and comments; absent for local sessions. */
  get timeline(): TimelineState | undefined {
    return this.snapshot.timeline;
  }

  /** Who beuve posts to GitHub as. */
  get auth(): GithubAuthStatusView | undefined {
    return this.snapshot.auth;
  }

  get post(): GithubPostState {
    return this.snapshot.post;
  }

  /** What posting would send now, for the line beside the Post button. */
  get preview(): GithubPreviewState {
    return this.snapshot.preview;
  }

  /** Asks for a fresh preview once the staged items, the verdict or the head changed. */
  hostUpdated(): void {
    const review = this.environment.review();
    const staged = this.environment.staged();
    if (review === undefined || staged === undefined || this.snapshot.post.kind === 'busy') {
      return;
    }
    const key: PreviewKey = {
      sessionId: review.sessionId,
      headSha: review.headSha,
      items: staged.items,
      verdict: staged.verdict,
    };
    if (this.previewedFor !== undefined && isSamePreviewKey(this.previewedFor, key)) {
      return;
    }
    this.previewedFor = key;
    void this.refreshPreview();
  }

  /** Whether polling found new commits that the open review doesn't show yet. */
  get hasNewCommits(): boolean {
    return this.snapshot.newCommitsIn !== undefined;
  }

  /** Review ▸ Show New Commits: reloads the review, which then offers the interdiff. */
  showNewCommits(): void {
    const sessionId = this.snapshot.newCommitsIn;
    if (sessionId === undefined) {
      return;
    }
    this.patch({ newCommitsIn: undefined });
    void this.environment.selectSession(sessionId);
  }

  /** Whether a pull request is being fetched to open. */
  get isOpening(): boolean {
    return this.snapshot.isOpening;
  }

  /** Why the last pull request failed to open, for the open dialog. */
  get failure(): OpenFailure | undefined {
    return this.snapshot.failure;
  }

  /** Forgets the open session's pull request, CI and post state: another session is opening. */
  reset(): void {
    this.timelineRead += 1;
    this.previewRead += 1;
    this.previewedFor = undefined;
    this.patch({
      pullRequest: undefined,
      branch: undefined,
      ci: undefined,
      timeline: undefined,
      post: { kind: 'idle' },
      preview: { kind: 'none' },
      newCommitsIn: undefined,
    });
  }

  /** Who beuve posts to GitHub as; `host` defaults to the open pull request's. */
  async loadAuth(host?: string): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    const auth = await bridge.invoke('github:auth-status', {
      ...(host !== undefined && { host }),
    });
    if (auth.ok) {
      this.patch({ auth: auth.value });
    }
  }

  async loadPullRequest(sessionId: string): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    const loaded = await bridge.invoke('github:get-pr', { sessionId });
    if (this.environment.review()?.sessionId !== sessionId) {
      return;
    }
    if (!loaded.ok) {
      this.environment.notify({ tone: 'error', text: loaded.error.message });
      return;
    }
    this.patch({ pullRequest: loaded.value, ci: loaded.value.ci ?? this.snapshot.ci });
    if (this.snapshot.auth?.host !== loaded.value.pullRequest.host) {
      void this.loadAuth(loaded.value.pullRequest.host);
    }
  }

  /** The followed branch of a remote-branch session; asking makes it the polled session. */
  async loadBranch(sessionId: string): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    const loaded = await bridge.invoke('github:get-branch', { sessionId });
    if (this.environment.review()?.sessionId !== sessionId) {
      return;
    }
    if (!loaded.ok) {
      this.environment.notify({ tone: 'error', text: loaded.error.message });
      return;
    }
    this.patch({ branch: loaded.value.branch });
  }

  /**
   * Reads the pull request's commits, reviews and comments for the Overview. A list already shown
   * stays while it is refreshed; an answer that is not the latest, or for another session, is
   * dropped.
   */
  async loadTimeline(sessionId: string): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    this.timelineRead += 1;
    const read = this.timelineRead;
    if (this.snapshot.timeline?.kind !== 'ready') {
      this.patch({ timeline: { kind: 'loading' } });
    }
    const loaded = await bridge.invoke('github:get-timeline', { sessionId });
    if (read !== this.timelineRead || this.environment.review()?.sessionId !== sessionId) {
      return;
    }
    if (!loaded.ok) {
      this.patch({ timeline: { kind: 'failed', message: loaded.error.message } });
      return;
    }
    if (loaded.value.kind === 'failed') {
      this.patch({ timeline: { kind: 'failed', message: loaded.value.message } });
      return;
    }
    this.patch({
      timeline: {
        kind: 'ready',
        events: loaded.value.events,
        isTruncated: loaded.value.isTruncated,
      },
    });
  }

  /**
   * Fetches a pull request, or a branch to follow (a tree URL or `owner/repo:branch`, ADR 0112),
   * and opens it as a session; one at a time.
   */
  async open(request: OpenPullRequestRequest): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined || this.snapshot.isOpening) {
      return;
    }
    const requestId = crypto.randomUUID();
    this.requestId = requestId;
    this.patch({ isOpening: true, failure: undefined });
    let channel: 'github:open-pr' | 'github:open-branch' = 'github:open-pr';
    if (parseOpenQuery(request.ref).kind === 'branch') {
      channel = 'github:open-branch';
    }
    const opened = await bridge.invoke(channel, { ...request, requestId });
    this.requestId = undefined;
    this.patch({ isOpening: false });
    if (!opened.ok && opened.error.code === 'cancelled') {
      return;
    }
    if (!opened.ok) {
      this.patch({ failure: { message: opened.error.message } });
      this.environment.setOpenDialog(this.environment.review() !== undefined);
      return;
    }
    if (opened.value.kind === 'failed') {
      const { message, remedy } = opened.value;
      this.patch({
        failure: {
          message,
          ...(remedy !== undefined && !message.includes(remedy) && { remedy }),
        },
      });
      this.environment.setOpenDialog(this.environment.review() !== undefined);
      return;
    }
    this.environment.setOpenDialog(false);
    await this.environment.refreshSessions();
    await this.environment.selectSession(opened.value.session.id);
  }

  /** Stops the pull request fetch in flight, if any; it then ends without a notice (ADR 0079). */
  cancelOpening(): void {
    const { requestId } = this;
    if (requestId !== undefined) {
      void this.environment.bridge()?.invoke('request:cancel', { requestId });
    }
  }

  /** Drops the failure the open dialog showed. */
  clearFailure(): void {
    this.patch({ failure: undefined });
  }

  /**
   * The Post button and its preview (or the own-PR offer) were about the head the reviewer saw;
   * once the head moves, posting would land on commits they haven't read, so a quiet note says so
   * (ADR 0078). A post in flight or one just made stays as it is.
   */
  invalidatePost(): void {
    const { kind } = this.snapshot.post;
    if (kind === 'idle' || kind === 'failed' || kind === 'own-pull-request') {
      this.patch({ post: { kind: 'head-moved' } });
    }
  }

  /** Dismisses the own-PR offer, result or failure. */
  cancelPost(): void {
    this.patch({ post: { kind: 'idle' } });
  }

  /**
   * Main compiles the review without posting it and says what goes inline and in the body, on
   * the head the reviewer sees. An older answer never replaces a newer one. Main finding the head
   * moved voids posting quietly; the review reloads only when the reviewer posts or asks.
   */
  async refreshPreview(): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined) {
      return;
    }
    this.previewRead += 1;
    const read = this.previewRead;
    this.patch({ preview: { kind: 'loading', last: lastPreviewOf(this.snapshot.preview) } });
    const preview = await bridge.invoke('github:preview-review', {
      sessionId: review.sessionId,
      expectedHeadSha: review.headSha,
    });
    if (read !== this.previewRead || this.environment.review()?.sessionId !== review.sessionId) {
      return;
    }
    if (!preview.ok) {
      this.patch({ preview: { kind: 'failed', text: preview.error.message } });
      return;
    }
    if ('kind' in preview.value) {
      if (preview.value.failure === 'head-moved') {
        this.patch({ preview: { kind: 'none' } });
        this.invalidatePost();
        return;
      }
      this.patch({ preview: { kind: 'failed', text: preview.value.message } });
      return;
    }
    this.patch({ preview: { kind: 'ready', preview: preview.value } });
  }

  /** Posts on the head the reviewer sees, which the preview names; one post at a time (ADR 0078). */
  async postReview({ verdict, summary }: GithubPostDetail): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined || this.snapshot.post.kind === 'busy') {
      return;
    }
    this.patch({ post: { kind: 'busy', text: 'Posting to GitHub…' } });
    const posted = await bridge.invoke('github:post-review', {
      sessionId: review.sessionId,
      expectedHeadSha: review.headSha,
      ...(verdict !== undefined && { verdict }),
      ...(summary !== undefined && { summary }),
    });
    if (this.environment.review()?.sessionId !== review.sessionId) {
      return;
    }
    if (!posted.ok) {
      this.patch({ post: { kind: 'failed', text: posted.error.message } });
      return;
    }
    const result = posted.value;
    if (result.kind === 'failed') {
      if (result.failure === 'head-moved') {
        this.headMoved(review.sessionId);
        return;
      }
      if (result.failure === 'own-pull-request') {
        this.patch({ post: { kind: 'own-pull-request', message: result.message } });
      } else {
        this.patch({ post: { kind: 'failed', text: result.message } });
      }
      return;
    }
    let moved = '';
    if (result.movedToBody > 0) {
      moved = ` GitHub refused ${String(result.movedToBody)} inline, so they went into the body.`;
    }
    this.patch({
      post: {
        kind: 'posted',
        url: result.url,
        text: `Posted: ${describeReviewPreview(result)}${moved}`,
      },
    });
    await this.refreshPreview();
  }
}

function isSamePreviewKey(left: PreviewKey, right: PreviewKey): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.headSha === right.headSha &&
    left.items === right.items &&
    left.verdict === right.verdict
  );
}

/** The preview to keep showing while a fresh one is compiled. */
function lastPreviewOf(state: GithubPreviewState): GithubReviewPreviewView | undefined {
  if (state.kind === 'ready') {
    return state.preview;
  }
  if (state.kind === 'loading') {
    return state.last;
  }
  return undefined;
}
