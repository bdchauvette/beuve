import type { ReactiveControllerHost } from 'lit';

import type { BeuveApi, ReviewEditsView } from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import { clearReviewEditsStatus } from './clear-review-edits-status.ts';
import type { StatusNotice } from './describe-editor-open.ts';
import type { ReviewEditsFlow } from './review-edits-state.ts';
import type { ReviewRef } from './review-ref.ts';

/** A repository-relative file and a line to open it at. */
export interface EditorPlace {
  readonly path: string;
  readonly line: number;
}

/** What the review edits need from the window around them. */
export interface ReviewEditsEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
  /** The open review, if there is one. */
  readonly review: () => ReviewRef | undefined;
  readonly notify: (notice: StatusNotice) => void;
  /** Staged suggestions show up in the dock: read its items again. */
  readonly refreshStaged: (sessionId: string) => Promise<void>;
}

interface ReviewEditsSnapshot {
  readonly view: ReviewEditsView | undefined;
  readonly flow: ReviewEditsFlow;
}

/**
 * The open session's review edits (ADR 0088): the writable branch beuve keeps for them, and the
 * confirm-then-act steps of Turn into Suggestions and Discard. Nothing is staged or discarded
 * without the confirmation step; main checks the previewed digest again. It has no lifecycle of
 * its own: the host re-renders when a getter's value changes.
 */
export class ReviewEditsController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: ReviewEditsEnvironment;
  private snapshot: ReviewEditsSnapshot = { view: undefined, flow: { kind: 'idle' } };

  constructor(host: ReactiveControllerHost, environment: ReviewEditsEnvironment) {
    this.host = host;
    this.environment = environment;
  }

  private patch(change: Partial<ReviewEditsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.host.requestUpdate();
  }

  /** The branch's state, or `undefined` before it is read. */
  get view(): ReviewEditsView | undefined {
    return this.snapshot.view;
  }

  /** Where the action in progress stands. */
  get flow(): ReviewEditsFlow {
    return this.snapshot.flow;
  }

  /** Forgets the open session's review edits: another session is opening. */
  reset(): void {
    this.patch({ view: undefined, flow: { kind: 'idle' } });
  }

  /** Drops a finished action's status line (ADR 0088). */
  clearStatus(): void {
    this.patch({ flow: clearReviewEditsStatus(this.snapshot.flow) });
  }

  /** Dismisses a preview, confirmation or status line. */
  cancel(): void {
    this.patch({ flow: { kind: 'idle' } });
  }

  async load(sessionId: string): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    const loaded = await bridge.invoke('review-edits:get', { sessionId });
    if (this.environment.review()?.sessionId !== sessionId) {
      return;
    }
    if (loaded.ok) {
      this.patch({ view: loaded.value });
    }
  }

  /** Open Review Edits (ADR 0088): the writable branch, made on first use, in the editor. */
  async open(place: EditorPlace | undefined): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined) {
      return;
    }
    this.clearStatus();
    const opened = await bridge.invoke('review-edits:open', {
      sessionId: review.sessionId,
      ...(place !== undefined && place),
    });
    if (!opened.ok) {
      this.environment.notify({ tone: 'error', text: opened.error.message });
      return;
    }
    let made = '';
    if (opened.value.created) {
      made = ', a new local branch beuve never pushes';
    }
    this.environment.notify({
      tone: 'info',
      text: `Opened review edits on ${revealFormatControls(opened.value.branch)}${made}, in ${opened.value.editorName}.`,
    });
    await this.load(review.sessionId);
  }

  /** Turn Edits into Suggestions, step one: what staging would do, to confirm. */
  async previewStage(): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined || this.snapshot.flow.kind === 'busy') {
      return;
    }
    this.patch({ flow: { kind: 'busy', text: 'Reading the review edits…' } });
    const plan = await bridge.invoke('review-edits:preview-suggestions', {
      sessionId: review.sessionId,
    });
    if (this.environment.review()?.sessionId !== review.sessionId) {
      return;
    }
    if (plan.ok) {
      this.patch({ flow: { kind: 'preview', plan: plan.value } });
    } else {
      this.patch({ flow: { kind: 'failed', text: plan.error.message } });
    }
  }

  /** Step two: stage exactly the previewed plan; main refuses if the edits changed since. */
  async stage(): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    const { flow } = this.snapshot;
    if (bridge === undefined || review === undefined || flow.kind !== 'preview') {
      return;
    }
    this.patch({ flow: { kind: 'busy', text: 'Staging…' } });
    const staged = await bridge.invoke('review-edits:stage-suggestions', {
      sessionId: review.sessionId,
      digest: flow.plan.digest,
    });
    if (this.environment.review()?.sessionId !== review.sessionId) {
      return;
    }
    if (!staged.ok) {
      this.patch({ flow: { kind: 'failed', text: staged.error.message } });
      return;
    }
    const { created, attached, updated, unchanged } = staged.value;
    this.patch({
      flow: {
        kind: 'done',
        text: `Staged: ${String(created)} new, ${String(attached)} attached to notes, ${String(updated)} updated, ${String(unchanged)} already there.`,
      },
    });
    void this.environment.refreshStaged(review.sessionId);
  }

  /** Discard Review Edits, step one: what would be lost. */
  async previewDiscard(): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined || this.snapshot.flow.kind === 'busy') {
      return;
    }
    this.patch({ flow: { kind: 'busy', text: 'Reading what Discard would remove…' } });
    const loss = await bridge.invoke('review-edits:preview-discard', {
      sessionId: review.sessionId,
    });
    if (this.environment.review()?.sessionId !== review.sessionId) {
      return;
    }
    if (loss.ok) {
      this.patch({ flow: { kind: 'discard', loss: loss.value } });
    } else {
      this.patch({ flow: { kind: 'failed', text: loss.error.message } });
    }
  }

  /** Step two: discard exactly what the confirmation showed. */
  async discard(): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    const { flow } = this.snapshot;
    if (bridge === undefined || review === undefined || flow.kind !== 'discard') {
      return;
    }
    this.patch({ flow: { kind: 'busy', text: 'Discarding…' } });
    const discarded = await bridge.invoke('review-edits:discard', {
      sessionId: review.sessionId,
      digest: flow.loss.digest,
    });
    if (this.environment.review()?.sessionId !== review.sessionId) {
      return;
    }
    if (discarded.ok) {
      this.patch({
        flow: { kind: 'done', text: `Discarded ${revealFormatControls(discarded.value.branch)}.` },
      });
    } else {
      this.patch({ flow: { kind: 'failed', text: discarded.error.message } });
    }
    await this.load(review.sessionId);
  }
}
