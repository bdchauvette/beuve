import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import type {
  AgentInsightView,
  AppInfo,
  CallHierarchyView,
  ChatCitationView,
  ChatDeltaView,
  ChatMentionView,
  CiStatusView,
  CreateLocalSessionRequest,
  DiffDisplayView,
  EditorId,
  EditorSettingsView,
  FilePairView,
  FlowFailureKind,
  FlowGraphResponse,
  GithubAuthStatusView,
  TraceStatusView,
  ImpactView,
  InsightStatusView,
  IpcResult,
  McpStatus,
  OpenPullRequestRequest,
  PullRequestSessionView,
  PullRequestUpdatedView,
  RepositoryTreeView,
  DiffFileView,
  FileAttributesView,
  ReviewProgressView,
  ReviewView,
  SessionSummary,
  SetDiffDisplayRequest,
  SidebarSideView,
  UraExportTarget,
  UraItemView,
  UraSeverityView,
  UraVerdictView,
} from '#contract/ipc-contract.ts';

import './beuve-chat-drawer.ts';
import './beuve-command-palette.ts';
import './beuve-open-panel.ts';
import './beuve-diff-stream.ts';
import './beuve-intent-sidebar.ts';
import './beuve-keybinding-overlay.ts';
import './beuve-status-bar.ts';
import './beuve-ura-dock.ts';
import { advanceReviewEntry } from './advance-review-entry.ts';
import { planDiffDeferrals } from './plan-diff-deferrals.ts';
import type { DiffDeferral } from './plan-diff-deferrals.ts';
import { beuveBridge } from './beuve-bridge.ts';
import type { BeuveChatDrawer } from './beuve-chat-drawer.ts';
import type { BeuveCommandPalette } from './beuve-command-palette.ts';
import type { BeuveDiffStream } from './beuve-diff-stream.ts';
import type { BeuveIntentSidebar } from './beuve-intent-sidebar.ts';
import type { BeuveUraDock } from './beuve-ura-dock.ts';
import type { MentionTarget } from './chat-draft.ts';
import type {
  BeuveOpenPanel,
  FolderChooser,
  OpenFailure,
  RepositoryInspector,
} from './beuve-open-panel.ts';
import { commandRegistry } from './command-registry.ts';
import type { AppAction, CommandDefinition } from './command-registry.ts';
import type { PaletteAction, PaletteSources } from './plan-palette.ts';
import type {
  FileJump,
  InsightJump,
  SuggestionJump,
  UraCreateRequest,
} from './beuve-diff-stream.ts';
import type { FilePairLoader } from './beuve-file-card.ts';
import type { DockNotice } from './beuve-ura-dock.ts';
import type {
  ChatCitation,
  ChatEntry,
  ChatTranscript,
  LocalChatEntry,
  ReviewChatEntry,
} from './chat-entry.ts';
import { chatHelp } from './chat-help.ts';
import { currentEditorName } from './current-editor-name.ts';
import { describeDiffDisplay } from './describe-diff-display.ts';
import { describeEditorOpen } from './describe-editor-open.ts';
import { displayKey } from './display-key.ts';
import { describeEditorSettings } from './describe-editor-settings.ts';
import { describeSessionLabel } from './describe-session-label.ts';
import type { StatusNotice } from './describe-editor-open.ts';
import { cycleZone } from './cycle-zone.ts';
import { parseChatCommand } from './parse-chat-command.ts';
import { planChatStage } from './plan-chat-stage.ts';
import { emptyChatTranscript } from './empty-chat-transcript.ts';
import { reduceChatTranscript } from './reduce-chat-transcript.ts';
import type { ChatTranscriptAction } from './reduce-chat-transcript.ts';
import type { ChatCommand } from './parse-chat-command.ts';
import type { FlowState } from './flow-state.ts';
import { describeReviewPreview } from './describe-review-preview.ts';
import type { GithubDockState, GithubPostState } from './github-post-state.ts';
import type { PeekChildren, PeekState } from './peek-state.ts';
import { applyTraceStatus } from './apply-trace-status.ts';
import { formatDuration } from './format-duration.ts';
import type { TraceState } from './trace-state.ts';
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
      grid-template-rows: var(--beuve-titlebar-height) minmax(0, 1fr) var(--beuve-statusbar-height);
    }

    .titlebar {
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

    .titlebar button {
      min-width: 0;
      padding: 2px var(--beuve-space-2);
      overflow: hidden;
      border: 1px solid transparent;
      border-radius: var(--beuve-radius);
      background: none;
      color: var(--beuve-text-muted);
      font: inherit;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }

    .titlebar button:hover {
      border-color: var(--beuve-border);
      color: var(--beuve-text);
    }

    .titlebar .spacer {
      flex: 1;
    }

    .titlebar kbd {
      font: var(--beuve-font-mono);
      font-size: 11px;
    }

    .workspace {
      display: grid;
      min-height: 0;
      grid-template-columns: minmax(0, 1fr) var(--beuve-sidebar-width);
      grid-template-areas: 'main side';
    }

    .workspace.left {
      grid-template-columns: var(--beuve-sidebar-width) minmax(0, 1fr);
      grid-template-areas: 'side main';
    }

    .workspace.solo {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'main';
    }

    .main {
      grid-area: main;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }

    .main > beuve-diff-stream,
    .main > .empty {
      flex: 1;
      min-height: 0;
    }

    .empty {
      position: relative;
      display: flex;
      justify-content: center;
      overflow: auto;
      padding: 14vh var(--beuve-space-6) var(--beuve-space-6);
      background: var(--beuve-bg);
      outline: none;
    }

    .empty > div {
      width: min(620px, 100%);
    }

    .empty h1 {
      margin: 0 0 var(--beuve-space-1);
      font-size: 17px;
      font-weight: 600;
    }

    .empty p {
      margin: 0 0 var(--beuve-space-4);
      color: var(--beuve-text-muted);
    }

    .sidebar {
      grid-area: side;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      border-left: 1px solid var(--beuve-border);
      background: var(--beuve-surface);
    }

    .workspace.left .sidebar {
      border-right: 1px solid var(--beuve-border);
      border-left: none;
    }

    .sidebar > * {
      border: none;
    }

    .sidebar > [hidden] {
      display: none;
    }

    .sidebar > beuve-intent-sidebar,
    .sidebar > beuve-ura-dock,
    .sidebar > beuve-chat-drawer {
      flex: 1;
      min-height: 0;
    }

    /* Intent & files, Review and Chat as three quiet tabs. */
    .tabs {
      display: flex;
      flex: none;
      gap: var(--beuve-space-4);
      height: 30px;
      padding: 0 var(--beuve-space-3);
      border-bottom: 1px solid var(--beuve-border);
    }

    .tabs button {
      padding: 0;
      border: none;
      background: none;
      color: var(--beuve-text-muted);
      font: var(--beuve-font-small);
      box-shadow: inset 0 -2px 0 transparent;
      cursor: pointer;
    }

    .tabs button[aria-selected='true'] {
      color: var(--beuve-text);
      box-shadow: inset 0 -2px 0 var(--beuve-border);
    }

    .tabs .count {
      margin-left: 3px;
      color: var(--beuve-text-muted);
    }

    .scrim {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 12vh;
      background: var(--beuve-scrim-soft);
    }

    .dialog {
      width: min(640px, calc(100vw - 48px));
      box-sizing: border-box;
      padding: var(--beuve-space-4);
      border: 1px solid var(--beuve-border);
      border-radius: 10px;
      background: var(--beuve-surface);
      box-shadow: 0 16px 48px #00000040;
    }
  `;

  private unsubscribes: (() => void)[] = [];
  private nextEntryId = 1;
  /** The file the diff stream's cursor is on, sent as the question's focus. */
  private activePath: string | undefined;
  private jumpNonce = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
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

  private readonly onOpenPullRequest = (event: CustomEvent<OpenPullRequestRequest>): void => {
    void this.openPullRequest(event.detail);
  };

  /** A stack chip: the neighbour lives in the same repository, so it uses the same clone. */
  private readonly onOpenStack = (event: CustomEvent<{ ref: string }>): void => {
    const source = this.review?.session.source;
    void this.openPullRequest({
      ref: event.detail.ref,
      ...(source !== undefined && { repoPath: source.repoPath }),
    });
  };

  private readonly onOpenLink = (event: CustomEvent<{ url: string }>): void => {
    void this.openLink(event.detail.url);
  };

  private readonly onGithubPreview = (): void => {
    void this.previewGithubReview();
  };

  private readonly onGithubPost = (
    event: CustomEvent<{ verdict?: UraVerdictView | undefined }>,
  ): void => {
    void this.postGithubReview(event.detail.verdict);
  };

  private readonly onGithubCancel = (): void => {
    this.githubPost = { kind: 'idle' };
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

  private readonly onFlowRequest = (
    event: CustomEvent<{ path: string; line: number | undefined }>,
  ): void => {
    void this.openFlow(event.detail.path, event.detail.line);
  };

  private readonly onFlowClose = (): void => {
    this.flow = undefined;
  };

  private readonly onTraceRequest = (
    event: CustomEvent<{ path: string; line: number | undefined }>,
  ): void => {
    void this.openTrace(event.detail.path, event.detail.line);
  };

  private readonly onTraceClose = (): void => {
    this.closeTrace();
  };

  private readonly onTraceTrust = (): void => {
    void this.trustAndRunTrace();
  };

  private readonly onChatSubmit = (
    event: CustomEvent<{ text: string; mentions?: readonly ChatMentionView[] }>,
  ): void => {
    this.submitChat(event.detail.text, event.detail.mentions ?? []);
  };

  /** A context chip, in the input or the transcript: show its lines in the diff. */
  private readonly onChatMention = (event: CustomEvent<{ mention: ChatMentionView }>): void => {
    this.openMention(event.detail.mention);
  };

  /** The gutter's chat button on a diff card. */
  private readonly onChatAdd = (event: CustomEvent<{ target: MentionTarget }>): void => {
    void this.addToChat(event.detail.target);
  };

  private readonly onChatCancelCompaction = (): void => {
    const { review } = this;
    if (review !== undefined) {
      void beuveBridge()?.invoke('chat:cancel', { sessionId: review.session.id });
    }
  };

  private readonly onChatEscape = (): void => {
    this.focusedZone = 'diff';
  };

  /** Tab typed in the chat input (the shell ignores keys typed in inputs). */
  private readonly onChatCycle = (event: CustomEvent<{ step: 1 | -1 }>): void => {
    this.focusedZone = cycleZone(this.zoneOrder(), 'chat', event.detail.step);
  };

  private readonly onChatCancel = (event: CustomEvent<{ messageId: string }>): void => {
    void beuveBridge()?.invoke('chat:cancel', { messageId: event.detail.messageId });
  };

  private readonly onChatStage = (event: CustomEvent<{ messageId: string }>): void => {
    void this.stageChatAnswer(event.detail.messageId);
  };

  private readonly onChatCite = (event: CustomEvent<{ citation: ChatCitationView }>): void => {
    this.openCitation(event.detail.citation);
  };

  private readonly onOpenEditor = (event: CustomEvent<{ path: string; line: number }>): void => {
    void this.openInEditor(event.detail.path, event.detail.line);
  };

  private readonly onActiveFile = (event: CustomEvent<{ path: string | undefined }>): void => {
    this.activePath = event.detail.path;
  };

  private readonly onCitation = (event: CustomEvent<{ insightId: string }>): void => {
    this.jumpNonce += 1;
    this.insightJump = { insightId: event.detail.insightId, nonce: this.jumpNonce };
    this.focusedZone = 'diff';
  };

  /** Sessions whose chat already suggested /compact in this window. */
  private readonly compactHinted = new Set<string>();

  /** Resolves the wait in {@link loadImpactAfterFirstDiff}; set while it waits. */
  private releaseImpact: (() => void) | undefined;

  private readonly onDiffRendered = (): void => {
    this.releaseImpact?.();
  };

  private readonly onTreeSelect = (event: CustomEvent<{ path: string }>): void => {
    this.jumpNonce += 1;
    this.fileJump = { path: event.detail.path, nonce: this.jumpNonce };
  };

  /** {@link planDiffDeferrals} for the review and its attributes, recomputed when either changes. */
  private deferralPlan: {
    readonly files: readonly DiffFileView[] | undefined;
    readonly attributes: FileAttributesView | undefined;
    readonly deferrals: ReadonlyMap<string, DiffDeferral>;
    readonly generated: ReadonlySet<string>;
  } = { files: undefined, attributes: undefined, deferrals: new Map(), generated: new Set() };

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
    event: CustomEvent<{
      itemId: string;
      title?: string;
      body?: string;
      severity?: UraSeverityView;
      suggestedPatch?: string;
    }>,
  ): void => {
    void this.uraCall(async (bridge) => bridge.invoke('ura:update', event.detail));
  };

  /** The dock's "Edit suggestion": the stream opens `e` on the item's lines (ADR 0043). */
  private readonly onUraEditSuggestion = (event: CustomEvent<{ itemId: string }>): void => {
    this.jumpNonce += 1;
    this.suggestionJump = { itemId: event.detail.itemId, nonce: this.jumpNonce };
    this.focusedZone = 'diff';
  };

  private readonly onStatusNotice = (event: CustomEvent<StatusNotice>): void => {
    this.showNotice(event.detail);
  };

  /** `s`/`w` in the stream: store the preference, and refetch the diff if whitespace changed. */
  private readonly onDisplayChange = (event: CustomEvent<SetDiffDisplayRequest>): void => {
    void this.setDisplay(event.detail);
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

  private readonly onPaletteRun = (event: CustomEvent<{ action: PaletteAction }>): void => {
    this.paletteText = undefined;
    void this.runPaletteAction(event.detail.action);
  };

  private readonly onPaletteClose = (): void => {
    this.closePalette();
  };

  private readonly onOpenClose = (): void => {
    this.closeOpenDialog();
  };

  private readonly chooseFolder: FolderChooser = async (
    defaultPath: string | undefined,
  ): Promise<string | undefined> => {
    const chosen = await beuveBridge()?.invoke('dialog:choose-folder', {
      ...(defaultPath !== undefined && { defaultPath }),
    });
    return chosen?.ok === true && chosen.value.kind === 'chosen' ? chosen.value.path : undefined;
  };

  private readonly inspectRepository: RepositoryInspector = async (path) =>
    (await beuveBridge()?.invoke('repository:inspect', { path })) ?? {
      ok: false,
      error: { code: 'not-wired', message: 'no Electron bridge' },
    };

  @state() accessor focusedZone: ZoneId = 'diff';
  @state() accessor overlayOpen = false;
  @state() accessor statusNotice: StatusNotice | undefined;
  @state() accessor editorSettings: EditorSettingsView | undefined;
  /** Split or inline, and whether whitespace is ignored (ADR 0042); main stores it. */
  @state() accessor display: DiffDisplayView = {
    layout: 'split',
    ignoreWhitespace: false,
    sidebarSide: 'right',
    showGenerated: false,
  };
  /** `.gitattributes` for the review's files (ADR 0052), once `session:get-file-attributes` answers. */
  @state() accessor fileAttributes: FileAttributesView | undefined;
  @state() accessor suggestionJump: SuggestionJump | undefined;
  @state() accessor appInfo: AppInfo | undefined;
  @state() accessor mcpStatus: McpStatus | undefined;
  @state() accessor sessionNote = 'Loading sessions…';
  @state() accessor sessions: readonly SessionSummary[] = [];
  @state() accessor selectedId = '';
  @state() accessor review: ReviewView | undefined;
  @state() accessor impact: ImpactView | undefined;
  @state() accessor peek: PeekState | undefined;
  /** The control-flow portal; at most one of `peek` and `flow` is open at a time. */
  @state() accessor flow: FlowState | undefined;
  /** The trace timeline portal; at most one of `peek`, `flow` and `trace` is open at a time. */
  @state() accessor trace: TraceState | undefined;
  @state() accessor reviewLoading = false;
  @state() accessor reviewError = '';
  @state() accessor marking = false;
  @state() accessor opening = false;
  @state() accessor localFailure: OpenFailure | undefined;
  @state() accessor chat: ChatTranscript = emptyChatTranscript;
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
  /** The open pull request session's metadata and stack; absent for local sessions. */
  @state() accessor pullRequest: PullRequestSessionView | undefined;
  @state() accessor ci: CiStatusView | undefined;
  @state() accessor githubAuth: GithubAuthStatusView | undefined;
  @state() accessor openingPull = false;
  @state() accessor pullFailure: OpenFailure | undefined;
  /** Which side the sidebar sits on (ADR 0044); main keeps it in `settings.json`. */
  @state() accessor sidebarSide: SidebarSideView = 'right';
  @state() accessor sidebarHidden = false;
  /** The sidebar tab on show: intent and files, the review or the chat. */
  @state() accessor sidebarTab: SidebarZone = 'intent';
  @state() accessor openDialog = false;
  /** The palette's starting text while it is open. */
  @state() accessor paletteText: string | undefined;
  @state() accessor githubPost: GithubPostState = { kind: 'idle' };

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
      bridge.on('chat:delta', (delta) => {
        this.applyChatDelta(delta);
      }),
      bridge.on('chat:message-updated', ({ message, droppedTurns }) => {
        if (message.sessionId !== this.review?.session.id) {
          return;
        }
        this.dispatchChat({ kind: 'updated', message });
        if (droppedTurns === undefined || this.compactHinted.has(message.sessionId)) {
          return;
        }
        this.compactHinted.add(message.sessionId);
        this.note('info', 'Older turns are being dropped — /compact to keep a summary.');
      }),
      bridge.on('ura:changed', ({ sessionId }) => {
        if (sessionId === this.review?.session.id) {
          void this.refreshUra(sessionId);
        }
      }),
      bridge.on('trace:status', (event) => {
        this.applyTraceEvent(event);
      }),
      bridge.on('github:pr-updated', (event) => {
        this.applyPullRequestUpdate(event);
      }),
      bridge.on('github:ci-status', ({ sessionId, ci }) => {
        if (sessionId === this.review?.session.id) {
          this.ci = ci;
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
    clearTimeout(this.noticeTimer);
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
    const editors = await bridge.invoke('editor:get-settings');
    this.editorSettings = editors.ok ? editors.value : undefined;
    const display = await bridge.invoke('display:get');
    if (display.ok) {
      this.applyDisplay(display.value);
    }
    await this.loadGithubAuth(undefined);
  }

  /** Who beuve posts to GitHub as; `host` defaults to the open pull request's. */
  private async loadGithubAuth(host: string | undefined): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const auth = await bridge.invoke('github:auth-status', host === undefined ? {} : { host });
    if (auth.ok) {
      this.githubAuth = auth.value;
    }
  }

  private async openPullRequest(request: OpenPullRequestRequest): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined || this.openingPull) {
      return;
    }
    this.openingPull = true;
    this.pullFailure = undefined;
    const opened = await bridge.invoke('github:open-pr', request);
    this.openingPull = false;
    if (!opened.ok) {
      this.pullFailure = { message: opened.error.message };
      this.openDialog = this.review !== undefined;
      return;
    }
    if (opened.value.kind === 'failed') {
      const { message, remedy } = opened.value;
      this.pullFailure = {
        message,
        ...(remedy !== undefined && !message.includes(remedy) && { remedy }),
      };
      this.openDialog = this.review !== undefined;
      return;
    }
    this.openDialog = false;
    await this.refreshSessions();
    await this.selectSession(opened.value.session.id);
  }

  /** Main opens GitHub links in the browser and refuses anything else (ADR 0040). */
  private async openLink(url: string): Promise<void> {
    const opened = await beuveBridge()?.invoke('github:open-link', { url });
    if (opened !== undefined && !opened.ok) {
      this.showNotice({ tone: 'error', text: opened.error.message });
    }
  }

  private async loadPullRequest(sessionId: string): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const loaded = await bridge.invoke('github:get-pr', { sessionId });
    if (this.review?.session.id !== sessionId) {
      return;
    }
    if (loaded.ok) {
      this.pullRequest = loaded.value;
      this.ci = loaded.value.ci ?? this.ci;
      if (this.githubAuth?.host !== loaded.value.pullRequest.host) {
        void this.loadGithubAuth(loaded.value.pullRequest.host);
      }
    } else {
      this.showNotice({ tone: 'error', text: loaded.error.message });
    }
  }

  /** Polling found a change; a new head reloads the review, which then offers the interdiff. */
  private applyPullRequestUpdate(event: PullRequestUpdatedView): void {
    void this.refreshSessions();
    const { review } = this;
    if (event.sessionId !== review?.session.id) {
      return;
    }
    this.pullRequest = {
      sessionId: event.sessionId,
      pullRequest: event.pullRequest,
      stack: event.stack,
      ...(this.ci !== undefined && { ci: this.ci }),
    };
    if (!event.headMoved) {
      return;
    }
    this.showNotice({
      tone: 'info',
      text: `New commits on #${String(event.pullRequest.number)}; the review now shows what changed.`,
    });
    void this.selectSession(event.sessionId);
  }

  /** The confirmation step: main compiles the review and says what goes inline and in the body. */
  private async previewGithubReview(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    this.githubPost = { kind: 'busy', text: 'Compiling the review…' };
    const preview = await bridge.invoke('github:preview-review', { sessionId: review.session.id });
    if (!preview.ok) {
      this.githubPost = { kind: 'failed', text: preview.error.message };
      return;
    }
    this.githubPost =
      'kind' in preview.value
        ? { kind: 'failed', text: preview.value.message }
        : { kind: 'confirm', preview: preview.value };
  }

  private async postGithubReview(verdict: UraVerdictView | undefined): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    this.githubPost = { kind: 'busy', text: 'Posting to GitHub…' };
    const posted = await bridge.invoke('github:post-review', {
      sessionId: review.session.id,
      ...(verdict !== undefined && { verdict }),
    });
    if (!posted.ok) {
      this.githubPost = { kind: 'failed', text: posted.error.message };
      return;
    }
    const result = posted.value;
    if (result.kind === 'failed') {
      this.githubPost =
        result.failure === 'own-pull-request'
          ? { kind: 'own-pull-request', message: result.message }
          : { kind: 'failed', text: result.message };
      return;
    }
    const moved =
      result.movedToBody === 0
        ? ''
        : ` GitHub refused ${String(result.movedToBody)} inline, so they went into the body.`;
    this.githubPost = {
      kind: 'posted',
      url: result.url,
      text: `Posted: ${describeReviewPreview(result)}${moved}`,
    };
  }

  private showNotice(notice: StatusNotice): void {
    this.statusNotice = notice;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.statusNotice = undefined;
    }, 8000);
  }

  /** `o`: opens the head-side file in the reviewer's editor (ADR 0033). */
  private async openInEditor(path: string, line: number): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    const opened = await bridge.invoke('editor:open', { sessionId: review.session.id, path, line });
    this.showNotice(
      opened.ok ? describeEditorOpen(opened.value) : { tone: 'error', text: opened.error.message },
    );
  }

  private applyDisplay(display: DiffDisplayView): void {
    const isWhitespaceChanged = display.ignoreWhitespace !== this.display.ignoreWhitespace;
    this.display = display;
    this.sidebarSide = display.sidebarSide;
    if (isWhitespaceChanged && this.selectedId !== '') {
      void this.selectSession(this.selectedId);
    }
  }

  /** Stores a display change; `/diff` and `/whitespace` without arguments only show it. */
  private async setDisplay(change: SetDiffDisplayRequest): Promise<DiffDisplayView | undefined> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return undefined;
    }
    const isQuery = Object.keys(change).length === 0;
    const result = isQuery
      ? await bridge.invoke('display:get')
      : await bridge.invoke('display:set', change);
    if (!result.ok) {
      this.showNotice({ tone: 'error', text: result.error.message });
      return undefined;
    }
    this.applyDisplay(result.value);
    if (change.showGenerated !== undefined) {
      this.showNotice({ tone: 'info', text: describeGenerated(result.value.showGenerated) });
    }
    if (change.layout !== undefined || change.ignoreWhitespace !== undefined) {
      this.showNotice({
        tone: 'info',
        text: `Diffs: ${describeDiffDisplay(result.value, false).text}`,
      });
    }
    return result.value;
  }

  private async runDisplayCommand(change: SetDiffDisplayRequest): Promise<void> {
    const display = await this.setDisplay(change);
    if (display !== undefined) {
      this.note('info', `Diffs: ${describeDiffDisplay(display, false).text}.`);
    }
  }

  /** `/editor [id]`: shows or sets the editor `o` opens. */
  private async runEditorCommand(editorId: EditorId | undefined): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const result =
      editorId === undefined
        ? await bridge.invoke('editor:get-settings')
        : await bridge.invoke('editor:set-preferred', { editorId });
    if (!result.ok) {
      this.note('error', result.error.message);
      return;
    }
    this.editorSettings = result.value;
    this.note('info', ...describeEditorSettings(result.value));
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
    this.localFailure = undefined;
    const created = await bridge.invoke('session:create-local', request);
    this.opening = false;
    if (!created.ok) {
      this.localFailure = { message: created.error.message };
      return;
    }
    this.openDialog = false;
    await this.refreshSessions();
    await this.selectSession(created.value.id);
  }

  private async selectSession(sessionId: string): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    this.openDialog = false;
    if (sessionId !== this.selectedId) {
      this.review = undefined;
      this.insights = [];
      this.tree = undefined;
      this.fileAttributes = undefined;
      this.uraItems = [];
      this.chosenVerdict = undefined;
      this.verdictNotice = '';
      this.dockNotice = undefined;
      this.chat = emptyChatTranscript;
      this.pullRequest = undefined;
      this.ci = undefined;
      this.githubPost = { kind: 'idle' };
    }
    this.selectedId = sessionId;
    this.reviewLoading = true;
    this.reviewError = '';
    const review = await bridge.invoke('session:get-review', {
      sessionId,
      ignoreWhitespace: this.display.ignoreWhitespace,
    });
    if (sessionId !== this.selectedId) {
      return;
    }
    this.reviewLoading = false;
    this.peek = undefined;
    this.flow = undefined;
    this.closeTrace();
    if (review.ok) {
      if (this.review?.headSha !== review.value.headSha) {
        this.insights = [];
      }
      this.review = review.value;
      this.focusedZone = 'diff';
      if (this.sessions.every(({ id }) => id !== sessionId)) {
        void this.refreshSessions();
      }
      void this.loadImpactAfterFirstDiff(review.value);
      void this.loadTree(review.value);
      void this.loadFileAttributes(review.value);
      void this.refreshInsights(review.value.session.id);
      void this.refreshUra(review.value.session.id);
      void this.loadChat(review.value.session.id);
      if (review.value.session.source.kind === 'github-pull-request') {
        void this.loadPullRequest(review.value.session.id);
      }
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

  private reviewDeferrals(): typeof this.deferralPlan {
    const files = this.review?.files;
    const attributes =
      this.fileAttributes?.headSha === this.review?.headSha ? this.fileAttributes : undefined;
    if (this.deferralPlan.files === files && this.deferralPlan.attributes === attributes) {
      return this.deferralPlan;
    }
    const deferrals = planDiffDeferrals(files ?? [], attributes);
    const generated = new Set(
      [...deferrals]
        .filter(([, deferral]) => deferral.reason === 'generated' || deferral.reason === 'no-diff')
        .map(([path]) => path),
    );
    this.deferralPlan = { files, attributes, deferrals, generated };
    return this.deferralPlan;
  }

  /** Which review files `.gitattributes` marks generated or `-diff` (ADR 0052). */
  private async loadFileAttributes(review: ReviewView): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const attributes = await bridge.invoke('session:get-file-attributes', {
      sessionId: review.session.id,
    });
    if (this.review === review && attributes.ok) {
      this.fileAttributes = attributes.value;
    }
  }

  private async openPeek(path: string, line: number | undefined): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    this.flow = undefined;
    this.closeTrace();
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

  private async openFlow(path: string, line: number | undefined): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    this.peek = undefined;
    this.closeTrace();
    if (line === undefined) {
      this.flow = {
        path,
        line,
        status: 'error',
        message: 'This file has no head-side change to draw a flow for.',
      };
      return;
    }
    const pending: FlowState = { path, line, status: 'loading' };
    this.flow = pending;
    const answer = await bridge.invoke('flow:get-graph', {
      sessionId: review.session.id,
      path,
      line,
    });
    if (this.flow !== pending || this.review !== review) {
      return;
    }
    this.flow = toFlowState(path, line, answer);
  }

  /** `r`: runs the tests covering the hunk with tracing; the portal follows `trace:status`. */
  private async openTrace(path: string, line: number | undefined): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    this.peek = undefined;
    this.flow = undefined;
    this.closeTrace();
    if (line === undefined) {
      this.trace = {
        path,
        line,
        status: 'error',
        failure: 'local',
        message: 'This file has no head-side change to trace.',
      };
      return;
    }
    const pending: TraceState = { path, line, status: 'loading', testFiles: undefined };
    this.trace = pending;
    const started = await bridge.invoke('trace:run', {
      sessionId: review.session.id,
      path,
      line,
    });
    // Status events may already have replaced `pending`; only a refusal is left to report.
    if (!started.ok && this.trace === pending && this.review === review) {
      this.trace = {
        path,
        line,
        status: 'error',
        failure: 'local',
        message: started.error.message,
      };
    }
  }

  /** Closes the trace portal, stopping the probe if it is still running. */
  private closeTrace(): void {
    const { review, trace } = this;
    if (review !== undefined && trace?.status === 'loading') {
      void beuveBridge()?.invoke('trace:cancel', { sessionId: review.session.id });
    }
    this.trace = undefined;
  }

  private async trustAndRunTrace(): Promise<void> {
    const bridge = beuveBridge();
    const { review, trace } = this;
    if (bridge === undefined || review === undefined || trace?.status !== 'needs-trust') {
      return;
    }
    const trusted = await bridge.invoke('trace:set-trust', {
      sessionId: review.session.id,
      trusted: true,
    });
    if (this.trace !== trace || this.review !== review) {
      return;
    }
    if (!trusted.ok) {
      this.trace = {
        path: trace.path,
        line: trace.line,
        status: 'error',
        failure: 'local',
        message: trusted.error.message,
      };
      return;
    }
    await this.openTrace(trace.path, trace.line);
  }

  private applyTraceEvent(event: TraceStatusView): void {
    const next = applyTraceStatus(this.trace, this.review?.session.id, event);
    if (next === this.trace) {
      return;
    }
    this.trace = next;
    if (next?.status === 'ready') {
      const tests = next.result.timelines.length;
      const took = formatDuration(next.result.durationMs);
      this.showNotice({
        tone: next.note === undefined ? 'info' : 'error',
        text:
          next.note === undefined
            ? `Trace ready: ${String(tests)} ${tests === 1 ? 'test' : 'tests'} in ${took}.`
            : `Trace ready, but some tests failed (${took}).`,
      });
    } else if (next?.status === 'error') {
      this.showNotice({ tone: 'error', text: `Trace probe: ${next.message}` });
    }
  }

  /** `/trust` and `/untrust`: approve or withdraw running the open repository's tests (ADR 0041). */
  private async runTrustCommand(isTrusting: boolean): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      this.note('error', 'Open a review session first, then type /trust or /untrust.');
      return;
    }
    const sessionId = review.session.id;
    const before = await bridge.invoke('trace:get-trust', { sessionId });
    if (!before.ok) {
      this.note('error', before.error.message);
      return;
    }
    const { repositoryPath } = before.value;
    if (before.value.trusted === isTrusting) {
      this.note(
        'info',
        isTrusting
          ? `${repositoryPath} is already trusted. /untrust withdraws it.`
          : `${repositoryPath} is not trusted.`,
      );
      return;
    }
    const changed = await bridge.invoke('trace:set-trust', { sessionId, trusted: isTrusting });
    if (!changed.ok) {
      this.note('error', changed.error.message);
      return;
    }
    this.note(
      'info',
      ...(isTrusting
        ? [
            `Trusted ${repositoryPath}.`,
            'Pressing r on a hunk now runs this repository’s Vitest tests, and its Vitest config, on this machine. /untrust withdraws this.',
          ]
        : [`No longer trusting ${repositoryPath}. Pressing r will ask again.`]),
    );
    if (!isTrusting) {
      this.closeTrace();
    }
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

  private submitChat(text: string, mentions: readonly ChatMentionView[] = []): void {
    const command = parseChatCommand(text);
    if (command.kind === 'empty') {
      return;
    }
    switch (command.kind) {
      case 'question': {
        void this.askQuestion(command.text, mentions);
        return;
      }
      case 'clear': {
        void this.clearChat();
        return;
      }
      case 'compact': {
        void this.compactChat();
        return;
      }
      case 'help': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        this.addEntry({ id: 0, kind: 'note', tone: 'info', lines: chatHelp });
        return;
      }
      case 'invalid': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        this.addEntry({ id: 0, kind: 'note', tone: 'error', lines: [command.message] });
        return;
      }
      case 'editor': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.runEditorCommand(command.editorId);
        return;
      }
      case 'diff': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.runDisplayCommand(command.layout === undefined ? {} : { layout: command.layout });
        return;
      }
      case 'generated': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.setDisplay(
          command.showGenerated === undefined ? {} : { showGenerated: command.showGenerated },
        ).then((display) => {
          if (display !== undefined) {
            this.note('info', `${describeGenerated(display.showGenerated)}.`);
          }
        });
        return;
      }
      case 'whitespace': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.runDisplayCommand(
          command.ignoreWhitespace === undefined
            ? {}
            : { ignoreWhitespace: command.ignoreWhitespace },
        );
        return;
      }
      case 'trust':
      case 'untrust': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.runTrustCommand(command.kind === 'trust');
        return;
      }
      case 'review': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.startReview(command);
        return;
      }
      case 'sidebar': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.setSidebarSide(command.side).then(() => {
          this.note('info', `Sidebar on the ${command.side}.`);
        });
        return;
      }
    }
  }

  private addEntry(entry: LocalChatEntry): number {
    const id = this.nextEntryId;
    this.nextEntryId += 1;
    this.chat = { ...this.chat, entries: [...this.chat.entries, { ...entry, id }] };
    return id;
  }

  private note(tone: 'info' | 'error', ...lines: string[]): void {
    this.addEntry({ id: 0, kind: 'note', tone, lines });
  }

  private updateEntry(id: number, update: (entry: ReviewChatEntry) => ReviewChatEntry): void {
    this.setEntries(
      this.chat.entries.map((entry) =>
        entry.id === id && entry.kind === 'review' ? update(entry) : entry,
      ),
    );
  }

  private setEntries(entries: readonly ChatEntry[]): void {
    this.chat = { ...this.chat, entries };
  }

  private dispatchChat(action: ChatTranscriptAction): void {
    this.chat = reduceChatTranscript(this.chat, action);
  }

  private applyChatDelta(delta: ChatDeltaView): void {
    if (delta.sessionId === this.review?.session.id) {
      this.dispatchChat({ kind: 'delta', delta });
    }
  }

  /** The session's stored transcript, shown above this window's command results. */
  private async loadChat(sessionId: string): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const listed = await bridge.invoke('chat:list', { sessionId });
    if (listed.ok && this.review?.session.id === sessionId) {
      this.dispatchChat({ kind: 'loaded', messages: listed.value.messages });
    }
  }

  private async askQuestion(question: string, mentions: readonly ChatMentionView[]): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      this.note('error', 'Open a review session first, then ask your question.');
      return;
    }
    const focusPath = review.files.some((file) => file.path === this.activePath)
      ? this.activePath
      : undefined;
    const asked = await bridge.invoke('chat:ask', {
      sessionId: review.session.id,
      question,
      ...(focusPath !== undefined && { focus: { path: focusPath } }),
      ...(mentions.length > 0 && { mentions }),
    });
    if (!asked.ok) {
      this.note('error', asked.error.message);
      this.chatDrawer()?.setDraft(question, mentions);
      return;
    }
    if (this.review?.session.id === review.session.id) {
      this.dispatchChat({ kind: 'asked', ...asked.value });
    }
  }

  /** `/compact` (ADR 0047): shows progress, then the stored summary where it ran. */
  private async compactChat(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      this.note('error', 'Open a review session first.');
      return;
    }
    const sessionId = review.session.id;
    const entryId = this.addEntry({ id: 0, kind: 'compaction', status: 'running' });
    const compacted = await bridge.invoke('chat:compact', { sessionId });
    if (this.review?.session.id !== sessionId) {
      return;
    }
    if (compacted.ok && compacted.value.outcome === 'compacted') {
      this.compactHinted.delete(sessionId);
      this.dispatchChat({ kind: 'compacted', summary: compacted.value.summary });
      return;
    }
    const failure = compacted.ok
      ? compacted.value.outcome === 'failed'
        ? compacted.value.errorMessage
        : undefined
      : compacted.error.message;
    this.setEntries(
      this.chat.entries.flatMap((entry): ChatEntry[] => {
        if (entry.id !== entryId || entry.kind !== 'compaction') {
          return [entry];
        }
        return failure === undefined
          ? [
              {
                id: entryId,
                kind: 'note',
                tone: 'info',
                lines: ['Compaction stopped; nothing was stored.'],
              },
            ]
          : [{ ...entry, status: 'failed', message: failure }];
      }),
    );
  }

  private async clearChat(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      this.chat = emptyChatTranscript;
      return;
    }
    const cleared = await bridge.invoke('chat:clear', { sessionId: review.session.id });
    if (cleared.ok) {
      this.dispatchChat({ kind: 'cleared' });
    } else {
      this.note('error', cleared.error.message);
    }
  }

  /** Stages an answer in the review dock as a question note (spec Zone 4). */
  private async stageChatAnswer(messageId: string): Promise<void> {
    const { review } = this;
    const plan = planChatStage(this.chat.entries, messageId, this.diffPaths());
    if (review === undefined || plan === undefined || this.stagedMessageIds().has(messageId)) {
      return;
    }
    await this.uraCall(async (bridge) => {
      const created = await bridge.invoke('ura:create', {
        sessionId: review.session.id,
        headSha: plan.headSha,
        anchor: plan.anchor,
        severity: plan.severity,
        title: plan.title,
        body: plan.body,
        origin: { kind: 'chat-answer', messageId },
      });
      if (created.ok) {
        this.dockNotice = { tone: 'info', text: `Staged “${created.value.title}”.` };
      }
      return created;
    });
  }

  private chatDrawer(): BeuveChatDrawer | undefined {
    return this.renderRoot.querySelector<BeuveChatDrawer>('beuve-chat-drawer') ?? undefined;
  }

  /**
   * ⌘> (ADR 0046): what the focused region points at becomes a chip in the chat input. The diff
   * gives its selection, hunk or file; the dock its item's anchor; the tree its focused file; the
   * palette its highlighted file or note. The chat tab opens with the input focused.
   */
  private async addSelectionToChat(): Promise<void> {
    if (this.review === undefined) {
      return;
    }
    const target = this.selectionTarget();
    if (typeof target === 'string') {
      this.showNotice({ tone: 'info', text: target });
      return;
    }
    await this.addToChat(target);
  }

  private selectionTarget(): MentionTarget | string {
    if (this.paletteText !== undefined) {
      const palette =
        this.renderRoot.querySelector<BeuveCommandPalette>('beuve-command-palette') ?? undefined;
      const action = palette?.activeAction();
      this.closePalette();
      if (action?.kind === 'file') {
        return { path: action.path, side: 'head' };
      }
      const item =
        action?.kind === 'ura-item'
          ? this.uraItems.find(({ id }) => id === action.itemId)
          : undefined;
      return item === undefined
        ? 'Pick a file or a staged note in the palette first.'
        : this.itemTarget(item);
    }
    switch (this.focusedZone) {
      case 'ura': {
        const item = this.renderRoot.querySelector<BeuveUraDock>('beuve-ura-dock')?.cursorItem();
        return item === undefined ? nothingSelected : this.itemTarget(item);
      }
      case 'intent': {
        const path = this.renderRoot
          .querySelector<BeuveIntentSidebar>('beuve-intent-sidebar')
          ?.focusedPath();
        return path === undefined ? 'Focus a file in the tree to add it.' : { path, side: 'head' };
      }
      default: {
        return (
          this.renderRoot.querySelector<BeuveDiffStream>('beuve-diff-stream')?.chatMention() ??
          nothingSelected
        );
      }
    }
  }

  /** A staged note's lines at this head, or its file. */
  private itemTarget(item: UraItemView): MentionTarget | string {
    if (item.placement.kind !== 'current') {
      return 'That note is outdated: its lines are not at this head.';
    }
    const { anchor } = item.placement;
    switch (anchor.kind) {
      case 'lines': {
        return {
          path: anchor.path,
          side: 'head',
          startLine: anchor.startLine,
          endLine: anchor.endLine,
        };
      }
      case 'file': {
        return { path: anchor.path, side: 'head' };
      }
      case 'change': {
        return 'That note is on the whole change; pick a line or file note.';
      }
    }
  }

  /** Adds a chip for `target` at the review's head (or base) and focuses the chat input. */
  private async addToChat(target: MentionTarget): Promise<void> {
    const { review } = this;
    if (review === undefined) {
      return;
    }
    const mention: ChatMentionView = {
      ...target,
      sha: target.side === 'base' ? review.baseSha : review.headSha,
    };
    this.focusSidebar('chat');
    await this.updateComplete;
    const added = await this.chatDrawer()?.addMention(mention);
    if (added === 'full') {
      this.showNotice({ tone: 'info', text: 'A question takes at most 8 selections.' });
    } else if (added === 'duplicate') {
      this.showNotice({ tone: 'info', text: 'Those lines are already in the question.' });
    }
  }

  /** A chip: show its lines in the diff stream, or say the file is outside the change. */
  private openMention(mention: ChatMentionView): void {
    const file = this.review?.files.find((candidate) =>
      mention.side === 'base'
        ? (candidate.oldPath ?? candidate.path) === mention.path && candidate.status !== 'added'
        : candidate.path === mention.path && candidate.status !== 'deleted',
    );
    if (file === undefined) {
      this.note(
        'info',
        `${mention.path} is not in this diff: the file is unchanged by the review.`,
      );
      return;
    }
    this.jumpNonce += 1;
    this.fileJump = {
      path: file.path,
      ...(mention.startLine !== undefined &&
        mention.endLine !== undefined && {
          line: mention.startLine,
          endLine: mention.endLine,
          side: mention.side,
        }),
      nonce: this.jumpNonce,
    };
    this.focusedZone = 'diff';
  }

  /** A citation pill: show the lines in the diff stream, or say the file is outside the change. */
  private openCitation(citation: ChatCitationView): void {
    const { path, startLine, endLine } = citation;
    if (!this.diffPaths().has(path)) {
      const lines =
        startLine === endLine ? String(startLine) : `${String(startLine)}-${String(endLine)}`;
      this.note(
        'info',
        `${path}:${lines} is not in this diff: the file is unchanged by the review.`,
      );
      return;
    }
    this.jumpNonce += 1;
    this.fileJump = { path, line: startLine, nonce: this.jumpNonce };
    this.focusedZone = 'diff';
  }

  private diffPaths(): ReadonlySet<string> {
    return new Set(this.review?.files.map((file) => file.path));
  }

  /** Answers staged in the dock and still staged. */
  private stagedMessageIds(): ReadonlySet<string> {
    return new Set(
      this.uraItems.flatMap((item) =>
        item.origin.kind === 'chat-answer' && item.status.kind === 'staged'
          ? item.origin.messageId
          : [],
      ),
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
    this.setEntries(
      this.chat.entries.map((entry) =>
        entry.kind === 'review' ? advanceReviewEntry(entry, event) : entry,
      ),
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
    this.setEntries(withCitations(this.chat.entries, listed.value.insights));
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
    this.setEntries(withCitations(this.chat.entries, this.insights));
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
      ...(request.suggestedPatch !== undefined && { suggestedPatch: request.suggestedPatch }),
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
    if (
      this.handleModifiedKey(event) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isEditable(event) ||
      this.paletteText !== undefined ||
      this.openDialog
    ) {
      return;
    }
    if (this.overlayOpen) {
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault();
        this.overlayOpen = false;
      }
      return;
    }
    const action = plainKeyActions[event.key];
    if (action === undefined || (action === 'cycle-zone' && event.key !== 'Tab')) {
      return;
    }
    event.preventDefault();
    if (action === 'cycle-zone') {
      this.focusedZone = cycleZone(this.zoneOrder(), this.focusedZone, event.shiftKey ? -1 : 1);
      return;
    }
    this.runAppAction(action);
  }

  /** ⌘K / ⌘⇧P (palette), ⌘P (files), ⌘O (open), Ctrl on other platforms; work in text fields too. */
  private handleModifiedKey(event: KeyboardEvent): boolean {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) {
      return false;
    }
    if (isAddToChatKey(event)) {
      if (isEditable(event) && this.paletteText === undefined) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      this.runAppAction('add-to-chat');
      return true;
    }
    const key = event.key.toLowerCase();
    const isPaletteOpen = this.paletteText !== undefined;
    let action: AppAction | 'close' | undefined;
    if (key === 'k' || (key === 'p' && event.shiftKey)) {
      action = isPaletteOpen ? 'close' : 'palette';
    } else if (key === 'p' && !isPaletteOpen && !this.openDialog) {
      action = 'go-to-file';
    } else if (key === 'o') {
      action = 'open';
    } else if (!isPaletteOpen && key === 'f' && !event.shiftKey && !this.openDialog) {
      action = 'find';
    }
    if (action === undefined) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (action === 'close') {
      this.closePalette();
    } else {
      this.runAppAction(action);
    }
    return true;
  }

  private runAppAction(action: AppAction): void {
    switch (action) {
      case 'open': {
        this.paletteText = undefined;
        this.showOpenDialog();
        return;
      }
      case 'palette':
      case 'go-to-file': {
        this.openDialog = false;
        this.overlayOpen = false;
        this.paletteText = action === 'palette' ? '' : '@';
        return;
      }
      case 'cycle-zone': {
        this.focusedZone = cycleZone(this.zoneOrder(), this.focusedZone, 1);
        return;
      }
      case 'shortcuts': {
        this.overlayOpen = true;
        return;
      }
      case 'chat': {
        this.toggleChat();
        return;
      }
      case 'add-to-chat': {
        void this.addSelectionToChat();
        return;
      }
      case 'tree-mode': {
        this.treeMode = this.treeMode === 'diff-only' ? 'neighborhood' : 'diff-only';
        return;
      }
      case 'toggle-sidebar': {
        this.sidebarHidden = !this.sidebarHidden;
        if (this.sidebarHidden && this.focusedZone !== 'diff') {
          this.focusedZone = 'diff';
        }
        return;
      }
      case 'flip-sidebar': {
        void this.setSidebarSide(this.sidebarSide === 'right' ? 'left' : 'right');
        return;
      }
      case 'sidebar-overview': {
        this.focusSidebar('intent');
        return;
      }
      case 'sidebar-review': {
        this.focusSidebar('ura');
        return;
      }
      case 'sidebar-chat': {
        this.focusSidebar('chat');
        return;
      }
      case 'find': {
        this.overlayOpen = false;
        this.focusedZone = 'diff';
        void this.renderRoot.querySelector<BeuveDiffStream>('beuve-diff-stream')?.openFind();
        return;
      }
      case 'toggle-generated': {
        void this.setDisplay({ showGenerated: !this.display.showGenerated });
      }
    }
  }

  private focusSidebar(zone: SidebarZone): void {
    if (this.review === undefined) {
      return;
    }
    this.sidebarHidden = false;
    this.sidebarTab = zone;
    this.focusedZone = zone;
  }

  /** `/sidebar left|right`: moves the sidebar now and stores the side in `settings.json`. */
  private async setSidebarSide(side: SidebarSideView): Promise<void> {
    this.sidebarSide = side;
    if ((await this.setDisplay({ sidebarSide: side })) !== undefined) {
      this.showNotice({ tone: 'info', text: `Sidebar on the ${side}` });
    }
  }

  private showOpenDialog(): void {
    void this.refreshSessions();
    this.overlayOpen = false;
    this.openDialog = true;
    void this.updateComplete.then(() => {
      const panel = this.openPanel();
      panel?.reset();
      panel?.focus();
    });
  }

  private closeOpenDialog(): void {
    this.openDialog = false;
    this.pullFailure = undefined;
    this.localFailure = undefined;
    this.refocusZone();
  }

  private closePalette(): void {
    this.paletteText = undefined;
    this.refocusZone();
  }

  private openPanel(): BeuveOpenPanel | undefined {
    return (
      this.renderRoot.querySelector<BeuveOpenPanel>(':scope .dialog beuve-open-panel') ?? undefined
    );
  }

  /** Puts focus back in the focused zone after an overlay closes. */
  private refocusZone(): void {
    void this.updateComplete.then(() => {
      this.zoneElement(this.focusedZone)?.focus();
    });
  }

  private zoneElement(zone: ZoneId): HTMLElement | undefined {
    return (
      this.renderRoot.querySelector<HTMLElement>(`[data-zone='${CSS.escape(zone)}']`) ?? undefined
    );
  }

  private async runPaletteAction(action: PaletteAction): Promise<void> {
    switch (action.kind) {
      case 'command': {
        await this.runCommand(action.command);
        return;
      }
      case 'session': {
        await this.selectSession(action.sessionId);
        return;
      }
      case 'open-pull': {
        if (action.repoPath !== undefined) {
          await this.openPullRequest({ ref: action.ref, repoPath: action.repoPath });
          return;
        }
        this.showOpenDialog();
        await this.updateComplete;
        this.openPanel()?.showPullStep(action.ref);
        return;
      }
      case 'open-step': {
        this.showOpenDialog();
        await this.updateComplete;
        const panel = this.openPanel();
        if (action.step === 'pull') {
          panel?.showPullStep('');
        } else {
          panel?.showLocalStep(action.path ?? '');
        }
        return;
      }
      case 'file': {
        this.goToFile(action.path, action.isChanged);
        return;
      }
      case 'ura-item': {
        const item = this.uraItems.find(({ id }) => id === action.itemId);
        if (item !== undefined) {
          this.onUraJump(new CustomEvent('beuve-ura-jump', { detail: { item } }));
        }
        return;
      }
      case 'insight': {
        this.onCitation(
          new CustomEvent('beuve-citation', { detail: { insightId: action.insightId } }),
        );
      }
    }
  }

  /** A changed file scrolls the diff to it; any other file is shown in the tree. */
  private goToFile(path: string, isChanged: boolean): void {
    if (isChanged) {
      this.onTreeSelect(new CustomEvent('beuve-tree-select', { detail: { path } }));
      this.focusedZone = 'diff';
      this.refocusZone();
      return;
    }
    this.treeMode = 'neighborhood';
    this.focusSidebar('intent');
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<BeuveIntentSidebar>('beuve-intent-sidebar')?.revealPath(path);
    });
  }

  private async runCommand(command: CommandDefinition): Promise<void> {
    const { run } = command;
    switch (run.kind) {
      case 'app': {
        this.runAppAction(run.action);
        this.refocusZone();
        return;
      }
      case 'zone-key': {
        if (run.zone === 'diff' || run.zone === 'chat' || this.review === undefined) {
          this.focusedZone = run.zone;
        } else {
          this.focusSidebar(run.zone);
        }
        await this.updateComplete;
        const zone = this.zoneElement(run.zone);
        zone?.focus();
        zone?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: run.key,
            shiftKey: run.isShifted === true,
            bubbles: true,
            composed: true,
          }),
        );
        return;
      }
      case 'slash': {
        this.focusSidebar('chat');
        await this.updateComplete;
        if (run.isPrefill) {
          this.renderRoot.querySelector<BeuveChatDrawer>('beuve-chat-drawer')?.prefill(run.text);
        } else {
          this.submitChat(run.text);
        }
        return;
      }
      case 'none': {
        const zone = scopeZones[command.scope];
        if (zone !== undefined) {
          this.focusedZone = zone;
        }
        this.refocusZone();
      }
    }
  }

  /** Zones Tab visits: the sidebar's only while it shows. */
  private zoneOrder(): ZoneId[] {
    const hasSidebar = this.review !== undefined && !this.sidebarHidden;
    return zones.map(({ id }) => id).filter((id) => id === 'diff' || hasSidebar);
  }

  /** `c`: shows the chat tab and focuses its input; from the chat, goes back to the diff. */
  private toggleChat(): void {
    if (this.focusedZone === 'chat') {
      this.focusedZone = 'diff';
    } else {
      this.focusSidebar('chat');
    }
  }

  /** The dock's GitHub posting state, for pull request sessions only. */
  private githubDock(): GithubDockState | undefined {
    const source = this.review?.session.source;
    if (source?.kind !== 'github-pull-request') {
      return undefined;
    }
    const auth = this.githubAuth;
    return {
      target: `${source.owner}/${source.repo}#${String(source.number)}`,
      isSignedIn: auth?.kind === 'signed-in' && auth.host === source.host,
      signInHint:
        auth?.kind === 'signed-out'
          ? auth.remedy === undefined
            ? auth.message
            : `sign in first: run ${auth.remedy}.`
          : 'checking GitHub sign-in…',
      post: this.githubPost,
    };
  }

  private paletteSources(): PaletteSources {
    return {
      commands: commandRegistry,
      sessions: this.sessions,
      ...(this.review !== undefined && { files: this.review.files }),
      ...(this.tree !== undefined && { trackedPaths: this.tree.paths }),
      uraItems: this.uraItems,
      insights: this.insights,
    };
  }

  private renderTitlebar(): TemplateResult {
    return html`<div class="titlebar">
      <span class="brand">beuve</span>
      <button
        type="button"
        title="Open a pull request, branch or recent review (⌘O)"
        @click=${(): void => {
          this.showOpenDialog();
        }}
      >
        ${describeSessionLabel(this.sessions, this.selectedId, this.review?.session)}
      </button>
      <span class="spacer"></span>
      <button
        type="button"
        title="Command palette"
        @click=${(): void => {
          this.runAppAction('palette');
        }}
      >
        <kbd>${displayKey('⌘K', this.appInfo?.platform)}</kbd>
      </button>
    </div>`;
  }

  private renderIntent(): TemplateResult {
    return html`<beuve-intent-sidebar
      data-zone="intent"
      tabindex="-1"
      ?hidden=${this.sidebarTab !== 'intent'}
      ?focused=${this.focusedZone === 'intent'}
      .pullRequest=${this.pullRequest}
      .files=${this.review?.files}
      .tree=${this.tree}
      .impact=${this.impact}
      .generatedPaths=${this.reviewDeferrals().generated}
      .treeMode=${this.treeMode}
      @beuve-open-stack=${this.onOpenStack}
      @beuve-open-link=${this.onOpenLink}
      @beuve-tree-select=${this.onTreeSelect}
    ></beuve-intent-sidebar>`;
  }

  private renderDiff(): TemplateResult {
    if (this.review === undefined && !this.reviewLoading && this.reviewError === '') {
      return html`<div class="empty">
        <div>
          <h1>Open a review</h1>
          <p>Pick up where you left off, or paste the pull request you were asked to look at.</p>
          ${this.renderOpenPanel(false, 'diff')}
        </div>
      </div>`;
    }
    return html`<beuve-diff-stream
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
      .flow=${this.flow}
      .trace=${this.trace}
      .insights=${this.insights}
      .insightJump=${this.insightJump}
      .fileJump=${this.fileJump}
      .loadFilePair=${this.loadFilePair}
      .uraItems=${this.uraItems}
      .display=${this.display}
      .suggestionJump=${this.suggestionJump}
      .deferrals=${this.reviewDeferrals().deferrals}
      @beuve-display-change=${this.onDisplayChange}
      @beuve-status-notice=${this.onStatusNotice}
      @beuve-ura-update=${this.onUraUpdate}
      @beuve-mark-reviewed=${this.onMarkReviewed}
      @beuve-insight-status=${this.onInsightStatus}
      @beuve-peek-request=${this.onPeekRequest}
      @beuve-peek-expand=${this.onPeekExpand}
      @beuve-peek-close=${this.onPeekClose}
      @beuve-flow-request=${this.onFlowRequest}
      @beuve-flow-close=${this.onFlowClose}
      @beuve-trace-request=${this.onTraceRequest}
      @beuve-trace-close=${this.onTraceClose}
      @beuve-trace-trust=${this.onTraceTrust}
      @beuve-diff-rendered=${this.onDiffRendered}
      @beuve-ura-create=${this.onUraCreate}
      @beuve-active-file=${this.onActiveFile}
      @beuve-open-editor=${this.onOpenEditor}
      @beuve-ura-stage-finding=${this.onStageFinding}
      @beuve-chat-add=${this.onChatAdd}
    ></beuve-diff-stream>`;
  }

  private renderOpenPanel(isClosable: boolean, zone: ZoneId | undefined): TemplateResult {
    return html`<beuve-open-panel
      data-zone=${zone ?? nothing}
      ?closable=${isClosable}
      .platform=${this.appInfo?.platform ?? ''}
      .sessions=${this.sessions}
      ?openingPull=${this.openingPull}
      ?openingLocal=${this.opening}
      .pullFailure=${this.pullFailure}
      .localFailure=${this.localFailure}
      .chooseFolder=${this.chooseFolder}
      .inspect=${this.inspectRepository}
      @beuve-select-session=${this.onSelectSession}
      @beuve-open-pull-request=${this.onOpenPullRequest}
      @beuve-open-repository=${this.onOpenRepository}
      @beuve-open-close=${this.onOpenClose}
    ></beuve-open-panel>`;
  }

  private renderDock(): TemplateResult {
    return html`<beuve-ura-dock
      data-zone="ura"
      tabindex="-1"
      ?hidden=${this.sidebarTab !== 'ura'}
      ?focused=${this.focusedZone === 'ura'}
      ?hasSession=${this.review !== undefined}
      .items=${this.uraItems}
      .derivedVerdict=${this.uraVerdict}
      .chosenVerdict=${this.chosenVerdict}
      .verdictNotice=${this.verdictNotice}
      .notice=${this.dockNotice}
      ?exporting=${this.exporting}
      .github=${this.githubDock()}
      @beuve-github-preview=${this.onGithubPreview}
      @beuve-github-post=${this.onGithubPost}
      @beuve-github-cancel=${this.onGithubCancel}
      @beuve-open-link=${this.onOpenLink}
      @beuve-ura-jump=${this.onUraJump}
      @beuve-open-editor=${this.onOpenEditor}
      @beuve-ura-update=${this.onUraUpdate}
      @beuve-ura-edit-suggestion=${this.onUraEditSuggestion}
      @beuve-ura-transition=${this.onUraTransition}
      @beuve-ura-reorder=${this.onUraReorder}
      @beuve-ura-export=${this.onUraExport}
      @beuve-ura-set-verdict=${this.onUraSetVerdict}
    ></beuve-ura-dock>`;
  }

  private renderChat(): TemplateResult {
    return html`<beuve-chat-drawer
      data-zone="chat"
      tabindex="-1"
      ?hidden=${this.sidebarTab !== 'chat'}
      ?focused=${this.focusedZone === 'chat'}
      .transcript=${this.chat.entries}
      .diffPaths=${this.diffPaths()}
      .stagedMessageIds=${this.stagedMessageIds()}
      ?hasSession=${this.review !== undefined}
      @beuve-chat-submit=${this.onChatSubmit}
      @beuve-chat-escape=${this.onChatEscape}
      @beuve-chat-cycle=${this.onChatCycle}
      @beuve-chat-cancel=${this.onChatCancel}
      @beuve-chat-stage=${this.onChatStage}
      @beuve-chat-cite=${this.onChatCite}
      @beuve-chat-mention=${this.onChatMention}
      @beuve-chat-cancel-compaction=${this.onChatCancelCompaction}
      @beuve-open-editor=${this.onOpenEditor}
      @beuve-citation=${this.onCitation}
    ></beuve-chat-drawer>`;
  }

  private stagedCount(): number {
    return this.uraItems.filter((item) => item.status.kind === 'staged').length;
  }

  /** Intent and files, the review and the chat as quiet tabs (1, 2, 3). */
  private renderTabs(): TemplateResult {
    const tab = (zone: SidebarZone, label: string, extra: string): TemplateResult =>
      html`<button
        type="button"
        role="tab"
        aria-selected=${this.sidebarTab === zone ? 'true' : 'false'}
        @click=${(): void => {
          this.focusSidebar(zone);
        }}
      >
        ${label}${extra === '' ? nothing : html`<span class="count">${extra}</span>`}
      </button>`;
    const staged = this.stagedCount();
    return html`<nav class="tabs" role="tablist" aria-label="Sidebar">
      ${tab('intent', this.pullRequest === undefined ? 'Files' : 'Intent & files', '')}
      ${tab('ura', 'Review', staged === 0 ? '' : String(staged))} ${tab('chat', 'Chat', '')}
    </nav>`;
  }

  private renderSidebar(): TemplateResult {
    return html`<div class="sidebar">
      ${this.renderTabs()} ${this.renderIntent()} ${this.renderDock()} ${this.renderChat()}
    </div>`;
  }

  override render(): TemplateResult {
    const hasSidebar = this.review !== undefined && !this.sidebarHidden;
    const workspace = [hasSidebar ? '' : 'solo', this.sidebarSide === 'left' ? 'left' : '']
      .filter((name) => name !== '')
      .join(' ');
    const focused = zones.find(({ id }) => id === this.focusedZone);
    return html`
      ${this.renderTitlebar()}
      <div class="workspace ${workspace}">
        <div class="main">${this.renderDiff()}</div>
        ${hasSidebar ? this.renderSidebar() : nothing}
      </div>
      <beuve-status-bar
        .zoneLabel=${this.review === undefined ? '' : (focused?.label ?? '')}
        .zoneHints=${this.review === undefined ? '' : (focused?.hints ?? '')}
        .mcpStatus=${this.mcpStatus}
        .appInfo=${this.appInfo}
        .notice=${this.statusNotice}
        .ci=${this.ci}
        .githubAuth=${this.githubAuth}
      ></beuve-status-bar>
      ${
        this.openDialog
          ? html`<div
              class="scrim"
              @click=${(event: MouseEvent): void => {
                if (event.target === event.currentTarget) {
                  this.closeOpenDialog();
                }
              }}
            >
              <div class="dialog" role="dialog" aria-modal="true" aria-label="Open">
                ${this.renderOpenPanel(true, undefined)}
              </div>
            </div>`
          : nothing
      }
      ${
        this.paletteText === undefined
          ? nothing
          : html`<beuve-command-palette
              .sources=${this.paletteSources()}
              .initialText=${this.paletteText}
              .platform=${this.appInfo?.platform ?? ''}
              @beuve-palette-run=${this.onPaletteRun}
              @beuve-palette-close=${this.onPaletteClose}
            ></beuve-command-palette>`
      }
      ${
        this.overlayOpen
          ? html`<beuve-keybinding-overlay
              .editorName=${currentEditorName(this.editorSettings)}
              .displayName=${describeDiffDisplay(this.display, false).text}
              .platform=${this.appInfo?.platform ?? ''}
            ></beuve-keybinding-overlay>`
          : nothing
      }
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const zone = this.focusedZone;
    if (zone !== 'diff' && changed.has('focusedZone')) {
      this.sidebarTab = zone;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (this.paletteText !== undefined && changed.has('paletteText')) {
      this.renderRoot.querySelector('beuve-command-palette')?.focus();
      return;
    }
    const isRelevant = ['focusedZone', 'sidebarHidden'].some((key) =>
      changed.has(key as keyof BeuveApp),
    );
    if (!isRelevant || this.paletteText !== undefined || this.openDialog) {
      return;
    }
    const element = this.zoneElement(this.focusedZone);
    if (element !== undefined && !element.matches(':focus-within')) {
      element.focus();
    }
  }
}

type SidebarZone = Exclude<ZoneId, 'diff'>;

/** Unmodified keys the shell handles itself, from the command registry's shortcuts. */
function describeGenerated(isShown: boolean): string {
  return isShown
    ? 'Generated files: shown (/generated hide collapses them)'
    : 'Generated files: collapsed (/generated show expands them)';
}

const plainKeyActions: Readonly<Record<string, AppAction>> = {
  Tab: 'cycle-zone',
  '?': 'shortcuts',
  c: 'chat',
  f: 'tree-mode',
  '\\': 'toggle-sidebar',
  '1': 'sidebar-overview',
  '2': 'sidebar-review',
  '3': 'sidebar-chat',
};

const scopeZones: Readonly<Partial<Record<CommandDefinition['scope'], ZoneId>>> = {
  Diff: 'diff',
  Review: 'ura',
  Chat: 'chat',
  Files: 'intent',
};

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

function toFlowState(path: string, line: number, answer: IpcResult<FlowGraphResponse>): FlowState {
  if (!answer.ok) {
    return { path, line, status: 'error', message: answer.error.message };
  }
  return answer.value.kind === 'graph'
    ? { path, line, status: 'ready', graph: answer.value.graph }
    : { path, line, status: 'error', message: flowFailureText[answer.value.failure] };
}

const flowFailureText: Readonly<Record<FlowFailureKind, string>> = {
  'unsupported-language':
    'No control-flow chart for this kind of file yet (TypeScript and JavaScript only).',
  'no-function-at-line': 'The change is not inside a function, so there is no flow to draw.',
  'too-large': 'This function is too large to draw as a chart.',
  'file-unavailable': 'The head version of this file is not readable source.',
};

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
};

function formatBytes(characters: number): string {
  return characters < 1024
    ? `${String(characters)} characters`
    : `${(characters / 1024).toFixed(1)} K characters`;
}

const nothingSelected =
  'Select lines, focus a hunk, a staged note or a file to add it to the chat.';

/** ⌘> / Ctrl+> (Shift+Period), as Zed binds "add selection to thread". */
function isAddToChatKey(event: KeyboardEvent): boolean {
  return event.key === '>' || (event.shiftKey && event.code === 'Period');
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
