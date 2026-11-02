import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type {
  BeuveApi,
  CreateLocalSessionRequest,
  IpcResult,
  ReviewView,
  SessionSummary,
} from '#contract/ipc-contract.ts';

import type { OpenFailure } from './beuve-open-panel.ts';
import type { ReviewRef } from './review-ref.ts';

/** A review that arrived: what the window shows, and the head it showed before, if any. */
export interface ReviewLoaded {
  readonly review: ReviewView;
  /** The head of the review that was open for this same session, if one was. */
  readonly previousHead: string | undefined;
}

/** The checkpoint Save Progress recorded in this window, for the header's quiet status. */
export interface SavedProgress {
  readonly sessionId: string;
  readonly sha: string;
  readonly at: Temporal.Instant;
}

/** What the sessions need from the window around them. */
export interface SessionEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
  /** Whether the diff ignores whitespace, which the review is read with. */
  readonly ignoreWhitespace: () => boolean;
  /** Closes the Open dialog: a session is opening. */
  readonly closeOpenDialog: () => void;
  /** Another session is opening: forget what the open one loaded. */
  readonly switching: () => void;
  /** The same session loads again: its finished action status lines go. */
  readonly reloading: () => void;
  /** A review arrived; start what follows it. */
  readonly loaded: (change: ReviewLoaded) => void;
}

interface SessionSnapshot {
  readonly sessions: readonly SessionSummary[];
  readonly note: string;
  readonly selectedId: string;
  readonly review: ReviewView | undefined;
  readonly isLoading: boolean;
  readonly error: string;
  readonly isOpening: boolean;
  readonly localFailure: OpenFailure | undefined;
  readonly isMarking: boolean;
  readonly savedProgress: SavedProgress | undefined;
}

const initial: SessionSnapshot = {
  sessions: [],
  note: 'Loading sessions…',
  selectedId: '',
  review: undefined,
  isLoading: false,
  error: '',
  isOpening: false,
  localFailure: undefined,
  isMarking: false,
  savedProgress: undefined,
};

/**
 * The review sessions of this window and the one it shows (ADR 0079): the list, which session is
 * selected and its review, creating a local session, saving progress. A newer load supersedes an
 * older one, so only the latest answers. What the review brings along (its chat, dock, tree) is
 * the owner's to reset and start through the {@link SessionEnvironment}; the host re-renders when
 * a getter's value changes.
 */
export class SessionController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: SessionEnvironment;
  private snapshot: SessionSnapshot = initial;

  constructor(host: ReactiveControllerHost, environment: SessionEnvironment) {
    this.host = host;
    this.environment = environment;
    host.addController(this);
  }

  private patch(change: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.host.requestUpdate();
  }

  private applySessions(sessions: IpcResult<readonly SessionSummary[]>): void {
    if (sessions.ok) {
      this.patch({
        sessions: sessions.value,
        note: `${String(sessions.value.length)} sessions`,
      });
    } else {
      this.patch({ note: `Sessions unavailable: ${sessions.error.message}` });
    }
  }

  hostConnected(): void {
    if (this.environment.bridge() === undefined) {
      this.patch({ note: 'Running without the Electron bridge.' });
    }
  }

  get sessions(): readonly SessionSummary[] {
    return this.snapshot.sessions;
  }

  /** A line about the list: how many sessions, or why there are none. */
  get note(): string {
    return this.snapshot.note;
  }

  get selectedId(): string {
    return this.snapshot.selectedId;
  }

  /** The selected session's review, once it has loaded. */
  get review(): ReviewView | undefined {
    return this.snapshot.review;
  }

  /** The open review's session and head, for what only needs those. */
  get reviewRef(): ReviewRef | undefined {
    const { review } = this.snapshot;
    if (review === undefined) {
      return undefined;
    }
    return { sessionId: review.session.id, headSha: review.headSha };
  }

  /** Whether a review is loading. */
  get isLoading(): boolean {
    return this.snapshot.isLoading;
  }

  /** Why the review did not load, or why Save Progress failed; empty when nothing did. */
  get error(): string {
    return this.snapshot.error;
  }

  /** Whether a local session is being created. */
  get isOpening(): boolean {
    return this.snapshot.isOpening;
  }

  /** Why the last local session did not open, for the open dialog. */
  get localFailure(): OpenFailure | undefined {
    return this.snapshot.localFailure;
  }

  /** Whether Save Progress is waiting on main. */
  get isMarking(): boolean {
    return this.snapshot.isMarking;
  }

  get savedProgress(): SavedProgress | undefined {
    return this.snapshot.savedProgress;
  }

  /** Drops the failure the open dialog showed. */
  clearLocalFailure(): void {
    this.patch({ localFailure: undefined });
  }

  async refresh(): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      this.applySessions({
        ok: false,
        error: { code: 'not-wired', message: 'no Electron bridge' },
      });
      return;
    }
    this.applySessions(await bridge.invoke('session:list'));
  }

  /** Creates a session on a local repository and opens it. */
  async open(request: CreateLocalSessionRequest): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined || this.snapshot.isOpening) {
      return;
    }
    this.patch({ isOpening: true, localFailure: undefined });
    const created = await bridge.invoke('session:create-local', request);
    this.patch({ isOpening: false });
    if (!created.ok) {
      this.patch({ localFailure: { message: created.error.message } });
      return;
    }
    this.environment.closeOpenDialog();
    await this.refresh();
    await this.select(created.value.id);
  }

  /** Shows a session: another one starts afresh, the same one reloads in place. */
  async select(sessionId: string): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    this.environment.closeOpenDialog();
    let previousHead: string | undefined;
    const { review: shown } = this.snapshot;
    if (shown?.session.id === sessionId) {
      previousHead = shown.headSha;
    }
    if (sessionId === this.snapshot.selectedId) {
      this.environment.reloading();
    } else {
      this.patch({ review: undefined });
      this.environment.switching();
    }
    this.patch({ selectedId: sessionId, isLoading: true, error: '' });
    const review = await bridge.invoke('session:get-review', {
      sessionId,
      ignoreWhitespace: this.environment.ignoreWhitespace(),
    });
    // A newer load of this window superseded this one (ADR 0079); that one will answer.
    if (
      sessionId !== this.snapshot.selectedId ||
      (!review.ok && review.error.code === 'cancelled')
    ) {
      return;
    }
    this.patch({ isLoading: false });
    if (!review.ok) {
      this.patch({ review: undefined, error: review.error.message });
      return;
    }
    this.patch({ review: review.value });
    if (this.snapshot.sessions.every(({ id }) => id !== sessionId)) {
      void this.refresh();
    }
    this.environment.loaded({ review: review.value, previousHead });
  }

  /** Save Progress: records the head as reviewed, then shows what changed since. */
  async markReviewed(): Promise<void> {
    const bridge = this.environment.bridge();
    const { review } = this.snapshot;
    if (bridge === undefined || review === undefined || this.snapshot.isMarking) {
      return;
    }
    this.patch({ isMarking: true, error: '' });
    const marked = await bridge.invoke('session:mark-reviewed', {
      sessionId: review.session.id,
      expectedHeadSha: review.headSha,
    });
    this.patch({ isMarking: false });
    if (!marked.ok) {
      this.patch({ error: marked.error.message });
      return;
    }
    this.patch({
      savedProgress: {
        sessionId: review.session.id,
        sha: review.headSha,
        at: Temporal.Now.instant(),
      },
    });
    await this.refresh();
    await this.select(review.session.id);
  }
}
