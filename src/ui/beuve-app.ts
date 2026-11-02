import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';

import type {
  AppInfo,
  BeuveApi,
  CallHierarchyView,
  ChatCitationView,
  ChatMentionView,
  ChatMessageView,
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
  IpcResult,
  LspServerView,
  McpStatus,
  OpenPullRequestRequest,
  RepositoryTreeView,
  ReviewEditsView,
  ReviewOrderMode,
  ReviewOrderView,
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
import './beuve-hover-card.ts';
import type { BeuveHoverCard, HoverAsk } from './beuve-hover-card.ts';
import type { HoverPoint } from './hover-point.ts';
import './beuve-command-palette.ts';
import './beuve-open-panel.ts';
import './beuve-diff-stream.ts';
import './beuve-intent-sidebar.ts';
import './beuve-keybinding-overlay.ts';
import './beuve-status-bar.ts';
import type { StatusOpenUrlDetail, StatusPopoverDetail } from './beuve-status-bar.ts';
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
import type { FilePairLoader, TokenJumpDetail } from './beuve-file-card.ts';
import type { DockNotice } from './beuve-ura-dock.ts';
import { ChatController } from './chat-controller.ts';
import { GithubController } from './github-controller.ts';
import type { GithubPostDetail, GithubReviewRef } from './github-controller.ts';
import type { ChatAppCommand } from './chat-controller.ts';
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
import { planChatStage } from './plan-chat-stage.ts';
import { withoutStagedInsights } from './without-staged-insights.ts';
import type { FlowState } from './flow-state.ts';
import type { GithubDockState } from './github-post-state.ts';
import { clearReviewEditsStatus } from './clear-review-edits-status.ts';
import type { ReviewEditsFlow } from './review-edits-state.ts';
import { lineFromTarget } from './line-from-target.ts';
import { relativeLineTextFrom } from './relative-line-text-from.ts';
import type { PeekChildren, PeekState } from './peek-state.ts';
import type { RadarTreeMode } from './plan-radar-tree.ts';
import { zones } from './zones.ts';
import './beuve-sheet-view.ts';
import { runSheetAction } from './run-sheet-action.ts';
import type { ClickedToken, SheetAction, SheetOpenDetail } from './run-sheet-action.ts';
import type { ReviewTarget } from './target-from.ts';
import type { SheetPlace } from './step-sheet-history.ts';
import type { ZoneId } from './zones.ts';
import type { ChatStreamSubscribe } from './text-part-stream.ts';

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

    .sidebar {
      position: relative;
    }

    .sidebar-handle {
      position: absolute;
      z-index: 2;
      top: 0;
      bottom: 0;
      left: -3px;
      width: 6px;
      cursor: col-resize;
      touch-action: none;
    }

    .workspace.left .sidebar-handle {
      right: -3px;
      left: auto;
    }

    .sidebar-handle:hover,
    .sidebar-handle:focus-visible,
    .sidebar-handle.dragging {
      background: var(--beuve-border);
      outline: none;
    }

    .sidebar > .sidebar-handle {
      border: none;
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
  private readonly github = new GithubController(this, {
    bridge: beuveBridge,
    review: (): GithubReviewRef | undefined => {
      return this.githubReviewRef();
    },
    notify: (notice): void => {
      this.showNotice(notice);
    },
    refreshSessions: async (): Promise<void> => {
      return this.refreshSessions();
    },
    selectSession: async (sessionId): Promise<void> => {
      return this.selectSession(sessionId);
    },
    setOpenDialog: (isOpen): void => {
      this.openDialog = isOpen;
    },
  });
  private readonly chat = new ChatController(this, {
    bridge: beuveBridge,
    sessionId: (): string | undefined => {
      return this.review?.session.id;
    },
    focusPath: (): string | undefined => {
      return this.focusPathOfReview();
    },
    restoreDraft: (text, mentions): void => {
      this.chatDrawer()?.setDraft(text, mentions);
    },
    runAppCommand: (command): void => {
      this.runChatAppCommand(command);
    },
  });
  /** The file the diff stream's cursor is on, sent as the question's focus. */
  private activePath: string | undefined;
  private jumpNonce = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

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
    void this.github.open(event.detail);
  };

  /** A stack chip: the neighbour lives in the same repository, so it uses the same clone. */
  private readonly onOpenStack = (event: CustomEvent<StackRefDetail>): void => {
    const source = this.review?.session.source;
    void this.github.open({
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
    void this.github.previewReview();
  };

  private readonly onGithubPost = (event: CustomEvent<GithubPostDetail>): void => {
    void this.github.postReview(event.detail);
  };

  private readonly onGithubCancel = (): void => {
    this.github.cancelPost();
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

  private readonly onTokenHover = (event: CustomEvent<HoverPoint>): void => {
    this.renderRoot.querySelector<BeuveHoverCard>('beuve-hover-card')?.point(event.detail);
  };

  private readonly onTokenHoverEnd = (): void => {
    this.renderRoot.querySelector<BeuveHoverCard>('beuve-hover-card')?.leave();
  };

  /** ⌘/Ctrl-click on a token: Go to Definition on it, as the menu command does. */
  private readonly onTokenJump = (event: CustomEvent<TokenJumpDetail>): void => {
    this.renderRoot.querySelector<BeuveHoverCard>('beuve-hover-card')?.leave();
    const { target, token } = event.detail;
    void this.sheetAction(sheetActionFrom('open-definition', target, token));
  };

  /** The language server's hover for a token of the diff on screen. */
  private readonly askHover: HoverAsk = async (request) => {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return { ok: false, error: { code: 'unsupported', message: 'no bridge' } };
    }
    return bridge.invoke('lsp:hover', request);
  };

  private readonly onFlowRequest = (event: CustomEvent<LineRequestDetail>): void => {
    void this.openFlow(event.detail.path, event.detail.line);
  };

  private readonly onFlowClose = (): void => {
    this.flow = undefined;
  };

  private insightCache: { signature: string; insights: readonly ReviewInsight[] } | undefined;

  private readonly onChatSubmit = (event: CustomEvent<ChatSubmitDetail>): void => {
    this.chat.submit(event.detail.text, event.detail.mentions ?? []);
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
    void this.chat.clear(true);
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

  /** A notice's button: runs its catalog command as the menu would. */
  private readonly onSidebarHandleDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.isResizingSidebar = true;
    event.preventDefault();
  };

  private readonly onSidebarHandleMove = (event: PointerEvent): void => {
    if (!this.isResizingSidebar) {
      return;
    }
    const workspace = this.renderRoot.querySelector<HTMLElement>('.workspace');
    if (workspace === null) {
      return;
    }
    const bounds = workspace.getBoundingClientRect();
    let width = bounds.right - event.clientX;
    if (this.sidebarSide === 'left') {
      width = event.clientX - bounds.left;
    }
    this.setSidebarWidth({ width, available: bounds.width });
  };

  private readonly onSidebarHandleUp = (event: PointerEvent): void => {
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    this.isResizingSidebar = false;
  };

  private readonly onSidebarHandleReset = (): void => {
    this.sidebarWidth = undefined;
  };

  private readonly onSidebarHandleKey = (event: KeyboardEvent): void => {
    const growKey = growKeys[this.sidebarSide];
    const shrinkKey = growKeys[otherSides[this.sidebarSide]];
    if (event.key !== growKey && event.key !== shrinkKey) {
      return;
    }
    const workspace = this.renderRoot.querySelector<HTMLElement>('.workspace');
    const sidebar = this.renderRoot.querySelector<HTMLElement>('.sidebar');
    if (workspace === null || sidebar === null) {
      return;
    }
    let step = 16;
    if (event.shiftKey) {
      step = 64;
    }
    if (event.key === shrinkKey) {
      step = -step;
    }
    this.setSidebarWidth({
      width: sidebar.getBoundingClientRect().width + step,
      available: workspace.clientWidth,
    });
    event.preventDefault();
  };

  private readonly onStatusAction = (event: CustomEvent<StatusNoticeAction>): void => {
    this.statusNotice = undefined;
    this.runAppCommand(event.detail.command);
  };

  /** A check's link in the status bar's CI popover. */
  private readonly onStatusOpenUrl = (event: CustomEvent<StatusOpenUrlDetail>): void => {
    void this.openUrl(event.detail.url);
  };

  /** The language servers' list opened: read their state afresh. */
  private readonly onStatusPopover = (event: CustomEvent<StatusPopoverDetail>): void => {
    if (event.detail.id === 'lsp') {
      void this.refreshLspStatus();
    }
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
    this.github.cancelOpening();
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
  @state() accessor peek: PeekState | undefined;
  /** The sheet shown over the diff with `/sheets inline` (ADR 0067). */
  @state() accessor inlineSheet: { readonly sha: string; readonly place: SheetPlace } | undefined;
  /** The control-flow portal; at most one of `peek` and `flow` is open at a time. */
  @state() accessor flow: FlowState | undefined;
  @state() accessor reviewLoading = false;
  @state() accessor reviewError = '';
  @state() accessor marking = false;
  /** The checkpoint Save Progress recorded in this window, for the header's quiet status. */
  @state() accessor savedProgress:
    { readonly sessionId: string; readonly sha: string; readonly at: Temporal.Instant } | undefined;
  @state() accessor opening = false;
  @state() accessor localFailure: OpenFailure | undefined;
  @state() accessor fileJump: FileJump | undefined;
  /** The open session head's tracked paths, for the radar tree. */
  @state() accessor tree: RepositoryTreeView | undefined;
  @state() accessor treeMode: RadarTreeMode = 'diff-only';
  /** The open session's URA items, every status, placed on its current head. */
  @state() accessor uraItems: readonly UraItemView[] = [];
  @state() accessor uraVerdict: UraVerdictView = 'approve';
  @state() accessor chosenVerdict: UraVerdictView | undefined;
  @state() accessor verdictNotice = '';
  @state() accessor dockNotice: DockNotice | undefined;
  @state() accessor exporting = false;
  /** The language servers beuve has started, as the status bar lists them. */
  @state() accessor lspServers: readonly LspServerView[] | undefined;
  /** Which side the sidebar sits on (ADR 0044); main keeps it in `settings.json`. */
  @state() accessor sidebarSide: SidebarSideView = 'right';
  @state() accessor sidebarHidden = false;
  /** Dragged sidebar width in px; `undefined` is the stylesheet's responsive default. */
  @state() accessor sidebarWidth: number | undefined = undefined;
  @state() accessor isResizingSidebar = false;
  /** The terminal panel under the diff (ADR 0095); its shells run on while it is hidden. */
  @state() accessor terminalShown = false;
  @state() accessor isTerminalFocused = false;
  /** The sidebar tab on show: intent and files, the review or the chat. */
  @state() accessor sidebarTab: SidebarZone = 'intent';
  @state() accessor openDialog = false;

  /** The palette's starting text while it is open. */
  @state() accessor paletteText: string | undefined;
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
      bridge.on('ura:changed', ({ sessionId }) => {
        if (sessionId === this.review?.session.id) {
          void this.refreshUra(sessionId);
        }
      }),
      bridge.on('menu:run', ({ id }) => {
        this.runCommandId(id);
      }),
      bridge.on('link:open-pr', ({ ref }) => {
        void this.github.open({ ref });
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
    await this.github.loadAuth();
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

  /** Main opens GitHub links in the browser and refuses anything else (ADR 0040). */
  private async openLink(url: string): Promise<void> {
    const opened = await beuveBridge()?.invoke('github:open-link', { url });
    if (opened !== undefined && !opened.ok) {
      this.showNotice({ tone: 'error', text: opened.error.message });
    }
  }

  private async refreshLspStatus(): Promise<void> {
    const status = await beuveBridge()?.invoke('lsp:status');
    if (status?.ok === true) {
      this.lspServers = status.value.servers;
    }
  }

  /** A chat answer's link: main opens any http(s) URL in the browser (ADR 0040, amended). */
  private async openUrl(url: string): Promise<void> {
    const opened = await beuveBridge()?.invoke('shell:open-url', { url });
    if (opened !== undefined && !opened.ok) {
      this.showNotice({ tone: 'error', text: opened.error.message });
    }
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
      this.chat.note('info', `Diffs: ${describeDiffDisplay(display, false).text}.`);
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
      this.chat.note('error', result.error.message);
      return;
    }
    this.editorSettings = result.value;
    this.chat.note('info', ...describeEditorSettings(result.value));
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
      this.chat.reset();
      this.github.reset();
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
    if (review.ok) {
      if (shownHead !== undefined && shownHead !== review.value.headSha) {
        this.github.invalidatePost();
      }
      this.review = review.value;
      this.applyMarks(review.value);
      this.focusedZone = 'diff';
      if (this.sessions.every(({ id }) => id !== sessionId)) {
        void this.refreshSessions();
      }
      void this.loadTree(review.value);
      void this.loadOrder(review.value);
      void this.refreshLspStatus();
      void this.loadFileAttributes(review.value);
      void this.refreshUra(review.value.session.id);
      void this.loadReviewEdits(review.value.session.id);
      void this.chat.load(review.value.session.id);
      if (review.value.session.source.kind === 'github-pull-request') {
        void this.github.loadPullRequest(review.value.session.id);
      }
    } else {
      this.review = undefined;
      this.reviewError = review.error.message;
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
      void this.refreshLspStatus();
    } else if (restarted.error.code !== 'cancelled') {
      this.showNotice({ tone: 'error', text: restarted.error.message });
    }
  }

  /** Copy Relative Line Number (ADR 0096): `path:line` of the target, for test runners. */
  private async copyRelativeLine(): Promise<void> {
    const bridge = beuveBridge();
    const target = this.stream()?.target();
    if (bridge === undefined || target === undefined) {
      return;
    }
    const text = relativeLineTextFrom(target);
    if (text === undefined) {
      return;
    }
    const copied = await bridge.invoke('clipboard:write-text', { text });
    if (copied.ok) {
      this.showNotice({ tone: 'info', text: `Copied ${revealFormatControls(text)}.` });
    } else {
      this.showNotice({ tone: 'error', text: `Could not copy: ${copied.error.message}` });
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

  /** The preference slash commands of the chat; the controller has echoed what was typed. */
  private runChatAppCommand(command: ChatAppCommand): void {
    switch (command.kind) {
      case 'editor': {
        void this.runEditorCommand(command.editorId);
        return;
      }
      case 'diff': {
        void this.runDisplayCommand({
          ...(command.layout !== undefined && { layout: command.layout }),
        });
        return;
      }
      case 'whitespace': {
        void this.runDisplayCommand({
          ...(command.ignoreWhitespace !== undefined && {
            ignoreWhitespace: command.ignoreWhitespace,
          }),
        });
        return;
      }
      case 'generated': {
        void this.setDisplay({
          ...(command.showGenerated !== undefined && { showGenerated: command.showGenerated }),
        }).then((display) => {
          if (display !== undefined) {
            this.chat.note('info', `${describeGenerated(display.showGenerated)}.`);
          }
        });
        return;
      }
      case 'sheets': {
        void this.setDisplay({ ...(command.mode !== undefined && { sheets: command.mode }) }).then(
          (display) => {
            if (display !== undefined) {
              this.chat.note('info', describeSheets(display.sheets));
            }
          },
        );
        return;
      }
      case 'insights': {
        void this.setDisplay({
          ...(command.showInsights !== undefined && { showInsights: command.showInsights }),
        }).then((display) => {
          if (display !== undefined) {
            this.chat.note('info', `${describeInsights(display.showInsights)}.`);
          }
        });
        return;
      }
      case 'order': {
        void this.setDisplay({
          ...(command.mode !== undefined && { reviewOrder: command.mode }),
        }).then((display) => {
          if (display !== undefined) {
            this.chat.note('info', `${describeOrder(display.reviewOrder)}.`);
          }
        });
        return;
      }
      case 'sidebar': {
        void this.setSidebarSide(command.side).then(() => {
          this.chat.note('info', `Sidebar on the ${command.side}.`);
        });
        return;
      }
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

  private githubReviewRef(): GithubReviewRef | undefined {
    if (this.review === undefined) {
      return undefined;
    }
    return { sessionId: this.review.session.id, headSha: this.review.headSha };
  }

  private focusPathOfReview(): string | undefined {
    const { activePath } = this;
    if (this.review?.files.some((file) => file.path === activePath) === true) {
      return activePath;
    }
    return undefined;
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
      this.chat.note(
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
      this.chat.note(
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
      case 'copy-relative-line': {
        void this.copyRelativeLine();
        return;
      }
      case 'open-definition':
      case 'open-type-definition':
      case 'copy-permalink':
      case 'open-permalink': {
        const target = this.stream()?.target();
        if (target !== undefined) {
          void this.sheetAction(sheetActionFrom(id, target, this.stream()?.tokenClicked()));
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
        this.chat.cancelRunning();
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
        void this.github.previewReview();
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
      isBusy: this.chat.isBusy,
      isPullRequest: this.github.pullRequest !== undefined,
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
    this.github.clearFailure();
    this.localFailure = undefined;
    this.refocusZone();
  }

  private closePalette(): void {
    this.paletteText = undefined;
    this.refocusZone();
  }

  private openPanel(): BeuveOpenPanel | undefined {
    return this.renderRoot.querySelector<BeuveOpenPanel>('.dialog beuve-open-panel') ?? undefined;
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
          await this.github.open({ ref: action.ref, repoPath: action.repoPath });
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
          this.chat.submit(run.text);
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
    const auth = this.github.auth;
    return {
      target: `${source.owner}/${source.repo}#${String(source.number)}`,
      isSignedIn: auth?.kind === 'signed-in' && auth.host === source.host,
      signInHint: signInHintOf(auth),
      post: this.github.post,
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
      .pullRequest=${this.github.pullRequest}
      .files=${this.review?.files}
      .tree=${this.tree}
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
      .loadingLabel=${describeSessionLabel(this.sessions, this.selectedId, this.review?.session)}
      ?marking=${this.marking}
      .savedProgress=${
        this.savedProgress?.sessionId === this.review?.session.id ? this.savedProgress : undefined
      }
      .platform=${this.appInfo?.platform ?? ''}
      .error=${this.reviewError}
      .peek=${this.peek}
      .flow=${this.flow}
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
      @beuve-ura-create=${this.onUraCreate}
      @beuve-active-file=${this.onActiveFile}
      @beuve-file-reviewed=${this.onFileReviewed}
      @beuve-open-editor=${this.onOpenEditor}
      @beuve-chat-add=${this.onChatAdd}
      @beuve-insight-stage=${this.onInsightStage}
      @beuve-insight-show-in-chat=${this.onInsightShowInChat}
      @beuve-token-hover=${this.onTokenHover}
      @beuve-token-hover-end=${this.onTokenHoverEnd}
      @beuve-token-jump=${this.onTokenJump}
    ></beuve-diff-stream>`;
  }

  private renderOpenPanel(isClosable: boolean, zone: ZoneId | undefined): TemplateResult {
    return html`<beuve-open-panel
      data-zone=${zone ?? nothing}
      ?closable=${isClosable}
      .platform=${this.appInfo?.platform ?? ''}
      .sessions=${this.sessions}
      ?openingPull=${this.github.isOpening}
      ?openingLocal=${this.opening}
      .pullFailure=${this.github.failure}
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
      ${tab('intent', this.github.pullRequest === undefined ? 'Files' : 'Intent & files')}
      ${tab('ura', 'Review', staged)} ${tab('chat', 'Chat')}
    </nav>`;
  }

  private renderSidebar(): TemplateResult {
    return html`<div class="sidebar">
      <div
        class="sidebar-handle ${this.isResizingSidebar ? 'dragging' : ''}"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin=${minSidebarWidth}
        aria-valuenow=${this.sidebarWidth ?? 0}
        tabindex="0"
        @pointerdown=${this.onSidebarHandleDown}
        @pointermove=${this.onSidebarHandleMove}
        @pointerup=${this.onSidebarHandleUp}
        @pointercancel=${this.onSidebarHandleUp}
        @dblclick=${this.onSidebarHandleReset}
        @keydown=${this.onSidebarHandleKey}
      ></div>
      ${this.renderTabs()} ${this.renderIntent()} ${this.renderDock()} ${this.renderChat()}
    </div>`;
  }

  private setSidebarWidth(options: SidebarWidthOptions): void {
    const max = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, options.available * 0.6));
    this.sidebarWidth = Math.round(Math.min(max, Math.max(minSidebarWidth, options.width)));
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
    return html`
      ${this.renderTitlebar()}
      <div
        class="workspace ${workspace.join(' ')}"
        style=${this.sidebarWidth === undefined ? '' : `--beuve-sidebar-width: ${String(this.sidebarWidth)}px`}
      >
        <div class="main">${this.renderDiff()}${this.renderTerminal()}</div>
        ${hasSidebar ? this.renderSidebar() : nothing}
      </div>
      <beuve-status-bar
        .lspServers=${this.lspServers}
        .mcpStatus=${this.mcpStatus}
        .appInfo=${this.appInfo}
        .notice=${this.statusNotice}
        .ci=${this.github.ci}
        .attention=${this.github.pullRequest?.attention}
        .githubAuth=${this.github.auth}
        @beuve-status-action=${this.onStatusAction}
        @beuve-status-open-url=${this.onStatusOpenUrl}
        @beuve-status-popover=${this.onStatusPopover}
      ></beuve-status-bar>
      ${
        this.review === undefined
          ? nothing
          : html`<beuve-hover-card
              .ask=${this.askHover}
              .sessionId=${this.review.session.id}
              .sha=${this.review.headSha}
            ></beuve-hover-card>`
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

interface SidebarWidthOptions {
  readonly width: number;
  readonly available: number;
}

/** The arrow key that widens the sidebar on each side. */
const growKeys: Readonly<Record<SidebarSideView, string>> = {
  left: 'ArrowRight',
  right: 'ArrowLeft',
};

const minSidebarWidth = 240;
const maxSidebarWidth = 900;

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

/** The sheet action a menu command asks for; a definition asks about the clicked token, if any. */
function sheetActionFrom(
  id: keyof typeof sheetActionKinds,
  target: ReviewTarget,
  token: ClickedToken | undefined,
): SheetAction {
  const kind = sheetActionKinds[id];
  if (kind === 'definition' || kind === 'type-definition') {
    return { kind, target, token };
  }
  return { kind, target };
}

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
