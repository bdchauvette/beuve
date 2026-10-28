import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import type {
  AgentInsightView,
  AppInfo,
  CallHierarchyView,
  CreateLocalSessionRequest,
  FilePairView,
  ImpactView,
  InsightStatusView,
  IpcResult,
  McpStatus,
  RepositoryTreeView,
  ReviewProgressView,
  ReviewView,
  SessionSummary,
  UraExportTarget,
  UraItemView,
  UraSeverityView,
  UraVerdictView,
} from '#contract/ipc-contract.ts';

import './beuve-chat-drawer.ts';
import './beuve-diff-stream.ts';
import './beuve-intent-sidebar.ts';
import './beuve-keybinding-overlay.ts';
import './beuve-status-bar.ts';
import './beuve-ura-dock.ts';
import { advanceReviewEntry } from './advance-review-entry.ts';
import { beuveBridge } from './beuve-bridge.ts';
import type { FileJump, InsightJump, UraCreateRequest } from './beuve-diff-stream.ts';
import type { FilePairLoader } from './beuve-file-card.ts';
import type { DockNotice } from './beuve-ura-dock.ts';
import type { ChatCitation, ChatEntry, ReviewChatEntry } from './chat-entry.ts';
import { chatHelp } from './chat-help.ts';
import { cycleZone } from './cycle-zone.ts';
import { parseChatCommand } from './parse-chat-command.ts';
import type { ChatCommand } from './parse-chat-command.ts';
import type { PeekChildren, PeekState } from './peek-state.ts';
import type { RadarTreeMode } from './plan-radar-tree.ts';
import { zones } from './zones.ts';
import type { ZoneId } from './zones.ts';

const impactGraceMs = 1500;

/**
 * Root of the renderer: the four-zone shell (spec section 4), the zone focus model and the
 * keys the shell already handles. Owns all bridge calls and session state; zones are
 * presentational and report user intent with events.
 */
