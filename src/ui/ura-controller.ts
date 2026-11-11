import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type {
  BeuveApi,
  IpcResult,
  UraExportTarget,
  UraItemView,
  UraSeverityView,
  UraStagedView,
  UraVerdictView,
} from '#contract/ipc-contract.ts';

import type { UraCreateRequest } from './beuve-diff-stream.ts';
import type { NoteExpandDraft, NoteExpandOutcome } from './beuve-note-expand.ts';
import type { DockNotice } from './beuve-ura-dock.ts';
import { countNoun } from './count-noun.ts';
import type { ReviewRef } from './review-ref.ts';

/** The fields of a staged item the dock edited. */
export interface UraUpdateDetail {
  readonly itemId: string;
  readonly title?: string;
  readonly body?: string;
  readonly severity?: UraSeverityView;
  readonly suggestedPatch?: string;
}

/** Where a staged item can move to from the dock. */
export type UraTransitionTarget = 'staged' | 'withdrawn' | 'addressed';

/** What the staged review needs from the window around it. */
export interface UraEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
  /** The open review, if there is one. */
  readonly review: () => ReviewRef | undefined;
}

interface UraSnapshot {
  readonly items: readonly UraItemView[];
  readonly derivedVerdict: UraVerdictView;
  readonly chosenVerdict: UraVerdictView | undefined;
  readonly verdictNotice: string;
  readonly notice: DockNotice | undefined;
  readonly isExporting: boolean;
}

const initial: UraSnapshot = {
  items: [],
  derivedVerdict: 'approve',
  chosenVerdict: undefined,
  verdictNotice: '',
  notice: undefined,
  isExporting: false,
};

/**
 * The review dock's state and flows (ADR 0027, 0043): the open session's staged items, its
 * derived and chosen verdict, the notice under the export buttons, and every call that changes
 * them. `ura:changed` refreshes the list while the host is connected. The open review comes in
 * through the {@link UraEnvironment}; the host re-renders when a getter's value changes.
 */
