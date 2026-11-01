import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';

import type {
  AppInfo,
  BeuveApi,
  CallHierarchyView,
  ChatCitationView,
  ChatCommandRequest,
  ChatMentionView,
  ChatMessageView,
  ChatStreamEvent,
  CiStatusView,
  CreateLocalSessionRequest,
  DiffDisplayView,
  DiffFileView,
  EditorId,
  EditorSettingsView,
  FileAttributesView,
  FilePairView,
  FileReviewProgressView,
  FileReviewStateView,
  FlowFailureKind,
  FlowGraphResponse,
  GithubAuthStatusView,
  ImpactView,
  IpcResult,
  McpStatus,
  OpenPullRequestRequest,
  PullRequestSessionView,
  PullRequestUpdatedView,
  RepositoryTreeView,
  ReviewEditsView,
  ReviewOrderMode,
  ReviewOrderView,
  ReviewView,
  SessionSummary,
  SetDiffDisplayRequest,
  SidebarSideView,
  TraceStatusView,
  TrustView,
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
import './beuve-trust-dialog.ts';
import type { TrustDialogChoice } from './beuve-trust-dialog.ts';
import type { TerminalFocusDetail } from './beuve-terminal-panel.ts';
import './beuve-ura-dock.ts';
import { countNoun } from './count-noun.ts';
import { planDiffDeferrals } from './plan-diff-deferrals.ts';
import type { DiffDeferral } from './plan-diff-deferrals.ts';
import { beuveBridge } from './beuve-bridge.ts';
import type { BeuveChatDrawer } from './beuve-chat-drawer.ts';
import type { BeuveCommandPalette } from './beuve-command-palette.ts';
import type { BeuveDiffStream } from './beuve-diff-stream.ts';
import type { BeuveSheetView } from './beuve-sheet-view.ts';
import type { BeuveIntentSidebar } from './beuve-intent-sidebar.ts';
import type { BeuveUraDock } from './beuve-ura-dock.ts';
import type { MentionTarget } from './chat-draft.ts';
import type {
  BeuveOpenPanel,
  FolderChooser,
  OpenFailure,
  RepositoryInspector,
} from './beuve-open-panel.ts';
import type { CommandId } from '#contract/command-catalog.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import { commandRegistry } from './command-registry.ts';
import type { CommandDefinition } from './command-registry.ts';
import { shortcutOf } from './shortcut-of.ts';
import { keyPlatformOf } from './key-platform-of.ts';
import { menuStateFrom } from './menu-state-from.ts';
import type { MenuStateInput } from './menu-state-from.ts';
import type { PaletteAction, PaletteSources } from './plan-palette.ts';
import type { FileJump, SuggestionJump, UraCreateRequest } from './beuve-diff-stream.ts';
import type { FilePairLoader } from './beuve-file-card.ts';
import type { DockNotice } from './beuve-ura-dock.ts';
import type { ChatEntry, ChatTranscript, LocalChatEntry } from './chat-entry.ts';
import { chatHelp } from './chat-help.ts';
import { describeDiffDisplay } from './describe-diff-display.ts';
import { describeEditorOpen } from './describe-editor-open.ts';
import { describeEditorSettings } from './describe-editor-settings.ts';
import { describeSessionLabel } from './describe-session-label.ts';
import type { StatusNotice, StatusNoticeAction } from './describe-editor-open.ts';
import { cycleZone } from './cycle-zone.ts';
import { mentionFromTarget } from './mention-from-target.ts';
import { mergeReviewInsights } from './merge-review-insights.ts';
import { targetFromAnchor } from './target-from-anchor.ts';
import type { ReviewInsight } from './merge-review-insights.ts';
import { parseChatCommand } from './parse-chat-command.ts';
import { planChatStage } from './plan-chat-stage.ts';
import { emptyChatTranscript } from './empty-chat-transcript.ts';
import { withoutStagedInsights } from './without-staged-insights.ts';
import { isActiveRequest } from './is-active-request.ts';
import { reduceChatTranscript } from './reduce-chat-transcript.ts';
import type { ChatTranscriptAction } from './reduce-chat-transcript.ts';
import type { FlowState } from './flow-state.ts';
import { describeReviewPreview } from './describe-review-preview.ts';
import type { GithubDockState, GithubPostState } from './github-post-state.ts';
import { clearReviewEditsStatus } from './clear-review-edits-status.ts';
import type { ReviewEditsFlow } from './review-edits-state.ts';
import { lineFromTarget } from './line-from-target.ts';
import type { PeekChildren, PeekState } from './peek-state.ts';
import { applyTraceStatus } from './apply-trace-status.ts';
import { formatIsoDuration } from './format-iso-duration.ts';
import type { TraceState } from './trace-state.ts';
import type { RadarTreeMode } from './plan-radar-tree.ts';
import { zones } from './zones.ts';
import './beuve-sheet-view.ts';
import { runSheetAction } from './run-sheet-action.ts';
import type { SheetAction, SheetOpenDetail } from './run-sheet-action.ts';
import type { SheetPlace } from './step-sheet-history.ts';
import type { ZoneId } from './zones.ts';
import type { ChatStreamSubscribe } from './text-part-stream.ts';

const impactGrace = Temporal.Duration.from({ milliseconds: 1500 });

/**
 * Root of the renderer: the four-zone shell (spec section 4), the zone focus model and the
 * keys the shell already handles. Owns all bridge calls and session state; zones are
 * presentational and report user intent with events.
 */
/** The file the diff stream is on, if any. */
interface ActiveFileDetail {
  readonly path: string | undefined;
}

/** Lines a diff card adds to the chat. */
interface ChatAddDetail {
  readonly target: MentionTarget;
}

/** A citation pill to open. */
interface ChatCiteDetail {
  readonly citation: ChatCitationView;
}

/** A context chip to show in the diff. */
interface ChatMentionDetail {
  readonly mention: ChatMentionView;
}

/** A question and its context chips. */
interface ChatSubmitDetail {
  readonly text: string;
  readonly mentions?: readonly ChatMentionView[];
}

/** A file and line to open in the editor. */
interface EditorOpenDetail {
  readonly path: string;
  readonly line: number;
}

/** A file to mark reviewed, or to unmark. */
interface FileReviewedDetail {
  readonly path: string;
  readonly reviewed: boolean;
}

/** One finding of a `/review` answer: its message and its index. */
interface FindingRefDetail {
  readonly messageId: string;
  readonly finding: number;
}

/** A repository-relative file and a line to open it at. */
interface EditorPlace {
  readonly path: string;
  readonly line: number;
}

/** A button of the dock's review-edits section (ADR 0088). */
interface ReviewEditsDetail {
  readonly op: string;
}

/** Post the staged review to GitHub, with this verdict over the derived one. */
interface GithubPostDetail {
  readonly verdict?: UraVerdictView | undefined;
}

/** A file and, if any, the line a portal opens at. */
interface LineRequestDetail {
  readonly path: string;
  readonly line: number | undefined;
}

/** A chat message, by id. */
interface MessageIdDetail {
  readonly messageId: string;
}

/** The palette entry the reviewer ran. */
interface PaletteRunDetail {
  readonly action: PaletteAction;
}

/** A call hierarchy node to expand. */
interface PeekExpandDetail {
  readonly nodeId: string;
}

/** A session the open panel or the palette picked. */
interface SessionIdDetail {
  readonly sessionId: string;
}

/** A stacked pull request, by its ref. */
interface StackRefDetail {
  readonly ref: string;
}

/** An ImpactGate finding to stage: its file and function. */
interface StageFindingDetail {
  readonly path: string;
  readonly functionName: string;
}

/** The radar tree mode chosen in its header. */
interface TreeModeDetail {
  readonly mode: RadarTreeMode;
}

/** A file picked in the radar tree. */
interface TreeSelectDetail {
  readonly path: string;
}

/** Where to export the staged review. */
interface UraExportDetail {
  readonly target: UraExportTarget;
}

/** A staged item, by id. */
interface UraItemIdDetail {
  readonly itemId: string;
}

/** A staged item to show in the diff. */
interface UraJumpDetail {
  readonly item: UraItemView;
}

/** The dock order after a move. */
interface UraReorderDetail {
  readonly itemIds: readonly string[];
}

/** A staged item and the status it moves to. */
interface UraTransitionDetail {
  readonly itemId: string;
  readonly to: 'staged' | 'withdrawn' | 'addressed';
}

/** The fields of a staged item the dock edited. */
interface UraUpdateDetail {
  readonly itemId: string;
  readonly title?: string;
  readonly body?: string;
  readonly severity?: UraSeverityView;
  readonly suggestedPatch?: string;
}

/** The verdict the reviewer chose; `undefined` goes back to the derived one. */
interface UraVerdictDetail {
  readonly verdict: UraVerdictView | undefined;
}

/** A link to open. */
interface UrlDetail {
  readonly url: string;
}

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

    .main > beuve-terminal-panel {
      flex: none;
      height: var(--beuve-terminal-height, 300px);
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

    .sheet-overlay {
      position: fixed;
      inset: var(--beuve-titlebar-height) 0 var(--beuve-statusbar-height) auto;
      z-index: 15;
      width: min(760px, 62vw);
      border-left: 1px solid var(--beuve-border);
      box-shadow: -8px 0 24px var(--beuve-scrim-soft);
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
  /** The `requestId` of the `github:open-pr` in flight, for `request:cancel`. */
  private pullRequestId: string | undefined;

  private readonly onFocusIn = (event: FocusEvent): void => {
    const zone = event
      .composedPath()
      .find((target) => target instanceof HTMLElement && target.dataset['zone'] !== undefined);
    if (zone instanceof HTMLElement) {
      this.focusedZone = zone.dataset['zone'] as ZoneId;
    }
    this.scheduleMenuSync();
  };

  private readonly onFocusOut = (): void => {
    this.scheduleMenuSync();
  };

  /** A right-click: the context menu of what it landed on, built by main from the catalog. */
  private readonly onContextMenu = (event: MouseEvent): void => {
    const kind = this.contextKindAt(event);
    if (kind === undefined) {
      return;
    }
    event.preventDefault();
    this.scheduleMenuSync();
    void this.updateComplete.then(async () => {
      this.syncMenuState();
      await beuveBridge()?.invoke('menu:context', {
        kind,
        x: event.clientX,
        y: event.clientY,
      });
    });
  };

  /** The chat answer a context menu was opened on, for Stage Answer as a Note. */
  private contextAnswerId: string | undefined;
  private isMenuSyncPending = false;
  private lastMenuState = '';

  private readonly onOpenRepository = (event: CustomEvent<CreateLocalSessionRequest>): void => {
    void this.openRepository(event.detail);
  };

  private readonly onSelectSession = (event: CustomEvent<SessionIdDetail>): void => {
    void this.selectSession(event.detail.sessionId);
  };

  private readonly onOpenPullRequest = (event: CustomEvent<OpenPullRequestRequest>): void => {
    void this.openPullRequest(event.detail);
  };

  /** A stack chip: the neighbour lives in the same repository, so it uses the same clone. */
  private readonly onOpenStack = (event: CustomEvent<StackRefDetail>): void => {
    const source = this.review?.session.source;
    void this.openPullRequest({
      ref: event.detail.ref,
      ...(source !== undefined && { repoPath: source.repoPath }),
    });
  };

  /** `chat:stream` for the drawer's streaming Markdown (ADR 0073); none without the bridge. */
  private readonly subscribeChatStream: ChatStreamSubscribe | undefined =
    subscribeChatStreamOf(beuveBridge());

  private readonly onOpenLink = (event: CustomEvent<UrlDetail>): void => {
    void this.openLink(event.detail.url);
  };

  private readonly onOpenChatLink = (event: CustomEvent<UrlDetail>): void => {
    void this.openUrl(event.detail.url);
  };

  private readonly onGithubPreview = (): void => {
    void this.previewGithubReview();
  };

  private readonly onGithubPost = (event: CustomEvent<GithubPostDetail>): void => {
    void this.postGithubReview(event.detail.verdict);
  };

  private readonly onGithubCancel = (): void => {
    this.githubPost = { kind: 'idle' };
  };

  /** Edits happen in the editor, outside beuve: coming back to the window counts them again. */
  private readonly onWindowFocus = (): void => {
    const sessionId = this.review?.session.id;
    if (sessionId !== undefined) {
      void this.loadReviewEdits(sessionId);
    }
  };

  private readonly onReviewEdits = (event: CustomEvent<ReviewEditsDetail>): void => {
    switch (event.detail.op) {
      case 'open': {
        void this.openReviewEdits();
        return;
      }
      case 'preview': {
        void this.previewReviewEdits();
        return;
      }
      case 'stage': {
        void this.stageReviewEdits();
        return;
      }
      case 'discard-preview': {
        void this.previewDiscardReviewEdits();
        return;
      }
      case 'discard': {
        void this.discardReviewEdits();
        return;
      }
      default: {
        this.reviewEditsFlow = { kind: 'idle' };
      }
    }
  };

  private readonly onMarkReviewed = (): void => {
    void this.markReviewed();
  };

  private readonly onPeekRequest = (event: CustomEvent<LineRequestDetail>): void => {
    void this.openPeek(event.detail.path, event.detail.line);
  };

  private readonly onSheetRequest = (event: CustomEvent<SheetOpenDetail>): void => {
    void this.sheetAction({ kind: 'open', ...event.detail });
  };

  private readonly onSheetClose = (): void => {
    this.inlineSheet = undefined;
    this.focusedZone = 'diff';
  };

  private readonly onPeekExpand = (event: CustomEvent<PeekExpandDetail>): void => {
    void this.expandPeek(event.detail.nodeId);
  };

  private readonly onPeekClose = (): void => {
    this.peek = undefined;
  };

  private readonly onFlowRequest = (event: CustomEvent<LineRequestDetail>): void => {
    void this.openFlow(event.detail.path, event.detail.line);
  };

  private readonly onFlowClose = (): void => {
    this.flow = undefined;
  };

  private readonly onTraceRequest = (event: CustomEvent<LineRequestDetail>): void => {
    void this.openTrace(event.detail.path, event.detail.line);
  };

  private readonly onTraceClose = (): void => {
    this.closeTrace();
  };

  private readonly onTraceTrust = (): void => {
    void this.trustAndRunTrace();
  };

  private insightCache: { signature: string; insights: readonly ReviewInsight[] } | undefined;

  private readonly onChatSubmit = (event: CustomEvent<ChatSubmitDetail>): void => {
    this.submitChat(event.detail.text, event.detail.mentions ?? []);
  };

  /** A context chip, in the input or the transcript: show its lines in the diff. */
  private readonly onChatMention = (event: CustomEvent<ChatMentionDetail>): void => {
    this.openMention(event.detail.mention);
  };

  /** The gutter's chat button on a diff card. */
  private readonly onChatAdd = (event: CustomEvent<ChatAddDetail>): void => {
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

  private readonly onChatCancel = (event: CustomEvent<MessageIdDetail>): void => {
    void beuveBridge()?.invoke('chat:cancel', { messageId: event.detail.messageId });
  };

  private readonly onChatStage = (event: CustomEvent<MessageIdDetail>): void => {
    void this.stageChatAnswer(event.detail.messageId);
  };

  private readonly onChatStageFinding = (event: CustomEvent<FindingRefDetail>): void => {
    void this.stageReviewFinding(event.detail.messageId, event.detail.finding);
  };

  private readonly onInsightStage = (event: CustomEvent<FindingRefDetail>): void => {
    event.stopPropagation();
    void this.stageReviewFinding(event.detail.messageId, event.detail.finding);
  };

  /** "Show in chat" on a diff note: the chat tab opens at that finding; the diff keeps the focus. */
  private readonly onInsightShowInChat = (event: CustomEvent<FindingRefDetail>): void => {
    event.stopPropagation();
    this.sidebarHidden = false;
    this.sidebarTab = 'chat';
    void this.updateComplete.then(async () => {
      return this.chatDrawer()?.revealFinding(event.detail.messageId, event.detail.finding);
    });
  };

  private readonly onChatClearQueue = (): void => {
    void this.clearChat(true);
  };

  private readonly onChatCite = (event: CustomEvent<ChatCiteDetail>): void => {
    this.openCitation(event.detail.citation);
  };

  private readonly onOpenEditor = (event: CustomEvent<EditorOpenDetail>): void => {
    void this.openInEditor(event.detail.path, event.detail.line);
  };

  /** File Reviewed in the stream: mark the file reviewed or take the mark back (ADR 0064). */
  private readonly onFileReviewed = (event: CustomEvent<FileReviewedDetail>): void => {
    void this.setFileReviewed(event.detail.path, event.detail.reviewed);
  };

  private readonly onActiveFile = (event: CustomEvent<ActiveFileDetail>): void => {
    this.activePath = event.detail.path;
    this.scheduleMenuSync();
  };

  /** Sessions whose chat already suggested /compact in this window. */
  private readonly compactHinted = new Set<string>();

  /** Resolves the wait in {@link loadImpactAfterFirstDiff}; set while it waits. */
  private releaseImpact: (() => void) | undefined;

  private readonly onDiffRendered = (): void => {
    this.releaseImpact?.();
  };

  private readonly onTreeMode = (event: CustomEvent<TreeModeDetail>): void => {
    this.treeMode = event.detail.mode;
  };

  private readonly onTreeSelect = (event: CustomEvent<TreeSelectDetail>): void => {
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
    if (pair.ok) {
      return pair.value;
    }
    return undefined;
  };

  private readonly onUraCreate = (event: CustomEvent<UraCreateRequest>): void => {
    void this.createUraItem(event.detail);
  };

  private readonly onUraUpdate = (event: CustomEvent<UraUpdateDetail>): void => {
    void this.uraCall(async (bridge) => bridge.invoke('ura:update', event.detail));
  };

  /** The dock's "Edit suggestion": the stream opens Suggest Edit on the item's lines (ADR 0043). */
  private readonly onUraEditSuggestion = (event: CustomEvent<UraItemIdDetail>): void => {
    this.jumpNonce += 1;
    this.suggestionJump = { itemId: event.detail.itemId, nonce: this.jumpNonce };
    this.focusedZone = 'diff';
  };

  private readonly onStatusNotice = (event: CustomEvent<StatusNotice>): void => {
    this.showNotice(event.detail);
  };

  private readonly onTrustChoice = (event: CustomEvent<TrustDialogChoice>): void => {
    if (event.detail.action === 'trust') {
      void this.grantTrustFromDialog();
      return;
    }
    this.trustDialog = undefined;
    this.refocusZone();
  };

  /** A notice's button: runs its catalog command as the menu would. */
  private readonly onStatusAction = (event: CustomEvent<StatusNoticeAction>): void => {
    this.statusNotice = undefined;
    this.runAppCommand(event.detail.command);
  };

  /** A display change from the stream: store it, and refetch the diff if whitespace changed. */
  private readonly onDisplayChange = (event: CustomEvent<SetDiffDisplayRequest>): void => {
    void this.setDisplay(event.detail);
  };

  private readonly onUraTransition = (event: CustomEvent<UraTransitionDetail>): void => {
    void this.transitionUraItem(event.detail.itemId, event.detail.to);
  };

  private readonly onUraReorder = (event: CustomEvent<UraReorderDetail>): void => {
    const { review } = this;
    if (review === undefined) {
      return;
    }
    const byId = new Map(
      this.uraItems.map((item) => {
        return [item.id, item];
      }),
    );
    this.uraItems = event.detail.itemIds.flatMap((id) => {
      return byId.get(id) ?? [];
    });
    void this.uraCall(async (bridge) => {
      return bridge.invoke('ura:reorder', {
        sessionId: review.session.id,
        itemIds: event.detail.itemIds,
      });
    });
  };

  private readonly onUraExport = (event: CustomEvent<UraExportDetail>): void => {
    void this.exportUra(event.detail.target);
  };

  private readonly onUraSetVerdict = (event: CustomEvent<UraVerdictDetail>): void => {
    const { review } = this;
    if (review === undefined) {
      return;
    }
    const { verdict } = event.detail;
    void this.uraCall(async (bridge) => {
      return bridge.invoke('ura:set-verdict', {
        sessionId: review.session.id,
        expectedHeadSha: review.headSha,
        ...(verdict !== undefined && { verdict }),
      });
    });
  };

  private readonly onUraJump = (event: CustomEvent<UraJumpDetail>): void => {
    const { placement } = event.detail.item;
    let target = event.detail.item.anchor;
    if (placement.kind === 'current') {
      target = placement.anchor;
    }
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

  private readonly onStageFinding = (event: CustomEvent<StageFindingDetail>): void => {
    const { review } = this;
    if (review === undefined) {
      return;
    }
    void this.uraCall(async (bridge) => {
      return bridge.invoke('ura:stage-impact-finding', {
        sessionId: review.session.id,
        ...event.detail,
      });
    });
  };

  private readonly onPaletteRun = (event: CustomEvent<PaletteRunDetail>): void => {
    this.paletteText = undefined;
    void this.runPaletteAction(event.detail.action);
  };

  private readonly onPaletteClose = (): void => {
    this.closePalette();
  };

  private readonly onOpenClose = (): void => {
    this.cancelOpeningPull();
    this.closeOpenDialog();
  };

  private readonly onOpenPullCancel = (): void => {
    this.cancelOpeningPull();
  };

  /** Stops the pull request fetch in flight, if any; it then ends without a notice (ADR 0079). */
  private readonly cancelOpeningPull = (): void => {
    const requestId = this.pullRequestId;
    if (requestId !== undefined) {
      void beuveBridge()?.invoke('request:cancel', { requestId });
    }
  };

  private readonly onShortcutsClose = (): void => {
    this.overlayOpen = false;
    this.refocusZone();
  };

  private readonly chooseFolder: FolderChooser = async (
    defaultPath: string | undefined,
  ): Promise<string | undefined> => {
    const chosen = await beuveBridge()?.invoke('dialog:choose-folder', {
      ...(defaultPath !== undefined && { defaultPath }),
    });
    if (chosen?.ok === true && chosen.value.kind === 'chosen') {
      return chosen.value.path;
    }
    return undefined;
  };

  private readonly inspectRepository: RepositoryInspector = async (path) => {
    return (
      (await beuveBridge()?.invoke('repository:inspect', { path })) ?? {
        ok: false,
        error: { code: 'not-wired', message: 'no Electron bridge' },
      }
    );
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
    showInsights: true,
    reviewOrder: 'path',
    skipReviewed: false,
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
  /** The review's reviewed marks by path and their counts (ADR 0064), kept apart from `review`. */
  @state() accessor reviewMarks: ReadonlyMap<string, FileReviewStateView> = new Map();
  @state() accessor reviewProgress: FileReviewProgressView | undefined;
  /** The review's reading order (ADR 0065), once `session:get-order` answers for its head. */
  @state() accessor order: ReviewOrderView | undefined;
  @state() accessor impact: ImpactView | undefined;
  @state() accessor peek: PeekState | undefined;
  /** The sheet shown over the diff with `/sheets inline` (ADR 0067). */
  @state() accessor inlineSheet: { readonly sha: string; readonly place: SheetPlace } | undefined;
  /** The control-flow portal; at most one of `peek` and `flow` is open at a time. */
  @state() accessor flow: FlowState | undefined;
  /** The trace timeline portal; at most one of `peek`, `flow` and `trace` is open at a time. */
  @state() accessor trace: TraceState | undefined;
  @state() accessor reviewLoading = false;
  @state() accessor reviewError = '';
  @state() accessor marking = false;
  /** The checkpoint Save Progress recorded in this window, for the header's quiet status. */
  @state() accessor savedProgress:
    { readonly sessionId: string; readonly sha: string; readonly at: Temporal.Instant } | undefined;
  @state() accessor opening = false;
  @state() accessor localFailure: OpenFailure | undefined;
  @state() accessor chat: ChatTranscript = emptyChatTranscript;
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
  /** The terminal panel under the diff (ADR 0095); its shells run on while it is hidden. */
  @state() accessor terminalShown = false;
  @state() accessor isTerminalFocused = false;
  /** The sidebar tab on show: intent and files, the review or the chat. */
  @state() accessor sidebarTab: SidebarZone = 'intent';
  @state() accessor openDialog = false;

  /** The trust prompt, the safeguard's question or the install log, when one is open. */
  /** The trust prompt (ADR 0090), while it is open. */
  @state() accessor trustDialog: TrustView | undefined;
  /** The palette's starting text while it is open. */
  @state() accessor paletteText: string | undefined;
  @state() accessor githubPost: GithubPostState = { kind: 'idle' };
  @state() accessor reviewEdits: ReviewEditsView | undefined;
  @state() accessor reviewEditsFlow: ReviewEditsFlow = { kind: 'idle' };

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
    addEventListener('focus', this.onWindowFocus);
    this.addEventListener('focusin', this.onFocusIn);
    this.addEventListener('focusout', this.onFocusOut);
    this.addEventListener('contextmenu', this.onContextMenu);
    const bridge = beuveBridge();
    if (bridge === undefined) {
      this.sessionNote = 'Running without the Electron bridge.';
      return;
    }
    this.unsubscribes = [
      bridge.on('mcp:status', (status) => {
        this.mcpStatus = status;
      }),
      bridge.on('chat:stream', (event) => {
        this.applyChatStream(event);
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
      bridge.on('menu:run', ({ id }) => {
        this.runCommandId(id);
      }),
      bridge.on('settings:changed', () => {
        void this.reloadSettings();
      }),
    ];
    void this.loadInitialState();
  }

  private disconnect(): void {
    removeEventListener('focus', this.onWindowFocus);
    this.removeEventListener('focusin', this.onFocusIn);
    this.removeEventListener('focusout', this.onFocusOut);
    this.removeEventListener('contextmenu', this.onContextMenu);
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
    this.editorSettings = undefined;
    if (editors.ok) {
      this.editorSettings = editors.value;
    }
    const display = await bridge.invoke('display:get');
    if (display.ok) {
      this.applyDisplay(display.value);
    }
    await this.loadGithubAuth(undefined);
  }

  /** `settings:changed`: the Settings window changed a preference; read them again. */
  private async reloadSettings(): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const [display, editors] = await Promise.all([
      bridge.invoke('display:get'),
      bridge.invoke('editor:get-settings'),
    ]);
    if (display.ok) {
      this.applyDisplay(display.value);
    }
    if (editors.ok) {
      this.editorSettings = editors.value;
    }
  }

  /** Who beuve posts to GitHub as; `host` defaults to the open pull request's. */
  private async loadGithubAuth(host: string | undefined): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const auth = await bridge.invoke('github:auth-status', {
      ...(host !== undefined && { host }),
    });
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
    const requestId = crypto.randomUUID();
    this.pullRequestId = requestId;
    const opened = await bridge.invoke('github:open-pr', { ...request, requestId });
    this.openingPull = false;
    this.pullRequestId = undefined;
    if (!opened.ok && opened.error.code === 'cancelled') {
      return;
    }
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

  /** A chat answer's link: main opens any http(s) URL in the browser (ADR 0040, amended). */
  private async openUrl(url: string): Promise<void> {
    const opened = await beuveBridge()?.invoke('shell:open-url', { url });
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
    const attention = event.attention ?? this.pullRequest?.attention;
    this.pullRequest = {
      sessionId: event.sessionId,
      pullRequest: event.pullRequest,
      stack: event.stack,
      ...(this.ci !== undefined && { ci: this.ci }),
      ...(attention !== undefined && { attention }),
    };
    if (!event.headMoved) {
      return;
    }
    this.invalidateGithubPost();
    this.showNotice({
      tone: 'info',
      text: `New commits on #${String(event.pullRequest.number)}; the review now shows what changed.`,
    });
    void this.selectSession(event.sessionId);
  }

  /**
   * A confirmation (or the own-PR offer) was about the head the reviewer saw; once the head moves
   * it would post on commits they haven't read, so it gives way to a quiet note (ADR 0078).
   */
  private invalidateGithubPost(): void {
    const { kind } = this.githubPost;
    if (kind === 'confirm' || kind === 'own-pull-request') {
      this.githubPost = { kind: 'head-moved' };
    }
  }

  /** Main refused because the head moved: say so quietly and show the new commits. */
  private onGithubHeadMoved(sessionId: string): void {
    this.githubPost = { kind: 'head-moved' };
    void this.selectSession(sessionId);
  }

  /** The confirmation step: main compiles the review and says what goes inline and in the body. */
  private async previewGithubReview(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined || this.githubPost.kind === 'busy') {
      return;
    }
    this.githubPost = { kind: 'busy', text: 'Compiling the review…' };
    const preview = await bridge.invoke('github:preview-review', {
      sessionId: review.session.id,
      expectedHeadSha: review.headSha,
    });
    if (this.review?.session.id !== review.session.id) {
      return;
    }
    if (!preview.ok) {
      this.githubPost = { kind: 'failed', text: preview.error.message };
      return;
    }
    if ('kind' in preview.value) {
      if (preview.value.failure === 'head-moved') {
        this.onGithubHeadMoved(review.session.id);
        return;
      }
      this.githubPost = { kind: 'failed', text: preview.value.message };
      return;
    }
    if (this.review.headSha !== preview.value.headSha) {
      this.githubPost = { kind: 'head-moved' };
      return;
    }
    this.githubPost = { kind: 'confirm', preview: preview.value };
  }

  /** Posts on the head the confirmation showed; one post at a time (ADR 0078). */
  private async postGithubReview(verdict: UraVerdictView | undefined): Promise<void> {
    const bridge = beuveBridge();
    const { review, githubPost } = this;
    if (bridge === undefined || review === undefined || githubPost.kind === 'busy') {
      return;
    }
    let expectedHeadSha = review.headSha;
    if (githubPost.kind === 'confirm') {
      expectedHeadSha = githubPost.preview.headSha;
    }
    this.githubPost = { kind: 'busy', text: 'Posting to GitHub…' };
    const posted = await bridge.invoke('github:post-review', {
      sessionId: review.session.id,
      expectedHeadSha,
      ...(verdict !== undefined && { verdict }),
    });
    if (this.review?.session.id !== review.session.id) {
      return;
    }
    if (!posted.ok) {
      this.githubPost = { kind: 'failed', text: posted.error.message };
      return;
    }
    const result = posted.value;
    if (result.kind === 'failed') {
      if (result.failure === 'head-moved') {
        this.onGithubHeadMoved(review.session.id);
        return;
      }
      if (result.failure === 'own-pull-request') {
        this.githubPost = { kind: 'own-pull-request', message: result.message };
      } else {
        this.githubPost = { kind: 'failed', text: result.message };
      }
      return;
    }
    let moved = '';
    if (result.movedToBody > 0) {
      moved = ` GitHub refused ${String(result.movedToBody)} inline, so they went into the body.`;
    }
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

  private async loadReviewEdits(sessionId: string): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const loaded = await bridge.invoke('review-edits:get', { sessionId });
    if (this.review?.session.id !== sessionId) {
      return;
    }
    if (loaded.ok) {
      this.reviewEdits = loaded.value;
    }
  }

  /** Where Open Review Edits opens: the tree's file, else the diff's line, else the first file. */
  private reviewEditsLocation(review: ReviewView): EditorPlace | undefined {
    const treePath = this.treePath();
    if (treePath !== undefined) {
      return { path: treePath, line: 1 };
    }
    const target = this.stream()?.target();
    if (target !== undefined && target.kind !== 'change') {
      return { path: target.file.path, line: lineFromTarget(target) ?? 1 };
    }
    const first = review.files.find((file) => file.status !== 'deleted');
    if (first === undefined) {
      return undefined;
    }
    return { path: first.path, line: 1 };
  }

  /** Open Review Edits (ADR 0088): the writable branch, made on first use, in the editor. */
  private async openReviewEdits(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    this.reviewEditsFlow = clearReviewEditsStatus(this.reviewEditsFlow);
    const place = this.reviewEditsLocation(review);
    const opened = await bridge.invoke('review-edits:open', {
      sessionId: review.session.id,
      ...(place !== undefined && place),
    });
    if (!opened.ok) {
      this.showNotice({ tone: 'error', text: opened.error.message });
      return;
    }
    let made = '';
    if (opened.value.created) {
      made = ', a new local branch beuve never pushes';
    }
    this.showNotice({
      tone: 'info',
      text: `Opened review edits on ${revealFormatControls(opened.value.branch)}${made}, in ${opened.value.editorName}.`,
    });
    await this.loadReviewEdits(review.session.id);
  }

  /** Turn Edits into Suggestions, step one: what staging would do, to confirm. */
  private async previewReviewEdits(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined || this.reviewEditsFlow.kind === 'busy') {
      return;
    }
    this.reviewEditsFlow = { kind: 'busy', text: 'Reading the review edits…' };
    const plan = await bridge.invoke('review-edits:preview-suggestions', {
      sessionId: review.session.id,
    });
    if (this.review?.session.id !== review.session.id) {
      return;
    }
    if (plan.ok) {
      this.reviewEditsFlow = { kind: 'preview', plan: plan.value };
    } else {
      this.reviewEditsFlow = { kind: 'failed', text: plan.error.message };
    }
  }

  /** Step two: stage exactly the previewed plan; main refuses if the edits changed since. */
  private async stageReviewEdits(): Promise<void> {
    const bridge = beuveBridge();
    const { review, reviewEditsFlow: flow } = this;
    if (bridge === undefined || review === undefined || flow.kind !== 'preview') {
      return;
    }
    this.reviewEditsFlow = { kind: 'busy', text: 'Staging…' };
    const staged = await bridge.invoke('review-edits:stage-suggestions', {
      sessionId: review.session.id,
      digest: flow.plan.digest,
    });
    if (this.review?.session.id !== review.session.id) {
      return;
    }
    if (!staged.ok) {
      this.reviewEditsFlow = { kind: 'failed', text: staged.error.message };
      return;
    }
    const { created, attached, updated, unchanged } = staged.value;
    this.reviewEditsFlow = {
      kind: 'done',
      text: `Staged: ${String(created)} new, ${String(attached)} attached to notes, ${String(updated)} updated, ${String(unchanged)} already there.`,
    };
    void this.refreshUra(review.session.id);
  }

  /** Discard Review Edits, step one: what would be lost. */
  private async previewDiscardReviewEdits(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined || this.reviewEditsFlow.kind === 'busy') {
      return;
    }
    this.reviewEditsFlow = { kind: 'busy', text: 'Reading what Discard would remove…' };
    const loss = await bridge.invoke('review-edits:preview-discard', {
      sessionId: review.session.id,
    });
    if (this.review?.session.id !== review.session.id) {
      return;
    }
    if (loss.ok) {
      this.reviewEditsFlow = { kind: 'discard', loss: loss.value };
    } else {
      this.reviewEditsFlow = { kind: 'failed', text: loss.error.message };
    }
  }

  private async discardReviewEdits(): Promise<void> {
    const bridge = beuveBridge();
    const { review, reviewEditsFlow: flow } = this;
    if (bridge === undefined || review === undefined || flow.kind !== 'discard') {
      return;
    }
    this.reviewEditsFlow = { kind: 'busy', text: 'Discarding…' };
    const discarded = await bridge.invoke('review-edits:discard', {
      sessionId: review.session.id,
      digest: flow.loss.digest,
    });
    if (this.review?.session.id !== review.session.id) {
      return;
    }
    if (discarded.ok) {
      this.reviewEditsFlow = {
        kind: 'done',
        text: `Discarded ${revealFormatControls(discarded.value.branch)}.`,
      };
    } else {
      this.reviewEditsFlow = { kind: 'failed', text: discarded.error.message };
    }
    await this.loadReviewEdits(review.session.id);
  }

  /** Open in Editor: opens the head-side file in the reviewer's editor (ADR 0033). */
  private async openInEditor(path: string, line: number): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    const opened = await bridge.invoke('editor:open', { sessionId: review.session.id, path, line });
    if (opened.ok) {
      this.showNotice(describeEditorOpen(opened.value));
    } else {
      this.showNotice({ tone: 'error', text: opened.error.message });
    }
  }

  private applyDisplay(display: DiffDisplayView): void {
    const isWhitespaceChanged = display.ignoreWhitespace !== this.display.ignoreWhitespace;
    const isOrderChanged = display.reviewOrder !== this.display.reviewOrder;
    this.display = display;
    if (isOrderChanged && !isWhitespaceChanged && this.review !== undefined) {
      void this.loadOrder(this.review);
    }
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
    let result: IpcResult<DiffDisplayView>;
    if (Object.keys(change).length === 0) {
      result = await bridge.invoke('display:get');
    } else {
      result = await bridge.invoke('display:set', change);
    }
    if (!result.ok) {
      this.showNotice({ tone: 'error', text: result.error.message });
      return undefined;
    }
    this.applyDisplay(result.value);
    if (change.showGenerated !== undefined) {
      this.showNotice({ tone: 'info', text: describeGenerated(result.value.showGenerated) });
    }
    if (change.showInsights !== undefined) {
      this.showNotice({ tone: 'info', text: describeInsights(result.value.showInsights) });
    }
    if (change.skipReviewed !== undefined) {
      this.showNotice({ tone: 'info', text: describeSkipReviewed(result.value.skipReviewed) });
    }
    if (change.reviewOrder !== undefined) {
      this.showNotice({ tone: 'info', text: describeOrder(result.value.reviewOrder) });
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

  /** `/editor [id]`: shows or sets the editor Open in Editor opens. */
  private async runEditorCommand(editorId: EditorId | undefined): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    let result: IpcResult<EditorSettingsView>;
    if (editorId === undefined) {
      result = await bridge.invoke('editor:get-settings');
    } else {
      result = await bridge.invoke('editor:set-preferred', { editorId });
    }
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
    if (bridge === undefined) {
      return { ok: false, error: { code: 'not-wired', message: 'no Electron bridge' } };
    }
    return bridge.invoke('session:list');
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
    let shownHead: string | undefined;
    if (this.review?.session.id === sessionId) {
      shownHead = this.review.headSha;
    }
    if (sessionId === this.selectedId) {
      this.reviewEditsFlow = clearReviewEditsStatus(this.reviewEditsFlow);
    } else {
      this.review = undefined;
      this.order = undefined;
      this.tree = undefined;
      this.fileAttributes = undefined;
      this.uraItems = [];
      this.chosenVerdict = undefined;
      this.verdictNotice = '';
      this.dockNotice = undefined;
      this.chat = emptyChatTranscript;
      this.pullRequest = undefined;
      this.ci = undefined;
      this.trustDialog = undefined;
      this.githubPost = { kind: 'idle' };
      this.reviewEdits = undefined;
      this.reviewEditsFlow = { kind: 'idle' };
    }
    this.selectedId = sessionId;
    this.reviewLoading = true;
    this.reviewError = '';
    const review = await bridge.invoke('session:get-review', {
      sessionId,
      ignoreWhitespace: this.display.ignoreWhitespace,
    });
    // A newer load of this window superseded this one (ADR 0079); that one will answer.
    if (sessionId !== this.selectedId || (!review.ok && review.error.code === 'cancelled')) {
      return;
    }
    this.reviewLoading = false;
    this.peek = undefined;
    this.flow = undefined;
    this.closeTrace();
    if (review.ok) {
      if (shownHead !== undefined && shownHead !== review.value.headSha) {
        this.invalidateGithubPost();
      }
      this.review = review.value;
      this.applyMarks(review.value);
      this.focusedZone = 'diff';
      if (this.sessions.every(({ id }) => id !== sessionId)) {
        void this.refreshSessions();
      }
      void this.loadImpactAfterFirstDiff(review.value);
      void this.loadTree(review.value);
      void this.loadOrder(review.value);
      void this.loadFileAttributes(review.value);
      void this.refreshUra(review.value.session.id);
      void this.loadReviewEdits(review.value.session.id);
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
      const timer = setTimeout(resolve, impactGrace.total('milliseconds'));
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
    this.impact = undefined;
    if (impact.ok && impact.value.headSha === review.headSha) {
      this.impact = impact.value;
    }
  }

  private applyMarks(review: ReviewView): void {
    this.reviewMarks = new Map(
      review.files.map((file) => {
        return [file.path, file.reviewed ?? 'no'];
      }),
    );
    this.reviewProgress = review.reviewProgress;
  }

  /** File Reviewed: stores the mark against the head the reviewer sees; a moved head says so. */
  private async setFileReviewed(path: string, isReviewed: boolean): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    const marked = await bridge.invoke('review:set-file-reviewed', {
      sessionId: review.session.id,
      path,
      reviewed: isReviewed,
      expectedHeadSha: review.headSha,
    });
    if (this.review !== review) {
      return;
    }
    if (!marked.ok) {
      this.showNotice({ tone: 'error', text: marked.error.message });
      return;
    }
    this.reviewMarks = new Map(this.reviewMarks).set(path, marked.value.reviewed);
    this.reviewProgress = marked.value.progress;
  }

  /** The files' reading order (ADR 0065) in the saved mode; `calls` may take a moment. */
  private async loadOrder(review: ReviewView): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined || review.files.length === 0) {
      return;
    }
    const mode = this.display.reviewOrder;
    const order = await bridge.invoke('session:get-order', { sessionId: review.session.id });
    const isSuperseded = !order.ok && order.error.code === 'cancelled';
    if (isSuperseded || this.review !== review || mode !== this.display.reviewOrder) {
      return;
    }
    if (order.ok) {
      this.order = order.value;
    } else {
      this.order = undefined;
      this.showNotice({ tone: 'error', text: `File order: ${order.error.message}` });
    }
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
    let attributes = this.fileAttributes;
    if (attributes?.headSha !== this.review?.headSha) {
      attributes = undefined;
    }
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
      expectedHeadSha: review.headSha,
      path,
      line,
      direction: 'incoming',
    });
    if (this.peek !== pending || this.review !== review) {
      return;
    }
    this.peek = peekStateFrom(path, line, answer);
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
    this.flow = flowStateFrom(path, line, answer);
  }

  /** Run Trace Probe: runs the tests covering the hunk with tracing; the portal follows `trace:status`. */
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
    const trusted = await bridge.invoke('trust:set', {
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
      const took = formatIsoDuration(next.result.duration);
      if (next.note === undefined) {
        this.showNotice({
          tone: 'info',
          text: `Trace ready: ${countNoun(tests, 'test')} in ${took}.`,
        });
      } else {
        this.showNotice({ tone: 'error', text: `Trace ready, but some tests failed (${took}).` });
      }
    } else if (next?.status === 'error') {
      this.showNotice({ tone: 'error', text: `Trace probe: ${next.message}` });
    }
  }

  /** Trust Repository…: the one grant's prompt (ADR 0090), for the open session's repository. */
  private async openTrustDialog(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      this.showNotice({ tone: 'error', text: 'Open a review session first.' });
      return;
    }
    const trust = await bridge.invoke('trust:get', { sessionId: review.session.id });
    if (!trust.ok) {
      this.showNotice({ tone: 'error', text: trust.error.message });
      return;
    }
    if (trust.value.trusted) {
      this.showNotice({
        tone: 'info',
        text: `${revealFormatControls(trust.value.repositoryPath)} is already trusted. Stop Trusting Repository withdraws it.`,
      });
      return;
    }
    this.trustDialog = trust.value;
  }

  private async grantTrustFromDialog(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    this.trustDialog = undefined;
    if (bridge === undefined || review === undefined) {
      return;
    }
    const trusted = await bridge.invoke('trust:set', {
      sessionId: review.session.id,
      trusted: true,
    });
    if (!trusted.ok) {
      this.showNotice({ tone: 'error', text: trusted.error.message });
      return;
    }
    this.showNotice({
      tone: 'info',
      text: `Trusted ${revealFormatControls(trusted.value.repositoryPath)}: beuve may run its tests.`,
    });
  }

  /** Restart Language Servers: the head checkout's servers start afresh on the next request. */
  private async restartLanguageServers(): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    const restarted = await bridge.invoke('lsp:restart', { sessionId: review.session.id });
    if (restarted.ok) {
      this.showNotice({ tone: 'info', text: 'Language servers restarted for this head.' });
    } else if (restarted.error.code !== 'cancelled') {
      this.showNotice({ tone: 'error', text: restarted.error.message });
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
    const before = await bridge.invoke('trust:get', { sessionId });
    if (!before.ok) {
      this.note('error', before.error.message);
      return;
    }
    const { repositoryPath } = before.value;
    if (before.value.trusted === isTrusting) {
      if (isTrusting) {
        this.note('info', `${repositoryPath} is already trusted. /untrust withdraws it.`);
      } else {
        this.note('info', `${repositoryPath} is not trusted.`);
      }
      return;
    }
    const changed = await bridge.invoke('trust:set', { sessionId, trusted: isTrusting });
    if (!changed.ok) {
      this.note('error', changed.error.message);
      return;
    }
    if (isTrusting) {
      this.note(
        'info',
        `Trusted ${repositoryPath}.`,
        'beuve may now run this repository’s tests on this machine. /untrust withdraws this.',
      );
    } else {
      this.note('info', `No longer trusting ${repositoryPath}. Trace probes will ask again.`);
    }
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
    const withChildren = (state: PeekState, children: PeekChildren): PeekState => {
      if (state.status === 'ready') {
        return { ...state, children: new Map(state.children).set(nodeId, children) };
      }
      return state;
    };
    this.peek = withChildren(peek, { status: 'loading' });
    const answer = await bridge.invoke('lsp:call-hierarchy', {
      sessionId: review.session.id,
      expectedHeadSha: review.headSha,
      path: peek.path,
      line: peek.line ?? 1,
      direction: 'incoming',
      nodeId,
    });
    const current = this.currentPeek();
    if (current?.status !== 'ready' || current.root.id !== peek.root.id) {
      return;
    }
    if (answer.ok) {
      this.peek = withChildren(current, { status: 'ready', calls: answer.value.calls });
    } else {
      this.peek = withChildren(current, { status: 'error', message: answer.error.message });
    }
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
    this.savedProgress = {
      sessionId: review.session.id,
      sha: review.headSha,
      at: Temporal.Now.instant(),
    };
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
        void this.clearChat(command.queuedOnly);
        return;
      }
      case 'summarize': {
        void this.runChatCommand(text.trim(), { kind: 'summarize' });
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
        void this.runDisplayCommand({
          ...(command.layout !== undefined && { layout: command.layout }),
        });
        return;
      }
      case 'generated': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.setDisplay({
          ...(command.showGenerated !== undefined && { showGenerated: command.showGenerated }),
        }).then((display) => {
          if (display !== undefined) {
            this.note('info', `${describeGenerated(display.showGenerated)}.`);
          }
        });
        return;
      }
      case 'sheets': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.setDisplay({ ...(command.mode !== undefined && { sheets: command.mode }) }).then(
          (display) => {
            if (display !== undefined) {
              this.note('info', describeSheets(display.sheets));
            }
          },
        );
        return;
      }
      case 'insights': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.setDisplay({
          ...(command.showInsights !== undefined && { showInsights: command.showInsights }),
        }).then((display) => {
          if (display !== undefined) {
            this.note('info', `${describeInsights(display.showInsights)}.`);
          }
        });
        return;
      }
      case 'whitespace': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.runDisplayCommand({
          ...(command.ignoreWhitespace !== undefined && {
            ignoreWhitespace: command.ignoreWhitespace,
          }),
        });
        return;
      }
      case 'trust':
      case 'untrust': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.runTrustCommand(command.kind === 'trust');
        return;
      }
      case 'review': {
        void this.runChatCommand(text.trim(), {
          kind: 'review',
          ...(command.pathPrefixes.length > 0 && { pathPrefixes: command.pathPrefixes }),
          ...(command.fresh && { fresh: true }),
          ...(!command.verify && { verify: false }),
          ...(command.effort !== undefined && { effort: command.effort }),
        });
        return;
      }
      case 'order': {
        this.addEntry({ id: 0, kind: 'input', text: text.trim() });
        void this.setDisplay({
          ...(command.mode !== undefined && { reviewOrder: command.mode }),
        }).then((display) => {
          if (display !== undefined) {
            this.note('info', `${describeOrder(display.reviewOrder)}.`);
          }
        });
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

  private setEntries(entries: readonly ChatEntry[]): void {
    this.chat = { ...this.chat, entries };
  }

  private dispatchChat(action: ChatTranscriptAction): void {
    this.chat = reduceChatTranscript(this.chat, action);
  }

  /** One `chat:stream` event (ADR 0072): the reducer builds the transcript from it. */
  private applyChatStream(event: ChatStreamEvent): void {
    if (event.sessionId !== this.review?.session.id) {
      return;
    }
    this.dispatchChat({ kind: 'stream', event });
    if (
      event.type !== 'message' ||
      event.droppedTurns === undefined ||
      this.compactHinted.has(event.sessionId)
    ) {
      return;
    }
    this.compactHinted.add(event.sessionId);
    this.note('info', 'Older turns are being dropped — /compact to keep a summary.');
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
    let focusPath: string | undefined;
    if (review.files.some((file) => file.path === this.activePath)) {
      focusPath = this.activePath;
    }
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
    let failure: string | undefined;
    if (!compacted.ok) {
      failure = compacted.error.message;
    } else if (compacted.value.outcome === 'failed') {
      failure = compacted.value.errorMessage;
    }
    this.setEntries(
      this.chat.entries.flatMap((entry): ChatEntry[] => {
        if (entry.id !== entryId || entry.kind !== 'compaction') {
          return [entry];
        }
        if (failure === undefined) {
          return [
            {
              id: entryId,
              kind: 'note',
              tone: 'info',
              lines: ['Compaction stopped; nothing was stored.'],
            },
          ];
        }
        return [{ ...entry, status: 'failed', message: failure }];
      }),
    );
  }

  /**
   * `/review` and `/summarize` (ADR 0055, 0056): chat requests like a question, so they queue
   * behind a running answer and land in the transcript as structured or calm answers.
   */
  private async runChatCommand(typed: string, command: ChatCommandRequest): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      this.addEntry({ id: 0, kind: 'input', text: typed });
      this.note('error', `Open a review session first, then type ${typed.split(' ', 1)[0] ?? ''}.`);
      return;
    }
    const asked = await bridge.invoke('chat:ask', {
      sessionId: review.session.id,
      question: typed,
      command,
    });
    if (!asked.ok) {
      this.addEntry({ id: 0, kind: 'input', text: typed });
      this.note('error', asked.error.message);
      return;
    }
    if (this.review?.session.id === review.session.id) {
      this.dispatchChat({ kind: 'asked', ...asked.value });
    }
  }

  /** `/clear` deletes the transcript; `/clear queue` and the queue's button only what waits. */
  private async clearChat(isQueueOnly = false): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      if (!isQueueOnly) {
        this.chat = emptyChatTranscript;
      }
      return;
    }
    const sessionId = review.session.id;
    const cleared = await bridge.invoke('chat:clear', {
      sessionId,
      ...(isQueueOnly && { queuedOnly: true }),
    });
    if (!cleared.ok) {
      this.note('error', cleared.error.message);
    } else if (isQueueOnly) {
      await this.loadChat(sessionId);
    } else {
      this.dispatchChat({ kind: 'cleared' });
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

  /** Stages one `/review` finding on its lines; main reads it from the stored answer. */
  private async stageReviewFinding(messageId: string, finding: number): Promise<void> {
    if (this.stagedFindings().has(`${messageId}:${String(finding)}`)) {
      return;
    }
    await this.uraCall(async (bridge) => {
      const staged = await bridge.invoke('ura:stage-review-finding', { messageId, finding });
      if (staged.ok) {
        const { title } = staged.value.item;
        let text = `“${title}” is already staged.`;
        if (staged.value.created) {
          text = `Staged “${title}”.`;
        }
        this.dockNotice = { tone: 'info', text };
      }
      return staged;
    });
  }

  private chatDrawer(): BeuveChatDrawer | undefined {
    return this.renderRoot.querySelector<BeuveChatDrawer>('beuve-chat-drawer') ?? undefined;
  }

  /**
   * Add to Chat (ADR 0046): what the focused region points at becomes a chip in the chat input. The diff
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
      if (action?.kind !== 'ura-item') {
        return 'Pick a file or a staged note in the palette first.';
      }
      const item = this.uraItems.find(({ id }) => id === action.itemId);
      if (item === undefined) {
        return 'Pick a file or a staged note in the palette first.';
      }
      return this.itemTarget(item);
    }
    switch (this.focusedZone) {
      case 'ura': {
        const item = this.renderRoot.querySelector<BeuveUraDock>('beuve-ura-dock')?.cursorItem();
        if (item === undefined) {
          return nothingSelected;
        }
        return this.itemTarget(item);
      }
      case 'intent': {
        const path = this.renderRoot
          .querySelector<BeuveIntentSidebar>('beuve-intent-sidebar')
          ?.focusedPath();
        if (path === undefined) {
          return 'Focus a file in the tree to add it.';
        }
        return { path, side: 'head' };
      }
      default: {
        return (
          this.renderRoot.querySelector<BeuveDiffStream>('beuve-diff-stream')?.chatMention() ??
          nothingSelected
        );
      }
    }
  }

  /** A staged note's lines at this head, or its file, through the diff's own adapter (ADR 0063). */
  private itemTarget(item: UraItemView): MentionTarget | string {
    if (item.placement.kind !== 'current') {
      return 'That note is outdated: its lines are not at this head.';
    }
    const target = targetFromAnchor(item.placement.anchor, this.review?.files ?? []);
    if (target === undefined) {
      return 'That note’s file is not in this diff.';
    }
    return (
      mentionFromTarget(target) ?? 'That note is on the whole change; pick a line or file note.'
    );
  }

  /** Adds a chip for `target` at the review's head (or base) and focuses the chat input. */
  private async addToChat(target: MentionTarget): Promise<void> {
    const { review } = this;
    if (review === undefined) {
      return;
    }
    let sha = review.headSha;
    if (target.side === 'base') {
      sha = review.baseSha;
    }
    const mention: ChatMentionView = { ...target, sha };
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
    const file = this.review?.files.find((candidate) => {
      if (mention.side === 'base') {
        return (
          (candidate.oldPath ?? candidate.path) === mention.path && candidate.status !== 'added'
        );
      }
      return candidate.path === mention.path && candidate.status !== 'deleted';
    });
    if (file === undefined) {
      this.note(
        'info',
        `${revealFormatControls(mention.path)} is not in this diff: the file is unchanged by the review.`,
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
      let lines = String(startLine);
      if (startLine !== endLine) {
        lines += `-${String(endLine)}`;
      }
      this.note(
        'info',
        `${revealFormatControls(path)}:${lines} is not in this diff: the file is unchanged by the review.`,
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
      this.uraItems.flatMap((item) => {
        if (
          item.origin.kind === 'chat-answer' &&
          item.origin.finding === undefined &&
          item.status.kind === 'staged'
        ) {
          return item.origin.messageId;
        }
        return [];
      }),
    );
  }

  /**
   * The `/review` findings to show on the diff (ADR 0061): the head's completed review answers
   * merged, minus the staged ones. Recomputed only when its inputs change, so the cards keep the
   * same objects while chat text streams (ADR 0050).
   */
  private reviewInsights(): readonly ReviewInsight[] {
    const { review } = this;
    if (review === undefined || !this.display.showInsights) {
      return noInsights;
    }
    const messages = this.chat.entries.flatMap((entry): ChatMessageView[] => {
      if (entry.kind === 'message' && entry.message.review !== undefined) {
        return [entry.message];
      }
      return [];
    });
    const staged = this.stagedFindings();
    const signature = [
      review.headSha,
      messages.map(({ id }) => id).join(','),
      [...staged].toSorted((x, y) => x.localeCompare(y)).join(','),
    ].join('|');
    if (this.insightCache?.signature !== signature) {
      this.insightCache = {
        signature,
        insights: withoutStagedInsights(mergeReviewInsights(messages, review.headSha), staged),
      };
    }
    return this.insightCache.insights;
  }

  /** `/review` findings staged and still staged, as `messageId:index`. */
  private stagedFindings(): ReadonlySet<string> {
    return new Set(
      this.uraItems.flatMap((item) => {
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
    if (!created.ok) {
      request.settle(created.error.message);
      return;
    }
    request.settle(undefined);
    this.dockNotice = { tone: 'info', text: `Staged “${created.value.title}”.` };
  }

  private async transitionUraItem(
    itemId: string,
    to: 'staged' | 'withdrawn' | 'addressed',
  ): Promise<void> {
    await this.uraCall(async (bridge) => {
      return bridge.invoke('ura:transition', { itemId, to });
    });
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

  /** A moved head (`stale-review`) is expected, so it reads as a quiet note, not an error. */
  private noteFailure(result: IpcResult<unknown>): void {
    if (result.ok) {
      return;
    }
    if (result.error.code === 'stale-review') {
      this.dockNotice = { tone: 'info', text: result.error.message };
    } else {
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
    if (!copied.ok) {
      this.dockNotice = { tone: 'error', text: `Could not copy: ${copied.error.message}` };
      return;
    }
    const counts = [countNoun(itemCount, 'item')];
    if (outdatedCount > 0) {
      counts.push(`${String(outdatedCount)} outdated`);
    }
    counts.push(formatBytes(compiled.value.text.length));
    this.dockNotice = {
      tone: 'info',
      text: `Copied ${exportLabels[target]}: ${counts.join(', ')}.`,
    };
  }

  /** Runs a catalog command `beuve-app` handles itself (ADR 0068). */
  private runAppCommand(id: CommandId): void {
    if (this.runSheetCommand(id)) {
      return;
    }
    switch (id) {
      case 'open': {
        this.paletteText = undefined;
        this.showOpenDialog();
        return;
      }
      case 'palette':
      case 'go-to-file': {
        if (this.paletteText !== undefined) {
          this.closePalette();
          return;
        }
        this.openDialog = false;
        this.overlayOpen = false;
        this.paletteText = paletteOpenings[id];
        return;
      }
      case 'cycle-zone': {
        this.focusedZone = cycleZone(this.zoneOrder(), this.focusedZone, 1);
        this.refocusZone();
        return;
      }
      case 'cycle-zone-back': {
        this.focusedZone = cycleZone(this.zoneOrder(), this.focusedZone, -1);
        this.refocusZone();
        return;
      }
      case 'shortcuts': {
        this.overlayOpen = !this.overlayOpen;
        if (this.overlayOpen) {
          void this.updateComplete.then(() => {
            this.renderRoot
              .querySelector('beuve-keybinding-overlay')
              ?.shadowRoot?.querySelector<HTMLElement>('.panel')
              ?.focus();
          });
        }
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
        if (this.treeMode === 'diff-only') {
          this.treeMode = 'neighborhood';
        } else {
          this.treeMode = 'diff-only';
        }
        return;
      }
      case 'toggle-terminal': {
        this.terminalShown = !this.terminalShown;
        if (this.terminalShown) {
          // xterm is large: it loads when the panel first opens (ADR 0095).
          void import('./beuve-terminal-panel.ts');
        } else {
          this.isTerminalFocused = false;
        }
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
        void this.setSidebarSide(otherSides[this.sidebarSide]);
        return;
      }
      case 'sidebar-left': {
        void this.setSidebarSide('left');
        return;
      }
      case 'sidebar-right': {
        void this.setSidebarSide('right');
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
        void this.stream()?.openFind();
        return;
      }
      case 'find-next':
      case 'find-previous':
      case 'find-selection':
      case 'find-match-case': {
        this.stream()?.runCommand(id);
        return;
      }
      case 'diff-split': {
        void this.setDisplay({ layout: 'split' });
        return;
      }
      case 'diff-inline': {
        void this.setDisplay({ layout: 'unified' });
        return;
      }
      case 'whitespace': {
        void this.setDisplay({ ignoreWhitespace: !this.display.ignoreWhitespace });
        return;
      }
      case 'toggle-generated': {
        void this.setDisplay({ showGenerated: !this.display.showGenerated });
        return;
      }
      case 'toggle-insights': {
        void this.setDisplay({ showInsights: !this.display.showInsights });
        return;
      }
      case 'toggle-skip-reviewed': {
        void this.setDisplay({ skipReviewed: this.display.skipReviewed !== true });
        return;
      }
      case 'order-path':
      case 'order-imports':
      case 'order-calls': {
        void this.setDisplay({ reviewOrder: orderActions[id] });
        return;
      }
      case 'sheets-window': {
        void this.setDisplay({ sheets: 'window' });
        return;
      }
      case 'sheets-inline': {
        void this.setDisplay({ sheets: 'inline' });
        return;
      }
      case 'editor-zed':
      case 'editor-vscode':
      case 'editor-cursor': {
        void this.setPreferredEditor(editorActions[id]);
        return;
      }
      case 'commit-pairs': {
        void this.openCommitPairs();
        return;
      }
      case 'open-definition':
      case 'open-type-definition':
      case 'copy-permalink':
      case 'open-permalink': {
        const target = this.stream()?.target();
        if (target !== undefined) {
          void this.sheetAction({ kind: sheetActionKinds[id], target });
        }
        return;
      }
      case 'toggle-reviewed': {
        const path = this.treePath();
        if (path === undefined) {
          this.stream()?.runCommand(id);
        } else {
          void this.setFileReviewed(path, this.reviewMarks.get(path) !== 'yes');
        }
        return;
      }
      case 'open-in-editor': {
        this.openInEditorFromFocus();
        return;
      }
      case 'open-review-edits': {
        void this.openReviewEdits();
        return;
      }
      case 'trust': {
        void this.openTrustDialog();
        return;
      }
      case 'restart-language-servers': {
        void this.restartLanguageServers();
        return;
      }
      case 'harvest-review-edits': {
        this.focusSidebar('ura');
        void this.previewReviewEdits();
        return;
      }
      case 'discard-review-edits': {
        this.focusSidebar('ura');
        void this.previewDiscardReviewEdits();
        return;
      }
      case 'save-progress': {
        void this.markReviewed();
        return;
      }
      case 'stop': {
        this.stopRunning();
        return;
      }
      case 'export-agent-xml':
      case 'export-agent-json':
      case 'export-github': {
        void this.exportUra(exportActions[id]);
        return;
      }
      case 'post-review': {
        this.focusSidebar('ura');
        void this.previewGithubReview();
        return;
      }
      case 'stage-answer': {
        const messageId = this.contextAnswerId;
        if (messageId !== undefined) {
          void this.stageChatAnswer(messageId);
        }
        return;
      }
      default: {
        return;
      }
    }
  }

  /** Back, Forward, Find and the definition and permalink commands go to a focused inline sheet. */
  private runSheetCommand(id: CommandId): boolean {
    return this.focusedSheet()?.runCommand(id) === true;
  }

  private focusedSheet(): BeuveSheetView | undefined {
    const sheet = this.renderRoot.querySelector<BeuveSheetView>('beuve-sheet-view') ?? undefined;
    if (sheet?.matches(':focus-within') === true) {
      return sheet;
    }
    return undefined;
  }

  private stream(): BeuveDiffStream | undefined {
    return this.renderRoot.querySelector<BeuveDiffStream>('beuve-diff-stream') ?? undefined;
  }

  /** The file focused in the tree, while the tree has the focus. */
  private treePath(): string | undefined {
    if (this.focusedZone === 'intent') {
      return this.renderRoot
        .querySelector<BeuveIntentSidebar>('beuve-intent-sidebar')
        ?.focusedPath();
    }
    return undefined;
  }

  /** Open in Editor: the dock's note, the tree's file or the diff's line, by focus. */
  private openInEditorFromFocus(): void {
    if (this.focusedZone === 'ura') {
      this.renderRoot.querySelector<BeuveUraDock>('beuve-ura-dock')?.runCommand('open-in-editor');
      return;
    }
    const path = this.treePath();
    if (path !== undefined) {
      void this.openInEditor(path, 1);
      return;
    }
    this.stream()?.runCommand('open-in-editor');
  }

  /** Stop: the running trace probe, else the answer being written. */
  private stopRunning(): void {
    if (this.trace?.status === 'loading') {
      this.closeTrace();
      return;
    }
    const running = this.chat.entries.find((entry) => {
      return entry.kind === 'message' && isActiveRequest(entry.message);
    });
    if (running?.kind === 'message') {
      void beuveBridge()?.invoke('chat:cancel', { messageId: running.message.id });
    }
  }

  /** Review ▸ Open With: stores the editor Open in Editor uses. */
  private async setPreferredEditor(editorId: EditorId): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const result = await bridge.invoke('editor:set-preferred', { editorId });
    if (result.ok) {
      this.editorSettings = result.value;
      this.showNotice({ tone: 'info', text: describeEditorSettings(result.value).join(' ') });
    } else {
      this.showNotice({ tone: 'error', text: result.error.message });
    }
  }

  /** `menu:run` from main: the menu bar, a shortcut or a context menu chose `id`. */
  private runCommandId(id: CommandId): void {
    const command = commandRegistry.find((candidate) => candidate.id === id);
    if (command !== undefined) {
      void this.runCommand(command, false);
    }
  }

  /** Coalesces menu state updates to one per task. */
  private scheduleMenuSync(): void {
    if (this.isMenuSyncPending) {
      return;
    }
    this.isMenuSyncPending = true;
    queueMicrotask(() => {
      this.isMenuSyncPending = false;
      this.syncMenuState();
    });
  }

  /** Tells main which menu items apply now (ADR 0068), when that changed. */
  private syncMenuState(): void {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    let dock: UraItemView | undefined;
    if (this.focusedZone === 'ura') {
      dock = this.renderRoot.querySelector<BeuveUraDock>('beuve-ura-dock')?.cursorItem();
    }
    const treePath = this.treePath();
    const markedPath = treePath ?? this.activePath;
    const sheet = this.focusedSheet();
    const state = menuStateFrom({
      hasSession: this.review !== undefined,
      activePath: treePath ?? this.activePath,
      isActiveReviewed: markedPath !== undefined && this.reviewMarks.get(markedPath) === 'yes',
      focusedZone: this.focusedZone,
      dockItem: dockItemOf(dock),
      isTextFocused: isTextFocused() || this.paletteText !== undefined || this.openDialog,
      isBusy:
        this.trace?.status === 'loading' ||
        this.chat.entries.some((entry) => {
          return entry.kind === 'message' && isActiveRequest(entry.message);
        }),
      isPullRequest: this.pullRequest !== undefined,
      stagedCount: this.stagedCount(),
      isSidebarShown: this.review !== undefined && !this.sidebarHidden,
      isTerminalShown: this.review !== undefined && this.terminalShown,
      isTerminalFocused: this.isTerminalFocused,
      display: this.display,
      treeMode: this.treeMode,
      preferredEditor: this.editorSettings?.preferred,
      isFindCaseSensitive: this.stream()?.isFindCaseSensitive === true,
      sheetHistory: sheet?.historyState(),
    });
    const key = JSON.stringify(state);
    if (key === this.lastMenuState) {
      return;
    }
    this.lastMenuState = key;
    void bridge.invoke('menu:set-state', state);
  }

  /** What a right-click landed on, recording the answer, note or tree row it chose. */
  private contextKindAt(
    event: MouseEvent,
  ): 'line' | 'file' | 'tree' | 'note' | 'answer' | 'sheet' | 'text' | undefined {
    const path = event.composedPath().filter((target) => target instanceof HTMLElement);
    if (path.some((element) => isEditableElement(element))) {
      return 'text';
    }
    if (path.some((element) => element.localName === 'beuve-sheet-view')) {
      return 'sheet';
    }
    const answer = path.find((element) => element.dataset['messageId'] !== undefined);
    if (answer !== undefined) {
      this.contextAnswerId = answer.dataset['messageId'];
      return 'answer';
    }
    const note = path.find((element) => element.dataset['itemId'] !== undefined);
    if (note !== undefined) {
      this.renderRoot
        .querySelector<BeuveUraDock>('beuve-ura-dock')
        ?.selectItem(note.dataset['itemId'] ?? '');
      this.focusedZone = 'ura';
      return 'note';
    }
    const row = path.find((element) => element.dataset['itemPath'] !== undefined);
    if (row !== undefined) {
      this.renderRoot
        .querySelector<BeuveIntentSidebar>('beuve-intent-sidebar')
        ?.revealPath(row.dataset['itemPath'] ?? '');
      this.focusedZone = 'intent';
      return 'tree';
    }
    const card = path.find((element) => element.localName === 'beuve-file-card');
    if (card === undefined) {
      return undefined;
    }
    const isHeader = path.some((element) => element.classList.contains('header'));
    this.stream()?.activateCard(card);
    this.focusedZone = 'diff';
    if (isHeader) {
      return 'file';
    }
    return 'line';
  }

  /** Definitions open as sheets, permalinks go to the clipboard or browser (ADR 0067). */
  private async sheetAction(action: SheetAction): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    const outcome = await runSheetAction(
      {
        bridge,
        sessionId: review.session.id,
        headSha: review.headSha,
        baseSha: review.baseSha,
        mode: this.display.sheets ?? 'window',
      },
      action,
    );
    if (outcome.kind === 'inline') {
      this.inlineSheet = { sha: outcome.sha, place: outcome.place };
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLElement>('beuve-sheet-view')?.focus();
    } else {
      this.showNotice(outcome.notice);
    }
  }

  /** The palette's "commits since the last review": opens them in the stream, focused. */
  private async openCommitPairs(): Promise<void> {
    this.focusedZone = 'diff';
    await this.updateComplete;
    const stream = this.renderRoot.querySelector<BeuveDiffStream>('beuve-diff-stream');
    if ((await stream?.openCommitPairs()) !== true) {
      this.showNotice({
        tone: 'info',
        text: 'Commit pairs show for an interdiff, once a rebased pull request is reviewed again.',
      });
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
        await this.runCommand(action.command, true);
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

  /**
   * Runs a registry command. From the palette the command's zone gets the focus first, as if the
   * reviewer had gone there; from a menu or shortcut the focus stays where it is.
   */
  private async runCommand(command: CommandDefinition, isFromPalette: boolean): Promise<void> {
    const { run } = command;
    switch (run.kind) {
      case 'app': {
        this.runAppCommand(command.id);
        if (isFromPalette && command.id !== 'commit-pairs') {
          this.refocusZone();
        }
        return;
      }
      case 'zone': {
        if (isFromPalette || this.focusedZone !== run.zone) {
          if (run.zone === 'diff' || run.zone === 'chat' || this.review === undefined) {
            this.focusedZone = run.zone;
          } else {
            this.focusSidebar(run.zone);
          }
          await this.updateComplete;
          this.zoneElement(run.zone)?.focus();
        }
        const zone = this.zoneElement(run.zone) as
          (HTMLElement & { readonly runCommand?: (id: CommandId) => boolean }) | undefined;
        zone?.runCommand?.(command.id);
        return;
      }
      case 'slash': {
        this.focusSidebar('chat');
        await this.updateComplete;
        if (run.isPrefill) {
          this.chatDrawer()?.prefill(run.text);
        } else {
          this.submitChat(run.text);
        }
        return;
      }
      case 'main': {
        await beuveBridge()?.invoke('menu:run-main', { id: command.id });
        return;
      }
      case 'none': {
        return;
      }
    }
  }

  /** Regions Next Region visits: the sidebar's only while it shows. */
  private zoneOrder(): ZoneId[] {
    const hasSidebar = this.review !== undefined && !this.sidebarHidden;
    return zones.map(({ id }) => id).filter((id) => id === 'diff' || hasSidebar);
  }

  /** Focus Chat: shows the chat tab and focuses its input; from the chat, goes back to the diff. */
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
      signInHint: signInHintOf(auth),
      post: this.githubPost,
    };
  }

  private paletteSources(): PaletteSources {
    return {
      commands: commandRegistry,
      platform: keyPlatformOf(this.appInfo?.platform),
      sessions: this.sessions,
      ...(this.review !== undefined && { files: this.review.files }),
      ...(this.tree !== undefined && { trackedPaths: this.tree.paths }),
      uraItems: this.uraItems,
    };
  }

  private renderTitlebar(): TemplateResult {
    return html`<div class="titlebar">
      <span class="brand">beuve</span>
      <button
        type="button"
        title=${`Open a pull request, branch or recent review (${this.shortcut('open')})`}
        @click=${(): void => {
          this.showOpenDialog();
        }}
      >
        ${describeSessionLabel(this.sessions, this.selectedId, this.review?.session)}
      </button>
      <span class="spacer"></span>
      <button
        type="button"
        class="search"
        title=${`Command Palette (${this.shortcut('palette')})`}
        @click=${(): void => {
          this.runAppCommand('palette');
        }}
      >
        Search or run a command
      </button>
    </div>`;
  }

  private shortcut(id: CommandId): string {
    return shortcutOf(id, keyPlatformOf(this.appInfo?.platform));
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
      .reviewMarks=${this.reviewMarks}
      .treeMode=${this.treeMode}
      @beuve-tree-mode=${this.onTreeMode}
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
      .reviewMarks=${this.reviewMarks}
      .reviewProgress=${this.reviewProgress}
      .order=${this.order}
      ?loading=${this.reviewLoading}
      ?marking=${this.marking}
      .savedProgress=${
        this.savedProgress?.sessionId === this.review?.session.id ? this.savedProgress : undefined
      }
      .platform=${this.appInfo?.platform ?? ''}
      .error=${this.reviewError}
      .impact=${this.impact}
      .peek=${this.peek}
      .flow=${this.flow}
      .trace=${this.trace}
      .fileJump=${this.fileJump}
      .loadFilePair=${this.loadFilePair}
      .uraItems=${this.uraItems}
      .insights=${this.reviewInsights()}
      .display=${this.display}
      .suggestionJump=${this.suggestionJump}
      .deferrals=${this.reviewDeferrals().deferrals}
      @beuve-display-change=${this.onDisplayChange}
      @beuve-status-notice=${this.onStatusNotice}
      @beuve-ura-update=${this.onUraUpdate}
      @beuve-mark-reviewed=${this.onMarkReviewed}
      @beuve-peek-request=${this.onPeekRequest}
      @beuve-peek-expand=${this.onPeekExpand}
      @beuve-peek-close=${this.onPeekClose}
      @beuve-sheet-request=${this.onSheetRequest}
      @beuve-flow-request=${this.onFlowRequest}
      @beuve-flow-close=${this.onFlowClose}
      @beuve-trace-request=${this.onTraceRequest}
      @beuve-trace-close=${this.onTraceClose}
      @beuve-trace-trust=${this.onTraceTrust}
      @beuve-diff-rendered=${this.onDiffRendered}
      @beuve-ura-create=${this.onUraCreate}
      @beuve-active-file=${this.onActiveFile}
      @beuve-file-reviewed=${this.onFileReviewed}
      @beuve-open-editor=${this.onOpenEditor}
      @beuve-ura-stage-finding=${this.onStageFinding}
      @beuve-chat-add=${this.onChatAdd}
      @beuve-insight-stage=${this.onInsightStage}
      @beuve-insight-show-in-chat=${this.onInsightShowInChat}
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
      @beuve-open-pull-cancel=${this.onOpenPullCancel}
    ></beuve-open-panel>`;
  }

  private renderDock(): TemplateResult {
    return html`<beuve-ura-dock
      data-zone="ura"
      tabindex="-1"
      ?hidden=${this.sidebarTab !== 'ura'}
      ?focused=${this.focusedZone === 'ura'}
      ?hasSession=${this.review !== undefined}
      .platform=${this.appInfo?.platform ?? ''}
      .items=${this.uraItems}
      .derivedVerdict=${this.uraVerdict}
      .chosenVerdict=${this.chosenVerdict}
      .verdictNotice=${this.verdictNotice}
      .notice=${this.dockNotice}
      ?exporting=${this.exporting}
      .github=${this.githubDock()}
      .reviewEdits=${{ view: this.reviewEdits, flow: this.reviewEditsFlow }}
      @beuve-review-edits=${this.onReviewEdits}
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
      .stagedFindings=${this.stagedFindings()}
      .subscribeChatStream=${this.subscribeChatStream}
      ?hasSession=${this.review !== undefined}
      @beuve-open-link=${this.onOpenChatLink}
      @beuve-chat-submit=${this.onChatSubmit}
      @beuve-chat-escape=${this.onChatEscape}
      @beuve-chat-cancel=${this.onChatCancel}
      @beuve-chat-stage=${this.onChatStage}
      @beuve-chat-stage-finding=${this.onChatStageFinding}
      @beuve-chat-clear-queue=${this.onChatClearQueue}
      @beuve-chat-cite=${this.onChatCite}
      @beuve-chat-mention=${this.onChatMention}
      @beuve-chat-cancel-compaction=${this.onChatCancelCompaction}
      @beuve-open-editor=${this.onOpenEditor}
    ></beuve-chat-drawer>`;
  }

  private stagedCount(): number {
    return this.uraItems.filter((item) => item.status.kind === 'staged').length;
  }

  /** Intent and files, the review and the chat as quiet tabs (1, 2, 3). */
  private renderTabs(): TemplateResult {
    const tab = (zone: SidebarZone, label: string, count = 0): TemplateResult => {
      return html`<button
        type="button"
        role="tab"
        aria-selected=${this.sidebarTab === zone ? 'true' : 'false'}
        @click=${(): void => {
          this.focusSidebar(zone);
        }}
      >
        ${label}${count === 0 ? nothing : html`<span class="count">${count}</span>`}
      </button>`;
    };
    const staged = this.stagedCount();
    return html`<nav class="tabs" role="tablist" aria-label="Sidebar">
      ${tab('intent', this.pullRequest === undefined ? 'Files' : 'Intent & files')}
      ${tab('ura', 'Review', staged)} ${tab('chat', 'Chat')}
    </nav>`;
  }

  private renderSidebar(): TemplateResult {
    return html`<div class="sidebar">
      ${this.renderTabs()} ${this.renderIntent()} ${this.renderDock()} ${this.renderChat()}
    </div>`;
  }

  private onTerminalFocus(event: CustomEvent<TerminalFocusDetail>): void {
    this.isTerminalFocused = event.detail.isFocused;
  }

  private onTerminalHide(): void {
    this.terminalShown = false;
    this.isTerminalFocused = false;
  }

  private renderTerminal(): TemplateResult | typeof nothing {
    const { review } = this;
    if (review === undefined || !this.terminalShown) {
      return nothing;
    }
    return html`${keyed(
      review.session.id,
      html`<beuve-terminal-panel
        .api=${beuveBridge()}
        .sessionId=${review.session.id}
        .headSha=${review.headSha}
        @beuve-terminal-focus=${(event: CustomEvent<TerminalFocusDetail>): void => {
          this.onTerminalFocus(event);
        }}
        @beuve-terminal-hide=${(): void => {
          this.onTerminalHide();
        }}
      ></beuve-terminal-panel>`,
    )}`;
  }

  override render(): TemplateResult {
    const hasSidebar = this.review !== undefined && !this.sidebarHidden;
    const workspace: string[] = [];
    if (!hasSidebar) {
      workspace.push('solo');
    }
    if (this.sidebarSide === 'left') {
      workspace.push('left');
    }
    const focused = zones.find(({ id }) => id === this.focusedZone);
    return html`
      ${this.renderTitlebar()}
      <div class="workspace ${workspace.join(' ')}">
        <div class="main">${this.renderDiff()}${this.renderTerminal()}</div>
        ${hasSidebar ? this.renderSidebar() : nothing}
      </div>
      <beuve-status-bar
        .zoneLabel=${this.review === undefined ? '' : (focused?.label ?? '')}
        .mcpStatus=${this.mcpStatus}
        .appInfo=${this.appInfo}
        .notice=${this.statusNotice}
        .ci=${this.ci}
        .attention=${this.pullRequest?.attention}
        .githubAuth=${this.githubAuth}
        @beuve-status-action=${this.onStatusAction}
      ></beuve-status-bar>
      ${
        this.trustDialog === undefined
          ? nothing
          : html`<div class="scrim">
              <div class="dialog">
                <beuve-trust-dialog
                  .trust=${this.trustDialog}
                  @beuve-trust-choice=${this.onTrustChoice}
                ></beuve-trust-dialog>
              </div>
            </div>`
      }
      ${
        this.inlineSheet === undefined || this.review === undefined
          ? nothing
          : html`<beuve-sheet-view
              class="sheet-overlay"
              mode="inline"
              .api=${beuveBridge()}
              .sessionId=${this.review.session.id}
              .sha=${this.inlineSheet.sha}
              .place=${this.inlineSheet.place}
              @beuve-sheet-close=${this.onSheetClose}
            ></beuve-sheet-view>`
      }
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
              .platform=${this.appInfo?.platform ?? ''}
              @beuve-shortcuts-close=${this.onShortcutsClose}
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
    this.scheduleMenuSync();
    if (this.paletteText !== undefined && changed.has('paletteText')) {
      this.renderRoot.querySelector('beuve-command-palette')?.focus();
      return;
    }
    const isRelevant = ['focusedZone', 'sidebarHidden'].some((key) => {
      return changed.has(key as keyof BeuveApp);
    });
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

const paletteOpenings: Readonly<Record<'palette' | 'go-to-file', string>> = {
  palette: '',
  'go-to-file': '@',
};

const otherSides: Readonly<Record<SidebarSideView, SidebarSideView>> = {
  left: 'right',
  right: 'left',
};

function describeSheets(sheets: DiffDisplayView['sheets']): string {
  if (sheets === 'inline') {
    return 'Definitions open over the diff.';
  }
  return 'Definitions open in a new sheet window each.';
}

/** What the dock's cursor item enables in the menus, while the dock has the focus. */
function dockItemOf(item: UraItemView | undefined): MenuStateInput['dockItem'] {
  if (item === undefined) {
    return undefined;
  }
  return { isAddressed: item.status.kind === 'addressed' };
}

/** What to do before posting to GitHub: sign in, or wait for the check. */
function signInHintOf(auth: GithubAuthStatusView | undefined): string {
  if (auth?.kind !== 'signed-out') {
    return 'checking GitHub sign-in…';
  }
  if (auth.remedy === undefined) {
    return auth.message;
  }
  return `sign in first: run ${auth.remedy}.`;
}

function describeGenerated(isShown: boolean): string {
  if (isShown) {
    return 'Generated files: shown (/generated hide collapses them)';
  }
  return 'Generated files: collapsed (/generated show expands them)';
}

const noInsights: readonly ReviewInsight[] = [];

function describeInsights(isShown: boolean): string {
  if (isShown) {
    return 'Review insights: shown on the diff (/insights hide removes them)';
  }
  return 'Review insights: hidden (/insights show brings them back)';
}

function describeSkipReviewed(isSkipping: boolean | undefined): string {
  if (isSkipping === true) {
    return 'Next and Previous Change skip files marked reviewed';
  }
  return 'Next and Previous Change stop at every file, reviewed or not';
}

function describeOrder(mode: ReviewOrderMode = 'path'): string {
  return orderDescriptions[mode];
}

const orderDescriptions: Readonly<Record<ReviewOrderMode, string>> = {
  path: 'Files in path order',
  imports: 'Files by imports: what a file uses comes before it',
  calls: 'Files by calls: what a function calls comes before it',
};

const orderActions: Readonly<Record<Extract<CommandId, `order-${string}`>, ReviewOrderMode>> = {
  'order-path': 'path',
  'order-imports': 'imports',
  'order-calls': 'calls',
};

const editorActions: Readonly<Record<Extract<CommandId, `editor-${string}`>, EditorId>> = {
  'editor-zed': 'zed',
  'editor-vscode': 'vscode',
  'editor-cursor': 'cursor',
};

const exportActions: Readonly<Record<Extract<CommandId, `export-${string}`>, UraExportTarget>> = {
  'export-agent-xml': 'agent-xml',
  'export-agent-json': 'agent-json',
  'export-github': 'github',
};

const sheetActionKinds = {
  'open-definition': 'definition',
  'open-type-definition': 'type-definition',
  'copy-permalink': 'copy-link',
  'open-permalink': 'open-link',
} as const;

function peekStateFrom(
  path: string,
  line: number,
  answer: IpcResult<CallHierarchyView>,
): PeekState {
  if (!answer.ok) {
    return { path, line, status: 'error', message: answer.error.message };
  }
  const { root, calls } = answer.value;
  if (root === undefined) {
    return {
      path,
      line,
      status: 'error',
      message: 'The language server found nothing callable here.',
    };
  }
  return {
    path,
    line,
    status: 'ready',
    root,
    children: new Map([[root.id, { status: 'ready', calls }]]),
  };
}

function flowStateFrom(
  path: string,
  line: number,
  answer: IpcResult<FlowGraphResponse>,
): FlowState {
  if (!answer.ok) {
    return { path, line, status: 'error', message: answer.error.message };
  }
  if (answer.value.kind === 'graph') {
    return { path, line, status: 'ready', graph: answer.value.graph };
  }
  return { path, line, status: 'error', message: flowFailureText[answer.value.failure] };
}

const flowFailureText: Readonly<Record<FlowFailureKind, string>> = {
  'unsupported-language':
    'No control-flow chart for this kind of file yet (TypeScript and JavaScript only).',
  'no-function-at-line': 'The change is not inside a function, so there is no flow to draw.',
  'too-large': 'This function is too large to draw as a chart.',
  'file-unavailable': 'The head version of this file is not readable source.',
};

const exportLabels: Readonly<Record<UraExportTarget, string>> = {
  'agent-xml': 'the review for Claude Code as XML',
  'agent-json': 'the review for agents as JSON',
  github: 'the GitHub review JSON',
};

function formatBytes(characters: number): string {
  if (characters < 1024) {
    return `${String(characters)} characters`;
  }
  return `${(characters / 1024).toFixed(1)} K characters`;
}

const nothingSelected =
  'Select lines, focus a hunk, a staged note or a file to add it to the chat.';

/** Whether the focus, through shadow roots, is in a field that takes typing. */
/** The bridge's `chat:stream` subscription, as `textPartStream` takes it. */
function subscribeChatStreamOf(bridge: BeuveApi | undefined): ChatStreamSubscribe | undefined {
  if (bridge === undefined) {
    return undefined;
  }
  return (listener): (() => void) => bridge.on('chat:stream', listener);
}

function isTextFocused(): boolean {
  let element: Element | null = document.activeElement;
  while (
    element?.shadowRoot?.activeElement !== undefined &&
    element.shadowRoot.activeElement !== null
  ) {
    element = element.shadowRoot.activeElement;
  }
  return element instanceof HTMLElement && isEditableElement(element);
}

function isEditableElement(element: HTMLElement): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  );
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-app': BeuveApp;
  }
}