@customElement('beuve-app')
export class BeuveApp extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      height: 100%;
      grid-template-columns: var(--beuve-intent-width) minmax(0, 1fr) var(--beuve-ura-width);
      grid-template-rows: var(--beuve-titlebar-height) minmax(0, 1fr) auto var(
          --beuve-statusbar-height
        );
      grid-template-areas:
        'title title title'
        'intent diff ura'
        'intent chat ura'
        'status status status';
    }

    .titlebar {
      grid-area: title;
      display: flex;
      align-items: center;
      gap: var(--beuve-space-3);
      padding: 0 var(--beuve-space-4);
      border-bottom: 1px solid var(--beuve-border);
      background: var(--beuve-surface-sunken);
      -webkit-app-region: drag;
      user-select: none;
    }

    :host([data-platform='darwin']) .titlebar {
      padding-left: 84px;
    }

    .brand {
      font-weight: 600;
    }

    .session {
      color: var(--beuve-text-muted);
    }

    beuve-intent-sidebar {
      grid-area: intent;
    }

    beuve-diff-stream {
      grid-area: diff;
    }

    beuve-ura-dock {
      grid-area: ura;
    }

    beuve-chat-drawer {
      grid-area: chat;
      height: var(--beuve-chat-height);
    }

    beuve-status-bar {
      grid-area: status;
    }
  `;

  private unsubscribes: (() => void)[] = [];
  private nextEntryId = 1;
  private jumpNonce = 0;
  /** The latest `review:progress` event per run, for runs whose handle hasn't arrived yet. */
  private readonly runEvents = new Map<string, ReviewProgressView>();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.handleKey(event);
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    const zone = event
      .composedPath()
      .find((target) => target instanceof HTMLElement && target.dataset['zone'] !== undefined);
    if (zone instanceof HTMLElement) {
      this.focusedZone = zone.dataset['zone'] as ZoneId;
    }
  };

  private readonly onOpenRepository = (event: CustomEvent<CreateLocalSessionRequest>): void => {
    void this.openRepository(event.detail);
  };

  private readonly onSelectSession = (event: CustomEvent<{ sessionId: string }>): void => {
    void this.selectSession(event.detail.sessionId);
  };

  private readonly onMarkReviewed = (): void => {
    void this.markReviewed();
  };

  private readonly onPeekRequest = (
    event: CustomEvent<{ path: string; line: number | undefined }>,
  ): void => {
    void this.openPeek(event.detail.path, event.detail.line);
  };

  private readonly onPeekExpand = (event: CustomEvent<{ nodeId: string }>): void => {
    void this.expandPeek(event.detail.nodeId);
  };

  private readonly onPeekClose = (): void => {
    this.peek = undefined;
  };

  private readonly onChatSubmit = (event: CustomEvent<{ text: string }>): void => {
    this.submitChat(event.detail.text);
  };

  private readonly onChatEscape = (): void => {
    this.focusedZone = 'diff';
  };

  private readonly onCitation = (event: CustomEvent<{ insightId: string }>): void => {
    this.jumpNonce += 1;
    this.insightJump = { insightId: event.detail.insightId, nonce: this.jumpNonce };
    this.focusedZone = 'diff';
  };

  /** Resolves the wait in {@link loadImpactAfterFirstDiff}; set while it waits. */
  private releaseImpact: (() => void) | undefined;

  private readonly onDiffRendered = (): void => {
    this.releaseImpact?.();
  };

  private readonly onTreeSelect = (event: CustomEvent<{ path: string }>): void => {
    this.jumpNonce += 1;
    this.fileJump = { path: event.detail.path, nonce: this.jumpNonce };
  };

  /** Hunk expansion reads whole files through `session:get-file-pair`. */
  private readonly loadFilePair: FilePairLoader = async (
    path: string,
  ): Promise<FilePairView | undefined> => {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return undefined;
    }
    const pair = await bridge.invoke('session:get-file-pair', {
      sessionId: review.session.id,
      path,
    });
    return pair.ok ? pair.value : undefined;
  };

  private readonly onUraCreate = (event: CustomEvent<UraCreateRequest>): void => {
    void this.createUraItem(event.detail);
  };

  private readonly onUraUpdate = (
    event: CustomEvent<{ itemId: string; title: string; body: string; severity: UraSeverityView }>,
  ): void => {
    void this.uraCall(async (bridge) => bridge.invoke('ura:update', event.detail));
  };

  private readonly onUraTransition = (
    event: CustomEvent<{ itemId: string; to: 'staged' | 'withdrawn' | 'addressed' }>,
  ): void => {
    void this.transitionUraItem(event.detail.itemId, event.detail.to);
  };

  private readonly onUraReorder = (event: CustomEvent<{ itemIds: readonly string[] }>): void => {
    const { review } = this;
    if (review === undefined) {
      return;
    }
    const byId = new Map(this.uraItems.map((item) => [item.id, item]));
    this.uraItems = event.detail.itemIds.flatMap((id) => byId.get(id) ?? []);
    void this.uraCall(async (bridge) =>
      bridge.invoke('ura:reorder', { sessionId: review.session.id, itemIds: event.detail.itemIds }),
    );
  };

  private readonly onUraExport = (event: CustomEvent<{ target: UraExportTarget }>): void => {
    void this.exportUra(event.detail.target);
  };

  private readonly onUraSetVerdict = (
    event: CustomEvent<{ verdict: UraVerdictView | undefined }>,
  ): void => {
    const { review } = this;
    if (review === undefined) {
      return;
    }
    const { verdict } = event.detail;
    void this.uraCall(async (bridge) =>
      bridge.invoke('ura:set-verdict', {
        sessionId: review.session.id,
        ...(verdict !== undefined && { verdict }),
      }),
    );
  };

  private readonly onUraJump = (event: CustomEvent<{ item: UraItemView }>): void => {
    const { placement, anchor } = event.detail.item;
    const target = placement.kind === 'current' ? placement.anchor : anchor;
    if (target.kind === 'change') {
      return;
    }
    this.jumpNonce += 1;
    this.fileJump = {
      path: target.path,
      ...(target.kind === 'lines' && placement.kind === 'current' && { line: target.startLine }),
      nonce: this.jumpNonce,
    };
    this.focusedZone = 'diff';
  };

  private readonly onStageFinding = (
    event: CustomEvent<{ path: string; functionName: string }>,
  ): void => {
    const { review } = this;
    if (review === undefined) {
      return;
    }
    void this.uraCall(async (bridge) =>
      bridge.invoke('ura:stage-impact-finding', { sessionId: review.session.id, ...event.detail }),
    );
  };

  private readonly onInsightStatus = (
    event: CustomEvent<{ insightId: string; status: InsightStatusView }>,
  ): void => {
    void this.setInsightStatus(event.detail.insightId, event.detail.status);
  };

  @state() accessor focusedZone: ZoneId = 'diff';
  @state() accessor chatOpen = false;
  @state() accessor overlayOpen = false;
  @state() accessor appInfo: AppInfo | undefined;
  @state() accessor mcpStatus: McpStatus | undefined;
  @state() accessor sessionNote = 'Loading sessions…';
  @state() accessor sessions: readonly SessionSummary[] = [];
  @state() accessor selectedId = '';
  @state() accessor review: ReviewView | undefined;
  @state() accessor impact: ImpactView | undefined;
  @state() accessor peek: PeekState | undefined;
  @state() accessor reviewLoading = false;
  @state() accessor reviewError = '';
  @state() accessor marking = false;
  @state() accessor opening = false;
  @state() accessor openError = '';
  @state() accessor transcript: readonly ChatEntry[] = [];
  /** Agent insights for the open review's head. */
  @state() accessor insights: readonly AgentInsightView[] = [];
  @state() accessor insightJump: InsightJump | undefined;
  @state() accessor fileJump: FileJump | undefined;
  /** The open session head's tracked paths, for the radar tree. */
  @state() accessor tree: RepositoryTreeView | undefined;
  @state() accessor treeMode: RadarTreeMode = 'neighborhood';
  /** The open session's URA items, every status, placed on its current head. */
  @state() accessor uraItems: readonly UraItemView[] = [];
  @state() accessor uraVerdict: UraVerdictView = 'approve';
  @state() accessor chosenVerdict: UraVerdictView | undefined;
  @state() accessor verdictNotice = '';
  @state() accessor dockNotice: DockNotice | undefined;
  @state() accessor exporting = false;

  constructor() {
    super();
    this.addController({
      hostConnected: (): void => {
        this.connect();
      },
      hostDisconnected: (): void => {
        this.disconnect();
      },
    });
  }

  private connect(): void {
    addEventListener('keydown', this.onKeyDown, { capture: true });
    this.addEventListener('focusin', this.onFocusIn);
    const bridge = beuveBridge();
    if (bridge === undefined) {
      this.sessionNote = 'Running without the Electron bridge.';
      return;
    }
    this.unsubscribes = [
      bridge.on('mcp:status', (status) => {
        this.mcpStatus = status;
      }),
      bridge.on('review:progress', (event) => {
        this.applyReviewProgress(event);
      }),
      bridge.on('ura:changed', ({ sessionId }) => {
        if (sessionId === this.review?.session.id) {
          void this.refreshUra(sessionId);
        }
      }),
    ];
    void this.loadInitialState();
  }

  private disconnect(): void {
    removeEventListener('keydown', this.onKeyDown, { capture: true });
    this.removeEventListener('focusin', this.onFocusIn);
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes = [];
  }

  private async loadInitialState(): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const [info, sessions] = await Promise.all([
      bridge.invoke('app:get-info'),
      bridge.invoke('session:list'),
    ]);
    if (info.ok) {
      this.appInfo = info.value;
      this.dataset['platform'] = info.value.platform;
    }
    this.applySessions(sessions);
  }

  private applySessions(sessions: IpcResult<readonly SessionSummary[]>): void {
    if (sessions.ok) {
      this.sessions = sessions.value;
      this.sessionNote = `${String(sessions.value.length)} sessions`;
    } else {
      this.sessionNote = `Sessions unavailable: ${sessions.error.message}`;
    }
  }

  private async listSessions(): Promise<IpcResult<readonly SessionSummary[]>> {
    const bridge = beuveBridge();
    return bridge === undefined
      ? { ok: false, error: { code: 'not-wired', message: 'no Electron bridge' } }
      : bridge.invoke('session:list');
  }

  private async refreshSessions(): Promise<void> {
    this.applySessions(await this.listSessions());
  }

  private async openRepository(request: CreateLocalSessionRequest): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined || this.opening) {
      return;
    }
    this.opening = true;
    this.openError = '';
    const created = await bridge.invoke('session:create-local', request);
    this.opening = false;
    if (!created.ok) {
      this.openError = created.error.message;
      return;
    }
    await this.refreshSessions();
    await this.selectSession(created.value.id);
  }

  private async selectSession(sessionId: string): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    if (sessionId !== this.selectedId) {
      this.review = undefined;
      this.insights = [];
      this.tree = undefined;
      this.uraItems = [];
      this.chosenVerdict = undefined;
      this.verdictNotice = '';
      this.dockNotice = undefined;
    }
    this.selectedId = sessionId;
    this.reviewLoading = true;
    this.reviewError = '';
    const review = await bridge.invoke('session:get-review', { sessionId });
    if (sessionId !== this.selectedId) {
      return;
    }
    this.reviewLoading = false;
    this.peek = undefined;
    if (review.ok) {
      if (this.review?.headSha !== review.value.headSha) {
        this.insights = [];
      }
      this.review = review.value;
      this.focusedZone = 'diff';
      void this.loadImpactAfterFirstDiff(review.value);
      void this.loadTree(review.value);
      void this.refreshInsights(review.value.session.id);
      void this.refreshUra(review.value.session.id);
    } else {
      this.review = undefined;
      this.reviewError = review.error.message;
    }
  }

  /**
   * ImpactGate parses in main's thread, which also serves the renderer's `file://` chunk loads.
   * Asking only once the first diff has rendered (or after a grace period, for reviews with no
   * text diff) keeps it from stalling the highlighter's first load (ADR 0025).
   */
  private async loadImpactAfterFirstDiff(review: ReviewView): Promise<void> {
    this.releaseImpact?.();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, impactGraceMs);
      this.releaseImpact = (): void => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.releaseImpact = undefined;
    if (this.review === review) {
      await this.loadImpact(review);
    }
  }

  /** ImpactGate runs after the review has rendered, so parsing never delays the diff. */
  private async loadImpact(review: ReviewView): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined || review.files.length === 0) {
      this.impact = undefined;
      return;
    }
    if (this.impact?.headSha !== review.headSha || this.impact.sessionId !== review.session.id) {
      this.impact = undefined;
    }
    const impact = await bridge.invoke('session:get-impact', { sessionId: review.session.id });
    if (this.review !== review) {
      return;
    }
    this.impact = impact.ok && impact.value.headSha === review.headSha ? impact.value : undefined;
  }

  /** The radar tree's paths, once per head. */
  private async loadTree(review: ReviewView): Promise<void> {
    const bridge = beuveBridge();
    if (
      bridge === undefined ||
      (this.tree?.sessionId === review.session.id && this.tree.headSha === review.headSha)
    ) {
      return;
    }
    const tree = await bridge.invoke('session:get-tree', { sessionId: review.session.id });
    if (this.review === review && tree.ok) {
      this.tree = tree.value;
    }
  }

  private async openPeek(path: string, line: number | undefined): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    if (line === undefined) {
      this.peek = {
        path,
        line,
        status: 'error',
        message: 'This file has no head-side change to peek at.',
      };
      return;
    }
    const pending: PeekState = { path, line, status: 'loading' };
    this.peek = pending;
    const answer = await bridge.invoke('lsp:call-hierarchy', {
      sessionId: review.session.id,
      path,
      line,
      direction: 'incoming',
    });
    if (this.peek !== pending || this.review !== review) {
      return;
    }
    this.peek = toPeekState(path, line, answer);
  }

  private async expandPeek(nodeId: string): Promise<void> {
    const bridge = beuveBridge();
    const { review, peek } = this;
    if (bridge === undefined || review === undefined || peek?.status !== 'ready') {
      return;
    }
    const withChildren = (state: PeekState, children: PeekChildren): PeekState =>
      state.status === 'ready'
        ? { ...state, children: new Map(state.children).set(nodeId, children) }
        : state;
    this.peek = withChildren(peek, { status: 'loading' });
    const answer = await bridge.invoke('lsp:call-hierarchy', {
      sessionId: review.session.id,
      path: peek.path,
      line: peek.line ?? 1,
      direction: 'incoming',
      nodeId,
    });
    const current = this.currentPeek();
    if (current?.status !== 'ready' || current.root.id !== peek.root.id) {
      return;
    }
    this.peek = withChildren(
      current,
      answer.ok
        ? { status: 'ready', calls: answer.value.calls }
        : { status: 'error', message: answer.error.message },
    );
  }

  /** Reads the peek state afresh after an await, when it may have changed. */
  private currentPeek(): PeekState | undefined {
    return this.peek;
  }

  private async markReviewed(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined || this.marking) {
      return;
    }
    this.marking = true;
    this.reviewError = '';
    const marked = await bridge.invoke('session:mark-reviewed', {
      sessionId: review.session.id,
      expectedHeadSha: review.headSha,
    });
    this.marking = false;
    if (!marked.ok) {
      this.reviewError = marked.error.message;
      return;
    }
    await this.refreshSessions();
    await this.selectSession(review.session.id);
  }

  private submitChat(text: string): void {
    const command = parseChatCommand(text);
    if (command.kind === 'empty') {
      return;
    }
    this.addEntry({ id: 0, kind: 'input', text: text.trim() });
    switch (command.kind) {
      case 'help': {
        this.addEntry({ id: 0, kind: 'note', tone: 'info', lines: chatHelp });
        return;
      }
      case 'question': {
        this.addEntry({
          id: 0,
          kind: 'note',
          tone: 'info',
          lines: [
            'Questions about the change arrive with the Q&A chat. For now the drawer runs commands: /review asks Claude Code for a preliminary review, /help lists the rest.',
          ],
        });
        return;
      }
      case 'invalid': {
        this.addEntry({ id: 0, kind: 'note', tone: 'error', lines: [command.message] });
        return;
      }
      case 'review': {
        void this.startReview(command);
        return;
      }
    }
  }

  private addEntry(entry: ChatEntry): number {
    const id = this.nextEntryId;
    this.nextEntryId += 1;
    this.transcript = [...this.transcript, { ...entry, id }];
    return id;
  }

  private updateEntry(id: number, update: (entry: ReviewChatEntry) => ReviewChatEntry): void {
    this.transcript = this.transcript.map((entry) =>
      entry.id === id && entry.kind === 'review' ? update(entry) : entry,
    );
  }

  private async startReview(command: Extract<ChatCommand, { kind: 'review' }>): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      this.addEntry({
        id: 0,
        kind: 'note',
        tone: 'error',
        lines: ['Open a review session first, then type /review.'],
      });
      return;
    }
    const sessionId = review.session.id;
    const id = this.addEntry({
      id: 0,
      kind: 'review',
      sessionId,
      status: 'requesting',
      citations: [],
    });
    const handle = await bridge.invoke('review:run', {
      sessionId,
      ...(command.pathPrefixes.length > 0 && { pathPrefixes: command.pathPrefixes }),
      ...(command.fresh && { fresh: true }),
      ...(command.effort !== undefined && { effort: command.effort }),
    });
    if (!handle.ok) {
      this.updateEntry(id, (entry) => ({
        ...entry,
        status: 'failed',
        error: { code: 'request-failed', message: handle.error.message },
      }));
      return;
    }
    const { value } = handle;
    if (value.status === 'reused') {
      this.updateEntry(id, (entry) => ({
        ...entry,
        runId: value.runId,
        status: 'completed',
        joined: 'reused',
        summary: value.summary,
      }));
      await this.refreshInsights(sessionId);
      return;
    }
    this.updateEntry(id, (entry) => ({
      ...entry,
      runId: value.runId,
      status: 'running',
      ...(value.status === 'attached' && { joined: 'attached' as const }),
    }));
    const latest = this.runEvents.get(value.runId);
    if (latest !== undefined) {
      this.applyReviewProgress(latest);
    }
  }

  private applyReviewProgress(event: ReviewProgressView): void {
    this.runEvents.set(event.runId, event);
    this.transcript = this.transcript.map((entry) =>
      entry.kind === 'review' ? advanceReviewEntry(entry, event) : entry,
    );
    if (event.kind === 'completed' || event.kind === 'failed') {
      void this.refreshInsights(event.sessionId);
    }
  }

  /** Reloads the open head's insights and the citations of every finished review entry. */
  private async refreshInsights(sessionId: string): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const listed = await bridge.invoke('review:list-insights', { sessionId });
    if (!listed.ok) {
      return;
    }
    const { review } = this;
    if (review?.session.id === sessionId && review.headSha === listed.value.headSha) {
      this.insights = listed.value.insights;
    }
    this.transcript = withCitations(this.transcript, listed.value.insights);
  }

  /**
   * `y`/`d` and the insight's buttons. Promoting stages the insight in the dock (main marks it
   * promoted in the same transaction); undoing a promotion, or dismissing a promoted insight,
   * withdraws its item first, which sets the insight back to pending.
   */
  private async setInsightStatus(insightId: string, status: InsightStatusView): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    const restatus = (insights: readonly AgentInsightView[]): AgentInsightView[] =>
      insights.map((insight) => (insight.id === insightId ? { ...insight, status } : insight));
    this.insights = restatus(this.insights);
    this.transcript = withCitations(this.transcript, this.insights);
    let isDone = true;
    if (status === 'promoted') {
      const promoted = await bridge.invoke('ura:promote-insight', { insightId });
      isDone = promoted.ok;
      this.noteFailure(promoted);
    } else {
      const staged = this.uraItems.find(
        (item) =>
          item.origin.kind === 'agent-insight' &&
          item.origin.insightId === insightId &&
          item.status.kind === 'staged',
      );
      if (staged !== undefined) {
        const withdrawn = await bridge.invoke('ura:transition', {
          itemId: staged.id,
          to: 'withdrawn',
        });
        this.noteFailure(withdrawn);
      }
      if (staged === undefined || status === 'dismissed') {
        const changed = await bridge.invoke('review:set-insight-status', { insightId, status });
        isDone = changed.ok;
      }
    }
    if (!isDone || status !== 'dismissed') {
      await this.refreshInsights(review.session.id);
    }
  }

  private async refreshUra(sessionId: string): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const listed = await bridge.invoke('ura:list', { sessionId });
    if (!listed.ok || this.review?.session.id !== sessionId) {
      return;
    }
    this.uraItems = listed.value.items;
    this.uraVerdict = listed.value.derivedVerdict;
    this.chosenVerdict = listed.value.chosenVerdict;
    this.verdictNotice = listed.value.verdictNotice ?? '';
  }

  private async createUraItem(request: UraCreateRequest): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      request.settle('No review session is open.');
      return;
    }
    const created = await bridge.invoke('ura:create', {
      sessionId: review.session.id,
      headSha: request.headSha,
      anchor: request.anchor,
      severity: request.draft.severity,
      title: request.draft.title,
      body: request.draft.body,
    });
    request.settle(created.ok ? undefined : created.error.message);
    if (created.ok) {
      this.dockNotice = { tone: 'info', text: `Staged “${created.value.title}”.` };
    }
  }

  private async transitionUraItem(
    itemId: string,
    to: 'staged' | 'withdrawn' | 'addressed',
  ): Promise<void> {
    await this.uraCall(async (bridge) => bridge.invoke('ura:transition', { itemId, to }));
    const item = this.uraItems.find((entry) => entry.id === itemId);
    if (item?.origin.kind === 'agent-insight' && this.review !== undefined) {
      await this.refreshInsights(this.review.session.id);
    }
  }

  /** Runs a dock call; `ura:changed` refreshes the list, and failures show in the dock. */
  private async uraCall(
    call: (bridge: NonNullable<ReturnType<typeof beuveBridge>>) => Promise<IpcResult<unknown>>,
  ): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const result = await call(bridge);
    this.noteFailure(result);
    if (!result.ok && this.review !== undefined) {
      await this.refreshUra(this.review.session.id);
    }
  }

  private noteFailure(result: IpcResult<unknown>): void {
    if (!result.ok) {
      this.dockNotice = { tone: 'error', text: result.error.message };
    }
  }

  /** Compiles the review in main and copies it with main's clipboard (ADR 0027). */
  private async exportUra(target: UraExportTarget): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined || this.exporting) {
      return;
    }
    this.exporting = true;
    const compiled = await bridge.invoke('ura:export', {
      sessionId: review.session.id,
      target,
    });
    if (!compiled.ok) {
      this.exporting = false;
      this.dockNotice = { tone: 'error', text: compiled.error.message };
      return;
    }
    const copied = await bridge.invoke('clipboard:write-text', { text: compiled.value.text });
    this.exporting = false;
    const { itemCount, outdatedCount } = compiled.value;
    const outdated = outdatedCount === 0 ? '' : `, ${String(outdatedCount)} outdated`;
    this.dockNotice = copied.ok
      ? {
          tone: 'info',
          text: `Copied ${exportLabels[target]}: ${String(itemCount)} ${itemCount === 1 ? 'item' : 'items'}${outdated}, ${formatBytes(compiled.value.text.length)}.`,
        }
      : { tone: 'error', text: `Could not copy: ${copied.error.message}` };
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || isEditable(event)) {
      return;
    }
    if (this.overlayOpen) {
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault();
        this.overlayOpen = false;
      }
      return;
    }
    switch (event.key) {
      case 'Tab': {
        event.preventDefault();
        this.focusedZone = cycleZone(this.zoneOrder(), this.focusedZone, event.shiftKey ? -1 : 1);
        return;
      }
      case '?': {
        event.preventDefault();
        this.overlayOpen = true;
        return;
      }
      case 'c': {
        event.preventDefault();
        this.toggleChat();
        return;
      }
      case 'f': {
        event.preventDefault();
        this.treeMode = this.treeMode === 'diff-only' ? 'neighborhood' : 'diff-only';
        return;
      }
      default: {
        return;
      }
    }
  }

  private zoneOrder(): ZoneId[] {
    return zones.map(({ id }) => id).filter((id) => id !== 'chat' || this.chatOpen);
  }

  /** `c`: opens the drawer, or focuses its input if it is open elsewhere; closes it from the drawer. */
  private toggleChat(): void {
    const isClosing = this.chatOpen && this.focusedZone === 'chat';
    this.chatOpen = !isClosing;
    this.focusedZone = isClosing ? 'diff' : 'chat';
  }

  private sessionLabel(): string {
    const session = this.sessions.find(({ id }) => id === this.selectedId);
    if (session === undefined) {
      return 'No session';
    }
    const { source } = session;
    const head = source.kind === 'local' ? source.headRef : `#${String(source.number)}`;
    return `${source.repoPath} · ${source.baseRef} ← ${head}`;
  }

  override render(): TemplateResult {
    return html`
      <div class="titlebar">
        <span class="brand">beuve</span>
        <span class="session">${this.sessionLabel()}</span>
      </div>
      <beuve-intent-sidebar
        data-zone="intent"
        tabindex="-1"
        ?focused=${this.focusedZone === 'intent'}
        .sessions=${this.sessions}
        .selectedId=${this.selectedId}
        .sessionNote=${this.sessionNote}
        ?opening=${this.opening}
        .openError=${this.openError}
        .files=${this.review?.files}
        .tree=${this.tree}
        .impact=${this.impact}
        .treeMode=${this.treeMode}
        @beuve-open-repository=${this.onOpenRepository}
        @beuve-select-session=${this.onSelectSession}
        @beuve-tree-select=${this.onTreeSelect}
      ></beuve-intent-sidebar>
      <beuve-diff-stream
        data-zone="diff"
        tabindex="-1"
        ?focused=${this.focusedZone === 'diff'}
        .sessionNote=${this.sessionNote}
        .review=${this.review}
        ?loading=${this.reviewLoading}
        ?marking=${this.marking}
        .error=${this.reviewError}
        .impact=${this.impact}
        .peek=${this.peek}
        .insights=${this.insights}
        .insightJump=${this.insightJump}
        .fileJump=${this.fileJump}
        .loadFilePair=${this.loadFilePair}
        .uraItems=${this.uraItems}
        @beuve-mark-reviewed=${this.onMarkReviewed}
        @beuve-insight-status=${this.onInsightStatus}
        @beuve-peek-request=${this.onPeekRequest}
        @beuve-peek-expand=${this.onPeekExpand}
        @beuve-peek-close=${this.onPeekClose}
        @beuve-diff-rendered=${this.onDiffRendered}
        @beuve-ura-create=${this.onUraCreate}
        @beuve-ura-stage-finding=${this.onStageFinding}
      ></beuve-diff-stream>
      <beuve-ura-dock
        data-zone="ura"
        tabindex="-1"
        ?focused=${this.focusedZone === 'ura'}
        ?hasSession=${this.review !== undefined}
        .items=${this.uraItems}
        .derivedVerdict=${this.uraVerdict}
        .chosenVerdict=${this.chosenVerdict}
        .verdictNotice=${this.verdictNotice}
        .notice=${this.dockNotice}
        ?exporting=${this.exporting}
        @beuve-ura-jump=${this.onUraJump}
        @beuve-ura-update=${this.onUraUpdate}
        @beuve-ura-transition=${this.onUraTransition}
        @beuve-ura-reorder=${this.onUraReorder}
        @beuve-ura-export=${this.onUraExport}
        @beuve-ura-set-verdict=${this.onUraSetVerdict}
      ></beuve-ura-dock>
      ${
        this.chatOpen
          ? html`<beuve-chat-drawer
              data-zone="chat"
              tabindex="-1"
              ?focused=${this.focusedZone === 'chat'}
              .transcript=${this.transcript}
              ?hasSession=${this.review !== undefined}
              @beuve-chat-submit=${this.onChatSubmit}
              @beuve-chat-escape=${this.onChatEscape}
              @beuve-citation=${this.onCitation}
            ></beuve-chat-drawer>`
          : nothing
      }
      <beuve-status-bar
        .zoneLabel=${zones.find(({ id }) => id === this.focusedZone)?.label ?? ''}
        .mcpStatus=${this.mcpStatus}
        .appInfo=${this.appInfo}
      ></beuve-status-bar>
      ${this.overlayOpen ? html`<beuve-keybinding-overlay></beuve-keybinding-overlay>` : nothing}
    `;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has('focusedZone') && !changed.has('chatOpen')) {
      return;
    }
    const selector = `[data-zone='${CSS.escape(this.focusedZone)}']`;
    const element = this.renderRoot.querySelector<HTMLElement>(selector);
    if (element !== null && !element.matches(':focus-within')) {
      element.focus();
    }
  }
}