export class UraController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: UraEnvironment;
  private snapshot: UraSnapshot = initial;
  private unsubscribe: (() => void) | undefined;

  constructor(host: ReactiveControllerHost, environment: UraEnvironment) {
    this.host = host;
    this.environment = environment;
    host.addController(this);
  }

  /** Runs a dock call; `ura:changed` refreshes the list, and failures show in the dock. */
  private async call(run: (bridge: BeuveApi) => Promise<IpcResult<unknown>>): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    const result = await run(bridge);
    this.noteFailure(result);
    const review = this.environment.review();
    if (review !== undefined && !result.ok) {
      await this.refresh(review.sessionId);
    }
  }

  /** A moved head (`stale-review`) is expected, so it reads as a quiet note, not an error. */
  private noteFailure(result: IpcResult<unknown>): void {
    if (result.ok) {
      return;
    }
    if (result.error.code === 'stale-review') {
      this.patch({ notice: { tone: 'info', text: result.error.message } });
    } else {
      this.patch({ notice: { tone: 'error', text: result.error.message } });
    }
  }

  private patch(change: Partial<UraSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.host.requestUpdate();
  }

  hostConnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.environment.bridge()?.on('ura:changed', ({ sessionId }) => {
      if (sessionId === this.environment.review()?.sessionId) {
        void this.refresh(sessionId);
      }
    });
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** The open session's items, every status, placed on its current head. */
  get items(): readonly UraItemView[] {
    return this.snapshot.items;
  }

  get derivedVerdict(): UraVerdictView {
    return this.snapshot.derivedVerdict;
  }

  get chosenVerdict(): UraVerdictView | undefined {
    return this.snapshot.chosenVerdict;
  }

  get verdictNotice(): string {
    return this.snapshot.verdictNotice;
  }

  get notice(): DockNotice | undefined {
    return this.snapshot.notice;
  }

  /** Whether the review is being compiled and copied. */
  get isExporting(): boolean {
    return this.snapshot.isExporting;
  }

  /** How many items are staged now. */
  get stagedCount(): number {
    return this.snapshot.items.filter((item) => item.status.kind === 'staged').length;
  }

  /** `/review` findings staged and still staged, as `messageId:index`. */
  stagedFindings(): ReadonlySet<string> {
    return new Set(
      this.snapshot.items.flatMap((item) => {
        if (
          item.origin.kind === 'chat-answer' &&
          item.origin.finding !== undefined &&
          item.status.kind === 'staged'
        ) {
          return `${item.origin.messageId}:${String(item.origin.finding)}`;
        }
        return [];
      }),
    );
  }

  /** Notes answers proposed, staged and still staged, as `messageId:index` (ADR 0132). */
  stagedProposals(): ReadonlySet<string> {
    return new Set(
      this.snapshot.items.flatMap((item) => {
        if (
          item.origin.kind === 'chat-answer' &&
          item.origin.proposal !== undefined &&
          item.status.kind === 'staged'
        ) {
          return `${item.origin.messageId}:${String(item.origin.proposal)}`;
        }
        return [];
      }),
    );
  }

  /** Forgets the open session's items, chosen verdict and notice: another session is opening. */
  reset(): void {
    this.patch({ items: [], chosenVerdict: undefined, verdictNotice: '', notice: undefined });
  }

  async refresh(sessionId: string): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    const listed = await bridge.invoke('ura:list', { sessionId });
    if (!listed.ok || this.environment.review()?.sessionId !== sessionId) {
      return;
    }
    this.patch({
      items: listed.value.items,
      derivedVerdict: listed.value.derivedVerdict,
      chosenVerdict: listed.value.chosenVerdict,
      verdictNotice: listed.value.verdictNotice ?? '',
    });
  }

  /** Stages the composer's note; `settle` closes the composer or keeps it open with the error. */
  async create(request: UraCreateRequest): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined) {
      request.settle('No review session is open.');
      return;
    }
    const created = await bridge.invoke('ura:create', {
      sessionId: review.sessionId,
      headSha: request.headSha,
      anchor: request.anchor,
      severity: request.draft.severity,
      blocking: request.draft.blocking,
      title: request.draft.title,
      body: request.draft.body,
      ...(request.suggestedPatch !== undefined && { suggestedPatch: request.suggestedPatch }),
    });
    if (!created.ok) {
      request.settle(created.error.message);
      return;
    }
    request.settle(undefined);
    this.patch({ notice: { tone: 'info', text: `Staged “${created.value.title}”.` } });
  }

  async update(detail: UraUpdateDetail): Promise<void> {
    await this.call(async (bridge) => bridge.invoke('ura:update', detail));
  }

  async transition(itemId: string, to: UraTransitionTarget): Promise<void> {
    await this.call(async (bridge) => {
      return bridge.invoke('ura:transition', { itemId, to });
    });
  }

  /** Shows the new order at once; a refused move is put right by the refresh after it. */
  async reorder(itemIds: readonly string[]): Promise<void> {
    const review = this.environment.review();
    if (review === undefined) {
      return;
    }
    const byId = new Map(
      this.snapshot.items.map((item) => {
        return [item.id, item];
      }),
    );
    this.patch({
      items: itemIds.flatMap((id) => {
        return byId.get(id) ?? [];
      }),
    });
    await this.call(async (bridge) => {
      return bridge.invoke('ura:reorder', { sessionId: review.sessionId, itemIds });
    });
  }

  /**
   * "Expand on this" (ADR 0125): the draft through `ura:expand-note`, at its own head or the open
   * review's. Aborting `signal` cancels it in main, which then answers `cancelled`.
   */
  async expandNote(draft: NoteExpandDraft, signal: AbortSignal): Promise<NoteExpandOutcome> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined) {
      return { kind: 'failed', message: 'No review session is open.' };
    }
    if (signal.aborted) {
      return { kind: 'cancelled' };
    }
    const requestId = `expand-note:${draft.noteKey}`;
    using listening = new DisposableStack();
    const cancel = (): void => {
      void bridge.invoke('request:cancel', { requestId });
    };
    signal.addEventListener('abort', cancel, { once: true });
    listening.defer(() => {
      signal.removeEventListener('abort', cancel);
    });
    const expanded = await bridge.invoke('ura:expand-note', {
      sessionId: review.sessionId,
      headSha: draft.headSha ?? review.headSha,
      anchor: draft.anchor,
      severity: draft.severity,
      blocking: draft.blocking,
      title: draft.title,
      body: draft.body,
      requestId,
    });
    if (!expanded.ok) {
      if (expanded.error.code === 'cancelled') {
        return { kind: 'cancelled' };
      }
      return { kind: 'failed', message: expanded.error.message };
    }
    if (expanded.value.outcome === 'failed') {
      return { kind: 'failed', message: expanded.value.message };
    }
    return { kind: 'expanded', body: expanded.value.body };
  }

  /** The reviewer's verdict; `undefined` goes back to the derived one. */
  async setVerdict(verdict: UraVerdictView | undefined): Promise<void> {
    const review = this.environment.review();
    if (review === undefined) {
      return;
    }
    await this.call(async (bridge) => {
      return bridge.invoke('ura:set-verdict', {
        sessionId: review.sessionId,
        expectedHeadSha: review.headSha,
        ...(verdict !== undefined && { verdict }),
      });
    });
  }

  /** Stages one `/review` finding on its lines; main reads it from the stored answer. */
  async stageReviewFinding(messageId: string, finding: number): Promise<void> {
    if (this.stagedFindings().has(`${messageId}:${String(finding)}`)) {
      return;
    }
    await this.call(async (bridge) => {
      const staged = await bridge.invoke('ura:stage-review-finding', { messageId, finding });
      if (staged.ok) {
        this.patch({ notice: { tone: 'info', text: stagedNotice(staged.value) } });
      }
      return staged;
    });
  }

  /** Stages one note an answer proposed on its lines; main reads it from the stored answer. */
  async stageNoteProposal(messageId: string, proposal: number): Promise<void> {
    if (this.stagedProposals().has(`${messageId}:${String(proposal)}`)) {
      return;
    }
    await this.call(async (bridge) => {
      const staged = await bridge.invoke('ura:stage-note-proposal', { messageId, proposal });
      if (staged.ok) {
        this.patch({ notice: { tone: 'info', text: stagedNotice(staged.value) } });
      }
      return staged;
    });
  }

  /** Compiles the review in main and copies it with main's clipboard (ADR 0027). */
  async export(target: UraExportTarget): Promise<void> {
    const bridge = this.environment.bridge();
    const review = this.environment.review();
    if (bridge === undefined || review === undefined || this.snapshot.isExporting) {
      return;
    }
    this.patch({ isExporting: true });
    const compiled = await bridge.invoke('ura:export', { sessionId: review.sessionId, target });
    if (!compiled.ok) {
      this.patch({
        isExporting: false,
        notice: { tone: 'error', text: compiled.error.message },
      });
      return;
    }
    const copied = await bridge.invoke('clipboard:write-text', { text: compiled.value.text });
    const { itemCount, outdatedCount } = compiled.value;
    if (!copied.ok) {
      this.patch({
        isExporting: false,
        notice: { tone: 'error', text: `Could not copy: ${copied.error.message}` },
      });
      return;
    }
    const counts = [countNoun(itemCount, 'item')];
    if (outdatedCount > 0) {
      counts.push(`${String(outdatedCount)} outdated`);
    }
    counts.push(sizeText(compiled.value.text.length));
    this.patch({
      isExporting: false,
      notice: { tone: 'info', text: `Copied ${exportLabels[target]}: ${counts.join(', ')}.` },
    });
  }
}

const exportLabels: Readonly<Record<UraExportTarget, string>> = {
  'agent-xml': 'the review for Claude Code as XML',
  'agent-json': 'the review for agents as JSON',
  github: 'the GitHub review JSON',
};

/** "Staged “Title”.", or that it already was; a note without a title is "the note". */
function stagedNotice({ item, created }: UraStagedView): string {
  let name = 'the note';
  if (item.title !== '') {
    name = `“${item.title}”`;
  }
  if (created) {
    return `Staged ${name}.`;
  }
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} is already staged.`;
}

function sizeText(characters: number): string {
  if (characters < 1024) {
    return `${String(characters)} characters`;
  }
  return `${(characters / 1024).toFixed(1)} K characters`;
}
