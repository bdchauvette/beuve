import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type {
  BeuveApi,
  CiStatusView,
  GithubAuthStatusView,
  OpenPullRequestRequest,
  PullRequestSessionView,
  PullRequestUpdatedView,
  RemoteBranchUpdatedView,
  RemoteBranchView,
  UraVerdictView,
} from '#contract/ipc-contract.ts';

import type { OpenFailure } from './beuve-open-panel.ts';
import { describeReviewPreview } from './describe-review-preview.ts';
import type { StatusNotice } from './describe-editor-open.ts';
import type { GithubPostState } from './github-post-state.ts';
import { parseOpenQuery } from './parse-open-query.ts';
import type { ReviewRef } from './review-ref.ts';
import type { TimelineState } from './timeline-state.ts';

/** Post the staged review to GitHub, with this verdict over the derived one. */
export interface GithubPostDetail {
  readonly verdict?: UraVerdictView | undefined;
  /** The reviewer's rewritten summary; absent while the generated one is unchanged. */
  readonly summary?: string | undefined;
}

/** What the GitHub flows need from the window around them. */
export interface GithubEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
  /** The open review, if there is one. */
  readonly review: () => ReviewRef | undefined;
  readonly notify: (notice: StatusNotice) => void;
  readonly refreshSessions: () => Promise<void>;
  readonly selectSession: (sessionId: string) => Promise<void>;
  /** Shows or closes the open dialog, which carries a pull request's failure. */
  readonly setOpenDialog: (isOpen: boolean) => void;
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
  readonly isOpening: boolean;
  readonly failure: OpenFailure | undefined;
}

const initial: GithubSnapshot = {
  pullRequest: undefined,
  branch: undefined,
  ci: undefined,
  timeline: undefined,
  auth: undefined,
  post: { kind: 'idle' },
  isOpening: false,
  failure: undefined,
};

/**
 * The window's GitHub state and flows (ADR 0037 to 0040, 0078): opening a pull request, the open
 * one's metadata, stack and CI (kept fresh by `github:pr-updated` and `github:ci-status` while the
 * host is connected), who beuve posts as, and the confirm-then-post steps of a review. The open
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
  private unsubscribes: (() => void)[] = [];

  constructor(host: ReactiveControllerHost, environment: GithubEnvironment) {
    this.host = host;
    this.environment = environment;
    host.addController(this);
  }

  /** Polling found a change; a new head reloads the review, which then offers the interdiff. */
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
    if (!event.headMoved) {
      return;
    }
    this.invalidatePost();
    this.environment.notify({
      tone: 'info',
      text: `New commits on #${String(event.pullRequest.number)}; the review now shows what changed.`,
    });
    void this.environment.selectSession(event.sessionId);
  }

  /**
   * Polling found a followed branch changed (ADR 0112). A promotion reloads the session, which
   * now opens as its pull request; a new head reloads the review, which offers the interdiff.
   */
  private applyBranchUpdate(event: RemoteBranchUpdatedView): void {
    void this.environment.refreshSessions();
    if (event.sessionId !== this.environment.review()?.sessionId) {
      return;
    }
    this.patch({ branch: event.branch });
    const name = event.branch.branch;
    if (event.promoted) {
      this.environment.notify({
        tone: 'info',
        text: `${name} has a pull request now; this review continues as #${String(event.branch.pullRequest?.number ?? '')}.`,
      });
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
    this.environment.notify({
      tone: 'info',
      text: `New commits on ${name}; the review now shows what changed.`,
    });
    void this.environment.selectSession(event.sessionId);
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
    this.patch({
      pullRequest: undefined,
      branch: undefined,
      ci: undefined,
      timeline: undefined,
      post: { kind: 'idle' },
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
   * A confirmation (or the own-PR offer) was about the head the reviewer saw; once the head moves
   * it would post on commits they haven't read, so it gives way to a quiet note (ADR 0078).
   */
  invalidatePost(): void {
    const { kind } = this.snapshot.post;
    if (kind === 'confirm' || kind === 'own-pull-request') {
      this.patch({ post: { kind: 'head-moved' } });
    }
  }

  /** Dismisses the confirmation, result or failure. */
  cancelPost(): void {
    this.patch({ post: { kind: 'idle' } });
  }

  /** The confirmation step: main compiles the review and says what goes inline and in the body. */
  async previewReview(): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined || this.snapshot.post.kind === 'busy') {
      return;
    }
    this.patch({ post: { kind: 'busy', text: 'Compiling the review…' } });
    const preview = await bridge.invoke('github:preview-review', {
      sessionId: review.sessionId,
      expectedHeadSha: review.headSha,
    });
    const current = this.environment.review();
    if (current?.sessionId !== review.sessionId) {
      return;
    }
    if (!preview.ok) {
      this.patch({ post: { kind: 'failed', text: preview.error.message } });
      return;
    }
    if ('kind' in preview.value) {
      if (preview.value.failure === 'head-moved') {
        this.headMoved(review.sessionId);
        return;
      }
      this.patch({ post: { kind: 'failed', text: preview.value.message } });
      return;
    }
    if (current.headSha !== preview.value.headSha) {
      this.patch({ post: { kind: 'head-moved' } });
      return;
    }
    this.patch({ post: { kind: 'confirm', preview: preview.value } });
  }

  /** Posts on the head the confirmation showed; one post at a time (ADR 0078). */
  async postReview({ verdict, summary }: GithubPostDetail): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    const { post } = this.snapshot;
    if (bridge === undefined || review === undefined || post.kind === 'busy') {
      return;
    }
    let expectedHeadSha = review.headSha;
    if (post.kind === 'confirm') {
      expectedHeadSha = post.preview.headSha;
    }
    this.patch({ post: { kind: 'busy', text: 'Posting to GitHub…' } });
    const posted = await bridge.invoke('github:post-review', {
      sessionId: review.sessionId,
      expectedHeadSha,
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
        this.patch({ post: { kind: 'own-pull-request', message: result.message, summary } });
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
  }
}