function toPeekState(path: string, line: number, answer: IpcResult<CallHierarchyView>): PeekState {
  if (!answer.ok) {
    return { path, line, status: 'error', message: answer.error.message };
  }
  const { root, calls } = answer.value;
  return root === undefined
    ? { path, line, status: 'error', message: 'The language server found nothing callable here.' }
    : {
        path,
        line,
        status: 'ready',
        root,
        children: new Map([[root.id, { status: 'ready', calls }]]),
      };
}

/** Gives every finished review entry pills for its run's insights, with their current status. */
function withCitations(
  transcript: readonly ChatEntry[],
  insights: readonly AgentInsightView[],
): ChatEntry[] {
  return transcript.map((entry) => {
    const runId = entry.kind === 'review' ? entry.summary?.reviewRunId : undefined;
    if (runId === undefined || entry.kind !== 'review') {
      return entry;
    }
    const cited = insights.filter((insight) => insight.runId === runId);
    if (cited.length === 0) {
      return entry;
    }
    const citations = cited.map((insight): ChatCitation => ({
      insightId: insight.id,
      path: insight.path,
      line: insight.lineStart,
      title: insight.title,
      severity: insight.severity,
      status: insight.status,
    }));
    return { ...entry, citations };
  });
}

const exportLabels: Readonly<Record<UraExportTarget, string>> = {
  'agent-xml': 'the review for Claude Code as XML',
  'agent-json': 'the review for agents as JSON',
  github: 'the GitHub review JSON',
  markdown: 'the review as Markdown',
};

function formatBytes(characters: number): string {
  return characters < 1024
    ? `${String(characters)} characters`
    : `${(characters / 1024).toFixed(1)} K characters`;
}

function isEditable(event: KeyboardEvent): boolean {
  const [target] = event.composedPath();
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-app': BeuveApp;
  }
}
