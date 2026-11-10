import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';

import type {
  ChatCitationView,
  ChatMentionView,
  ChatMessageView,
  CommitInfoView,
  DiffDisplayView,
  DiffFileView,
  FileAttributesView,
  FilePairView,
  RepositoryTreeView,
  ReviewView,
  SetDiffDisplayRequest,
  SidebarSideView,
  UraItemView,
} from '#contract/ipc-contract.ts';

import './beuve-chat-drawer.ts';
import './beuve-definition-link.ts';
import type { BeuveDefinitionLink, DefinitionAsk } from './beuve-definition-link.ts';
import './beuve-hover-card.ts';
import type { BeuveHoverCard, DiagnosticsFor, HoverAsk } from './beuve-hover-card.ts';
import type { HoverPoint } from './hover-point.ts';
import './beuve-command-palette.ts';
import './beuve-open-panel.ts';
import './beuve-diff-stream.ts';
import './beuve-files-sidebar.ts';
import './beuve-overview-sidebar.ts';
import './beuve-keybinding-overlay.ts';
import './beuve-dialog.ts';
import './beuve-sidebar.ts';
import './beuve-status-bar.ts';
import './beuve-titlebar.ts';
import './beuve-workspace.ts';
import type { TerminalFocusDetail } from './beuve-terminal-panel.ts';
import './beuve-setup-command-dialog.ts';
import type { SetupCommandSaveDetail } from './beuve-setup-command-dialog.ts';
import { SetupController } from './setup-controller.ts';
import type { SetupTarget } from './setup-controller.ts';
import './beuve-ura-dock.ts';
import { planDiffDeferrals } from './plan-diff-deferrals.ts';
import type { DiffDeferral } from './plan-diff-deferrals.ts';
import { beuveBridge } from './beuve-bridge.ts';
import type { BeuveChatDrawer } from './beuve-chat-drawer.ts';
import type { BeuveDiffStream } from './beuve-diff-stream.ts';
import type { ImageLoader } from './rich-view/beuve-rich-view.ts';
import type { BeuveFilesSidebar } from './beuve-files-sidebar.ts';
import type { BeuveUraDock } from './beuve-ura-dock.ts';
import type { MentionTarget } from './chat-draft.ts';
import type { CommandId } from '#contract/command-catalog.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

import type { PaletteAction } from './plan-palette.ts';
import type {
  FileJump,
  OpenCommitDetail,
  SuggestionJump,
  UraCreateRequest,
} from './beuve-diff-stream.ts';
import type { FilePairLoader, TokenJumpDetail } from './beuve-file-card.ts';
import type { ChatController } from './chat-controller.ts';
import type { GithubController } from './github-controller.ts';
import type { ReviewEditsController } from './review-edits-controller.ts';
import type { SidebarResizeDetail } from './beuve-sidebar-handle.ts';
import type { SidebarTabDetail } from './beuve-sidebar-tabs.ts';
import type { SidebarZone } from './sidebar-zone.ts';
import { zoneOrderFrom } from './zone-order-from.ts';
import type { AppActions } from './app-actions.ts';
import { citationPlace } from './citation-place.ts';
import { describeOutsideDiff } from './describe-outside-diff.ts';
import { fileOfMention } from './file-of-mention.ts';
import { mentionTargetFromItem } from './mention-target-from-item.ts';
import { mentionTargetFromPalette } from './mention-target-from-palette.ts';
import { CodeNavigationController } from './code-navigation-controller.ts';
import { diagnosticsAt } from './diagnostics-at.ts';
import type { DiagnosticPosition } from './diagnostics-at.ts';
import { DiagnosticsController } from './diagnostics-controller.ts';
import type { DiagnosticsTarget } from './diagnostics-controller.ts';
import type { DiagnosticsWantedDetail, FileDiagnostics } from './file-diagnostics.ts';
import { cycleZone } from './cycle-zone.ts';
import { dockItemOf } from './dock-item-of.ts';
import type { MenuStateInput } from './menu-state-from.ts';
import type { AppModel } from './app-model.ts';
import type { ReviewDataController } from './review-data-controller.ts';
import type { SessionController } from './session-controller.ts';
import type { SettingsController } from './settings-controller.ts';
import type { UraController } from './ura-controller.ts';
import type { EditorPlace } from './review-edits-controller.ts';
import type { UraUpdateDetail } from './ura-controller.ts';
import type { GithubPostDetail } from './github-controller.ts';
import { describeEditorOpen } from './describe-editor-open.ts';
import { describeSessionLabel } from './describe-session-label.ts';
import type { StatusNotice } from './describe-editor-open.ts';
import { mergeReviewInsights } from './merge-review-insights.ts';
import type { ReviewInsight } from './merge-review-insights.ts';
import { planChatStage } from './plan-chat-stage.ts';
import { withoutStagedInsights } from './without-staged-insights.ts';
import type { GithubDockState } from './github-post-state.ts';
import { lineFromTarget } from './line-from-target.ts';
import { relativeLineTextFrom } from './relative-line-text-from.ts';
import { FileReferenceIndex } from './file-reference-index.ts';
import type { FileReference } from './file-reference-index.ts';
import { sheetPlaceFrom } from './sheet-place-from.ts';
import { sheetRangeFrom } from './sheet-range-from.ts';
import type { SheetPlace } from './step-sheet-history.ts';
import type { RadarTreeMode } from './plan-radar-tree.ts';
import type { SheetAction, SheetOpenDetail } from './run-sheet-action.ts';
import type { ZoneId } from './zones.ts';
import type { ChatStreamSubscribe } from './text-part-stream.ts';
import type {
  ActiveFileDetail,
  ChatAddDetail,
  ChatCiteDetail,
  ChatMentionDetail,
  ChatSubmitDetail,
  EditorOpenDetail,
  FileReviewedDetail,
  FindingRefDetail,
  ReviewEditsDetail,
  LineRequestDetail,
  MessageIdDetail,
  PeekExpandDetail,
  ProposalRefDetail,
  StackRefDetail,
  TreeModeDetail,
  TreeSelectDetail,
  UraExportDetail,
  UraItemIdDetail,
  UraJumpDetail,
  UraReorderDetail,
  UraTransitionDetail,
  UraVerdictDetail,
  UrlDetail,
} from './app-event-details.ts';
import { signInHintOf } from './sign-in-hint-of.ts';
import { sheetActionFrom } from './sheet-action-from.ts';
import { subscribeChatStreamOf } from './subscribe-chat-stream-of.ts';
import { isEditableElement } from './is-editable-element.ts';
import { emptyStateStyles } from './primitives/empty-state-styles.ts';
import type { CommitInfoRequestDetail, CopyTextDetail } from './primitives/beuve-commit.ts';
import type { BeuveNoteExpand, NoteExpandRequestDetail } from './beuve-note-expand.ts';

/**
 * The open review (ADR 0104): the diff, the sidebar and the terminal, rendered from the shared
 * model the shell passes in. It owns what only the review has (the focus zone, the sidebar and
 * terminal state, the peek, flow and sheet portals, what the chat can mention) and reaches the
 * window through the shell's actions. Presentational components below it report intent as events;
 * this container turns them into calls on the controllers.
 */
@customElement('beuve-review')
export class BeuveReview extends LitElement {
  static override styles = [
    emptyStateStyles,
    css`
      :host {
        display: grid;
        min-block-size: 0;
        grid-template-rows: minmax(0, 1fr);
      }

      .main {
        grid-area: main;
        display: flex;
        flex-direction: column;
        min-inline-size: 0;
        min-block-size: 0;
      }

      .main > beuve-terminal-panel {
        flex: none;
        block-size: var(--beuve-terminal-height);
      }
      .empty-screen {
        padding-block-start: var(--beuve-size-screen-offset-tight);
        --empty-screen-width: var(--beuve-size-dialog-wide);
      }

      .main > beuve-diff-stream,
      .main > .empty-screen {
        flex: 1;
        min-block-size: 0;
      }
    `,
  ];

  /** The file the diff stream's cursor is on, sent as the question's focus. */
  private activePath: string | undefined;

  private jumpNonce = 0;

  private readonly onFocusIn = (event: FocusEvent): void => {
    const zone = event
      .composedPath()
      .find((target) => target instanceof HTMLElement && target.dataset['zone'] !== undefined);
    if (zone instanceof HTMLElement) {
      this.focusedZone = zone.dataset['zone'] as ZoneId;
    }
    const form = event.composedPath().find((target) => target instanceof HTMLFormElement);
    const expander = form?.querySelector('beuve-note-expand');
    if (expander !== null && expander !== undefined) {
      this.noteExpander = expander;
    }
    this.scheduleMenuSync();
  };

  /** The Expand of the note form the reviewer last typed in, for Expand Note Draft (ADR 0125). */
  private noteExpander: BeuveNoteExpand | undefined;

  /** Commits read for commit hashes' cards (ADR 0116), per session and hash. */
  private readonly commitInfos = new Map<string, Promise<CommitInfoView | undefined>>();

  /** `beuve-commit-info` from a commit hash anywhere in the review: its commit, read once. */
  private readonly onCommitInfo = (event: CustomEvent<CommitInfoRequestDetail>): void => {
    const bridge = beuveBridge();
    const sessionId = this.review?.session.id;
    if (bridge === undefined || sessionId === undefined) {
      return;
    }
    event.stopPropagation();
    const { sha } = event.detail;
    const answer = this.commitInfos.getOrInsertComputed(`${sessionId}\0${sha}`, async () => {
      const read = await bridge.invoke('session:get-commit', { sessionId, sha });
      if (!read.ok) {
        return;
      }
      return read.value;
    });
    event.detail.respond(answer);
  };

  /** `beuve-note-expand-request`: a note form's Expand (ADR 0125), through the dock's controller. */
  private readonly onNoteExpand = (event: CustomEvent<NoteExpandRequestDetail>): void => {
    event.stopPropagation();
    const { draft, signal } = event.detail;
    event.detail.respond(this.ura.expandNote(draft, signal));
  };

  /** `beuve-copy-text`: a commit card's Copy, through main's clipboard. */
  private readonly onCopyText = (event: CustomEvent<CopyTextDetail>): void => {
    event.stopPropagation();
    void this.copyText(event.detail.text);
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

  /** A check's link in the Overview: any http(s) URL, as the status bar's CI popover opens them. */
  private readonly onOpenUrl = (event: CustomEvent<UrlDetail>): void => {
    void this.openUrl(event.detail.url);
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

  private readonly onReviewEdits = (event: CustomEvent<ReviewEditsDetail>): void => {
    switch (event.detail.op) {
      case 'open': {
        void this.openReviewEdits();
        return;
      }
      case 'preview': {
        void this.reviewEdits.previewStage();
        return;
      }
      case 'stage': {
        void this.reviewEdits.stage();
        return;
      }
      case 'discard-preview': {
        void this.reviewEdits.previewDiscard();
        return;
      }
      case 'discard': {
        void this.reviewEdits.discard();
        return;
      }
      default: {
        this.reviewEdits.cancel();
      }
    }
  };

  private readonly onOpenCommit = (event: CustomEvent<OpenCommitDetail>): void => {
    void this.openCommit(event.detail.sha);
  };

  private readonly onMarkReviewed = (): void => {
    void this.session.markReviewed();
  };

  private readonly onPeekRequest = (event: CustomEvent<LineRequestDetail>): void => {
    void this.navigation.openPeek(event.detail.path, event.detail.line);
  };

  private readonly onSheetRequest = (event: CustomEvent<SheetOpenDetail>): void => {
    void this.sheetAction({ kind: 'open', ...event.detail });
  };

  private readonly onPeekExpand = (event: CustomEvent<PeekExpandDetail>): void => {
    void this.navigation.expandPeek(event.detail.nodeId);
  };

  private readonly onPeekClose = (): void => {
    this.navigation.closePeek();
  };

  private readonly onTokenHover = (event: CustomEvent<HoverPoint>): void => {
    this.renderRoot.querySelector<BeuveHoverCard>('beuve-hover-card')?.point(event.detail);
    this.renderRoot
      .querySelector<BeuveDefinitionLink>('beuve-definition-link')
      ?.point(event.detail);
  };

  private readonly onTokenHoverEnd = (): void => {
    this.renderRoot.querySelector<BeuveHoverCard>('beuve-hover-card')?.leave();
    this.renderRoot.querySelector<BeuveDefinitionLink>('beuve-definition-link')?.leave();
  };

  /** ⌘/Ctrl-click on a token: Go to Definition on it, as the menu command does. */
  private readonly onTokenJump = (event: CustomEvent<TokenJumpDetail>): void => {
    this.renderRoot.querySelector<BeuveHoverCard>('beuve-hover-card')?.leave();
    const { target, token } = event.detail;
    void this.sheetAction(sheetActionFrom('open-definition', target, token));
  };

  /** Whether the identifier under ⌘/Ctrl-hover links to a definition (ADR 0105). */
  private readonly askDefinition: DefinitionAsk = async (request) => {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return { ok: false, error: { code: 'unsupported', message: 'no bridge' } };
    }
    return bridge.invoke('lsp:definition', request);
  };

  /** A file card shows its file: ask the language servers about it (ADR 0111). */
  private readonly onDiagnosticsWanted = (event: CustomEvent<DiagnosticsWantedDetail>): void => {
    this.fileDiagnostics.want(event.detail.path);
  };

  /** The diagnostics under a place in a file of the diff on screen, for the hover card. */
  private readonly diagnosticsFor: DiagnosticsFor = (path, position: DiagnosticPosition) => {
    const file = this.shownDiagnostics().get(path);
    if (file?.kind !== 'ready') {
      return [];
    }
    return diagnosticsAt(file.view.diagnostics, position);
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
    void this.navigation.openFlow(event.detail.path, event.detail.line);
  };

  private readonly onFlowClose = (): void => {
    this.navigation.closeFlow();
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
    void this.ura.stageReviewFinding(event.detail.messageId, event.detail.finding);
  };

  private readonly onChatStageProposal = (event: CustomEvent<ProposalRefDetail>): void => {
    void this.ura.stageNoteProposal(event.detail.messageId, event.detail.proposal);
  };

  private readonly onInsightStage = (event: CustomEvent<FindingRefDetail>): void => {
    event.stopPropagation();
    void this.ura.stageReviewFinding(event.detail.messageId, event.detail.finding);
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
    void this.reviewData.setFileReviewed(event.detail.path, event.detail.reviewed);
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

  /** Rendered files' images by commit and path (ADR 0123). */
  private readonly images = new Map<string, Promise<string | undefined>>();

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

  /**
   * A rendered file's images (ADR 0123), read at the head or the review base through
   * `media:get-image`, once per commit and path.
   */
  private readonly loadImage: ImageLoader = async ({ path, side }): Promise<string | undefined> => {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return undefined;
    }
    let sha = review.headSha;
    if (side === 'base') {
      sha = review.baseSha;
    }
    const key = `${sha}\0${path}`;
    return this.images.getOrInsertComputed(key, async (): Promise<string | undefined> => {
      const image = await bridge.invoke('media:get-image', {
        sessionId: review.session.id,
        sha,
        path,
      });
      if (image.ok) {
        return image.value.uri;
      }
      return undefined;
    });
  };

  private readonly onUraCreate = (event: CustomEvent<UraCreateRequest>): void => {
    void this.ura.create(event.detail);
  };

  private readonly onUraUpdate = (event: CustomEvent<UraUpdateDetail>): void => {
    void this.ura.update(event.detail);
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
  private readonly onSidebarResize = (event: CustomEvent<SidebarResizeDetail>): void => {
    this.sidebarWidth = event.detail.width;
  };

  private readonly onSidebarTab = (event: CustomEvent<SidebarTabDetail>): void => {
    this.focusSidebar(event.detail.zone);
  };

  /** A display change from the stream: store it, and refetch the diff if whitespace changed. */
  private readonly onDisplayChange = (event: CustomEvent<SetDiffDisplayRequest>): void => {
    void this.setDisplay(event.detail);
  };

  private readonly onUraTransition = (event: CustomEvent<UraTransitionDetail>): void => {
    void this.ura.transition(event.detail.itemId, event.detail.to);
  };

  private readonly onUraReorder = (event: CustomEvent<UraReorderDetail>): void => {
    void this.ura.reorder(event.detail.itemIds);
  };

  private readonly onUraExport = (event: CustomEvent<UraExportDetail>): void => {
    void this.ura.export(event.detail.target);
  };

  private readonly onUraSetVerdict = (event: CustomEvent<UraVerdictDetail>): void => {
    void this.ura.setVerdict(event.detail.verdict);
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

  /** The chat answer a context menu was opened on, for Stage Answer as a Note. */
  private contextAnswerId: string | undefined;
  /**
   * The file a chat answer names that the last context menu was opened on (ADR 0128), for Open in
   * Sheet and Copy Relative Path; taken by the first of them that runs, and dropped by any other
   * right-click.
   */
  private contextReference: FileReference | undefined;
  /** The files chat answers may name, rebuilt when the review or the head's tree changes. */
  private referenceCache:
    | {
        readonly review: ReviewView | undefined;
        readonly tree: RepositoryTreeView | undefined;
        readonly index: FileReferenceIndex;
      }
    | undefined;

  private readonly navigation = new CodeNavigationController(this, {
    bridge: beuveBridge,
    review: (): ReviewView | undefined => {
      return this.review;
    },
    notify: (notice): void => {
      this.showNotice(notice);
    },
  });
  /** Run Setup and Edit Setup Command… (ADR 0130). */
  private readonly setup = new SetupController(this, {
    bridge: beuveBridge,
    target: (): SetupTarget | undefined => {
      if (this.review === undefined) {
        return undefined;
      }
      return { sessionId: this.review.session.id, headSha: this.review.headSha };
    },
    notify: (notice): void => {
      this.showNotice(notice);
    },
    startRun: (): void => {
      this.terminalShown = true;
      this.setupPending = true;
      void import('./beuve-terminal-panel.ts');
    },
  });
  /** The language servers' diagnostics for the files on screen (ADR 0111). */
  private readonly fileDiagnostics = new DiagnosticsController(this, {
    bridge: beuveBridge,
    target: (): DiagnosticsTarget | undefined => {
      if (this.review === undefined) {
        return undefined;
      }
      return { sessionId: this.review.session.id, headSha: this.review.headSha };
    },
  });
  private shownReview: ReviewView | undefined;

  private shownDisplaySide: SidebarSideView | undefined;
  /** The session whose Overview was last shown on its own: a pull request opens on it once. */
  private overviewShownFor: string | undefined;

  @state() accessor focusedZone: ZoneId = 'diff';

  /** `.gitattributes` for the review's files (ADR 0052), once `session:get-file-attributes` answers. */
  @state() accessor suggestionJump: SuggestionJump | undefined;

  @state() accessor fileJump: FileJump | undefined;

  @state() accessor treeMode: RadarTreeMode = 'diff-only';

  /** Which side the sidebar sits on (ADR 0044); main keeps it in `settings.json`. */
  @state() accessor sidebarSide: SidebarSideView = 'right';

  @state() accessor sidebarHidden = false;

  /** Dragged sidebar width in px; `undefined` is the stylesheet's responsive default. */
  @state() accessor sidebarWidth: number | undefined = undefined;

  /** The terminal panel under the diff (ADR 0095); its shells run on while it is hidden. */
  @state() accessor terminalShown = false;

  @state() accessor isTerminalFocused = false;

  /** Run Setup asked the terminal panel for a setup terminal it has not opened yet (ADR 0130). */
  @state() accessor setupPending = false;

  /** The sidebar tab on show: intent and files, the review or the chat. */
  @state() accessor sidebarTab: SidebarZone = 'files';

  /** The controllers the shell built; nothing renders until it is set. */
  @property({ attribute: false }) accessor model: AppModel | undefined = undefined;

  /** What the shell lets this container do on the window's behalf. */
  @property({ attribute: false }) accessor actions: AppActions | undefined = undefined;

  /** `process.platform`, for keys and layout. */
  @property() accessor platform = '';

  /** Whether the palette or the Open dialog has the window; the zones then leave the focus alone. */
  @property({ type: Boolean }) accessor isModalOpen = false;

  /** Changes whenever the shell re-rendered, which any controller's change does. */
  @property({ type: Number }) accessor revision = 0;

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
    const { review } = this;
    if (review === undefined) {
      return;
    }
    await this.reviewEdits.open(this.reviewEditsLocation(review));
  }

  /** A commit hash in the header: opens the commit's page on the session's GitHub remote. */
  private async openCommit(sha: string): Promise<void> {
    const bridge = beuveBridge();
    const { review } = this;
    if (bridge === undefined || review === undefined) {
      return;
    }
    const opened = await bridge.invoke('remote:open-commit', { sessionId: review.session.id, sha });
    if (!opened.ok) {
      this.showNotice({ tone: 'error', text: opened.error.message });
    } else if (opened.value.kind === 'no-remote') {
      this.showNotice({ tone: 'info', text: 'This repository has no GitHub remote to link to.' });
    }
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

  private reviewDeferrals(): typeof this.deferralPlan {
    const files = this.review?.files;
    let attributes = this.reviewData.fileAttributes;
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

  /** What is known of the diagnostics, unless the reviewer hides them (they are still fetched). */
  private shownDiagnostics(): ReadonlyMap<string, FileDiagnostics> {
    if (!this.settings.display.showDiagnostics) {
      return noDiagnostics;
    }
    return this.fileDiagnostics.byPath;
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
      this.fileDiagnostics.reset();
      this.showNotice({ tone: 'info', text: 'Language servers restarted for this head.' });
      void this.requireActions().refreshLspStatus();
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
    await this.copyText(text);
  }

  /** Copy Relative Path: the named file's, the tree's focused file's or the diff's file's path. */
  private async copyPath(): Promise<void> {
    const reference = this.takeContextReference();
    let path = reference?.path ?? this.treePath();
    if (path === undefined) {
      const target = this.stream()?.target();
      if (target !== undefined && target.kind !== 'change') {
        path = target.file.path;
      }
    }
    if (path === undefined) {
      this.showNotice({ tone: 'info', text: 'Pick a file to copy the path of.' });
      return;
    }
    await this.copyText(path);
  }

  /**
   * Open in Sheet (ADR 0128): a file a chat answer names on its lines, the tree's focused file, or
   * the diff's file on the head lines of its target, in a sheet window at the head.
   */
  private openInSheet(): void {
    const reference = this.takeContextReference();
    if (reference !== undefined) {
      const { path, lines } = reference;
      void this.sheetAction({
        kind: 'open',
        path,
        ...(lines !== undefined && { range: sheetRangeFrom(lines) }),
      });
      return;
    }
    const treePath = this.treePath();
    if (treePath !== undefined) {
      void this.sheetAction({ kind: 'open', path: treePath });
      return;
    }
    const target = this.stream()?.target();
    let place: SheetPlace | undefined;
    if (target !== undefined) {
      place = sheetPlaceFrom(target);
    }
    if (place === undefined) {
      this.showNotice({ tone: 'info', text: 'Pick a file on the head side to open in a sheet.' });
      return;
    }
    void this.sheetAction({ kind: 'open', ...place });
  }

  private takeContextReference(): FileReference | undefined {
    const reference = this.contextReference;
    this.contextReference = undefined;
    return reference;
  }

  /** Puts `text` on the clipboard and says so. */
  private async copyText(text: string): Promise<void> {
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    const copied = await bridge.invoke('clipboard:write-text', { text });
    if (copied.ok) {
      this.showNotice({ tone: 'info', text: `Copied ${revealFormatControls(text)}.` });
    } else {
      this.showNotice({ tone: 'error', text: `Could not copy: ${copied.error.message}` });
    }
  }

  /** Stages an answer in the review dock as a question note (spec Zone 4). */
  private async stageChatAnswer(messageId: string): Promise<void> {
    const plan = planChatStage(this.chat.entries, messageId, this.diffPaths());
    if (plan === undefined) {
      return;
    }
    await this.ura.stageChatAnswer(plan, messageId);
  }

  private selectionTarget(palette: PaletteSelection | undefined): MentionTarget | string {
    if (palette !== undefined) {
      return mentionTargetFromPalette({
        action: palette.action,
        items: this.ura.items,
        files: this.review?.files ?? [],
      });
    }
    switch (this.focusedZone) {
      case 'ura': {
        const item = this.renderRoot.querySelector<BeuveUraDock>('beuve-ura-dock')?.cursorItem();
        if (item === undefined) {
          return nothingSelected;
        }
        return mentionTargetFromItem(item, this.review?.files ?? []);
      }
      case 'overview': {
        return nothingSelected;
      }
      case 'files': {
        const path = this.renderRoot
          .querySelector<BeuveFilesSidebar>('beuve-files-sidebar')
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
    const file = fileOfMention(mention, this.review?.files ?? []);
    if (file === undefined) {
      this.chat.note('info', describeOutsideDiff(mention.path));
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
    const { path, startLine } = citation;
    if (!this.diffPaths().has(path)) {
      this.chat.note('info', describeOutsideDiff(citationPlace(citation)));
      return;
    }
    this.jumpNonce += 1;
    this.fileJump = { path, line: startLine, nonce: this.jumpNonce };
    this.focusedZone = 'diff';
  }

  private diffPaths(): ReadonlySet<string> {
    return new Set(this.review?.files.map((file) => file.path));
  }

  /**
   * The files a chat answer may name (ADR 0128): the head's tree, and the diff's files the head
   * has (the tree loads after the diff). Kept while neither changes, so answers aren't rebuilt.
   */
  private fileReferences(): FileReferenceIndex {
    const { review } = this;
    const { tree } = this.reviewData;
    const cache = this.referenceCache;
    if (cache !== undefined && cache.review === review && cache.tree === tree) {
      return cache.index;
    }
    const changed = (review?.files ?? [])
      .filter((file) => file.status !== 'deleted')
      .map((file) => file.path);
    let treePaths: readonly string[] = [];
    if (review !== undefined && tree?.sessionId === review.session.id) {
      treePaths = tree.paths;
    }
    const index = new FileReferenceIndex([...treePaths, ...changed]);
    this.referenceCache = { review, tree, index };
    return index;
  }

  /**
   * The `/review` findings to show on the diff (ADR 0061): the head's completed review answers
   * merged, minus the staged ones. Recomputed only when its inputs change, so the cards keep the
   * same objects while chat text streams (ADR 0050).
   */
  private reviewInsights(): readonly ReviewInsight[] {
    const { review } = this;
    if (review === undefined || !this.settings.display.showInsights) {
      return noInsights;
    }
    const messages = this.chat.entries.flatMap((entry): ChatMessageView[] => {
      if (entry.kind === 'message' && entry.message.review !== undefined) {
        return [entry.message];
      }
      return [];
    });
    const staged = this.ura.stagedFindings();
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

  private stream(): BeuveDiffStream | undefined {
    return this.renderRoot.querySelector<BeuveDiffStream>('beuve-diff-stream') ?? undefined;
  }

  /** The file focused in the tree, while the tree has the focus. */
  private treePath(): string | undefined {
    if (this.focusedZone === 'files') {
      return this.renderRoot.querySelector<BeuveFilesSidebar>('beuve-files-sidebar')?.focusedPath();
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

  /** Definitions open as sheets, permalinks go to the clipboard or browser (ADR 0067). */
  private async sheetAction(action: SheetAction): Promise<void> {
    await this.navigation.runSheet(action);
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

  /** Regions Next Region visits: the sidebar's only while it shows. */
  private zoneOrder(): ZoneId[] {
    return zoneOrderFrom({
      hasSidebar: this.review !== undefined && !this.sidebarHidden,
      isPullRequest: this.github.pullRequest !== undefined,
    });
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

  private renderOverview(): TemplateResult | typeof nothing {
    if (this.github.pullRequest === undefined) {
      return nothing;
    }
    return html`<beuve-overview-sidebar
      data-zone="overview"
      tabindex="-1"
      ?hidden=${this.sidebarTab !== 'overview'}
      ?focused=${this.focusedZone === 'overview'}
      .pullRequest=${this.github.pullRequest}
      .ci=${this.github.ci}
      .timeline=${this.github.timeline}
      @beuve-open-stack=${this.onOpenStack}
      @beuve-open-link=${this.onOpenLink}
      @beuve-open-url=${this.onOpenUrl}
    ></beuve-overview-sidebar>`;
  }

  private renderFiles(): TemplateResult {
    return html`<beuve-files-sidebar
      data-zone="files"
      tabindex="-1"
      ?hidden=${this.sidebarTab !== 'files'}
      ?focused=${this.focusedZone === 'files'}
      .files=${this.review?.files}
      .tree=${this.reviewData.tree}
      .generatedPaths=${this.reviewDeferrals().generated}
      .reviewMarks=${this.reviewData.marks}
      .treeMode=${this.treeMode}
      @beuve-tree-mode=${this.onTreeMode}
      @beuve-tree-select=${this.onTreeSelect}
    ></beuve-files-sidebar>`;
  }

  private renderDiff(): TemplateResult {
    if (this.review === undefined && !this.session.isLoading && this.session.error === '') {
      return html`<div class="empty-screen">
        <div>
          ${html`<slot name="queue"></slot>`}
          <h1>Open a review</h1>
          <p>Pick up where you left off, or paste the pull request you were asked to look at.</p>
          ${html`<slot name="empty"></slot>`}
        </div>
      </div>`;
    }
    return html`<beuve-diff-stream
      data-zone="diff"
      tabindex="-1"
      ?focused=${this.focusedZone === 'diff'}
      .sessionNote=${this.session.note}
      .review=${this.review}
      .reviewMarks=${this.reviewData.marks}
      .reviewProgress=${this.reviewData.progress}
      .order=${this.reviewData.order}
      ?loading=${this.session.isLoading}
      .loadingLabel=${describeSessionLabel(this.session.sessions, this.session.selectedId, this.review?.session)}
      ?marking=${this.session.isMarking}
      .savedProgress=${
        this.session.savedProgress?.sessionId === this.review?.session.id
          ? this.session.savedProgress
          : undefined
      }
      .platform=${this.platform}
      .error=${this.session.error}
      .peek=${this.navigation.peek}
      .flow=${this.navigation.flow}
      .fileJump=${this.fileJump}
      .loadFilePair=${this.loadFilePair}
      .loadImage=${this.loadImage}
      .uraItems=${this.ura.items}
      .insights=${this.reviewInsights()}
      .diagnostics=${this.shownDiagnostics()}
      .display=${this.settings.display}
      .suggestionJump=${this.suggestionJump}
      .deferrals=${this.reviewDeferrals().deferrals}
      @beuve-display-change=${this.onDisplayChange}
      @beuve-status-notice=${this.onStatusNotice}
      @beuve-ura-update=${this.onUraUpdate}
      @beuve-open-commit=${this.onOpenCommit}
      @beuve-mark-reviewed=${this.onMarkReviewed}
      @beuve-peek-request=${this.onPeekRequest}
      @beuve-peek-expand=${this.onPeekExpand}
      @beuve-peek-close=${this.onPeekClose}
      @beuve-sheet-request=${this.onSheetRequest}
      @beuve-open-url=${this.onOpenUrl}
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
      @beuve-diagnostics-wanted=${this.onDiagnosticsWanted}
    ></beuve-diff-stream>`;
  }

  private renderDock(): TemplateResult {
    return html`<beuve-ura-dock
      data-zone="ura"
      tabindex="-1"
      ?hidden=${this.sidebarTab !== 'ura'}
      ?focused=${this.focusedZone === 'ura'}
      ?hasSession=${this.review !== undefined}
      .platform=${this.platform}
      .items=${this.ura.items}
      .derivedVerdict=${this.ura.derivedVerdict}
      .chosenVerdict=${this.ura.chosenVerdict}
      .verdictNotice=${this.ura.verdictNotice}
      .notice=${this.ura.notice}
      ?exporting=${this.ura.isExporting}
      .github=${this.githubDock()}
      .reviewEdits=${{ view: this.reviewEdits.view, flow: this.reviewEdits.flow }}
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
      .references=${this.fileReferences()}
      .stagedMessageIds=${this.ura.stagedMessageIds()}
      .stagedFindings=${this.ura.stagedFindings()}
      .stagedProposals=${this.ura.stagedProposals()}
      .subscribeChatStream=${this.subscribeChatStream}
      ?hasSession=${this.review !== undefined}
      @beuve-open-link=${this.onOpenChatLink}
      @beuve-chat-submit=${this.onChatSubmit}
      @beuve-chat-escape=${this.onChatEscape}
      @beuve-chat-cancel=${this.onChatCancel}
      @beuve-chat-stage=${this.onChatStage}
      @beuve-chat-stage-finding=${this.onChatStageFinding}
      @beuve-chat-stage-proposal=${this.onChatStageProposal}
      @beuve-chat-clear-queue=${this.onChatClearQueue}
      @beuve-chat-cite=${this.onChatCite}
      @beuve-chat-mention=${this.onChatMention}
      @beuve-chat-cancel-compaction=${this.onChatCancelCompaction}
      @beuve-open-editor=${this.onOpenEditor}
      @beuve-sheet-request=${this.onSheetRequest}
    ></beuve-chat-drawer>`;
  }

  /**
   * A pull request session opens on its Overview, once; a session without a pull request has no
   * Overview tab, so a selection or focus left on it falls back to Files.
   */
  private keepOverviewValid(): void {
    if (this.github.pullRequest === undefined) {
      if (this.sidebarTab === 'overview') {
        this.sidebarTab = 'files';
      }
      if (this.focusedZone === 'overview') {
        this.focusedZone = 'files';
      }
      return;
    }
    const sessionId = this.review?.session.id;
    if (sessionId === undefined || sessionId === this.overviewShownFor) {
      return;
    }
    this.overviewShownFor = sessionId;
    this.sidebarTab = 'overview';
  }

  private renderSidebar(): TemplateResult {
    return html`<beuve-sidebar
      slot="sidebar"
      .side=${this.sidebarSide}
      .width=${this.sidebarWidth}
      .selected=${this.sidebarTab}
      ?isPullRequest=${this.github.pullRequest !== undefined}
      .stagedCount=${this.ura.stagedCount}
      @beuve-sidebar-resize=${this.onSidebarResize}
      @beuve-sidebar-tab=${this.onSidebarTab}
    >
      ${this.renderOverview()} ${this.renderFiles()} ${this.renderDock()} ${this.renderChat()}
    </beuve-sidebar>`;
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
        ?setupPending=${this.setupPending}
        @beuve-terminal-setup-taken=${(): void => {
          this.setupPending = false;
        }}
        @beuve-terminal-focus=${(event: CustomEvent<TerminalFocusDetail>): void => {
          this.onTerminalFocus(event);
        }}
        @beuve-terminal-hide=${(): void => {
          this.onTerminalHide();
        }}
      ></beuve-terminal-panel>`,
    )}`;
  }

  private renderSetupDialog(): TemplateResult | typeof nothing {
    const { dialog } = this.setup;
    if (dialog === undefined) {
      return nothing;
    }
    return html`<beuve-setup-command-dialog
      .repository=${dialog.repository}
      .command=${dialog.command}
      .error=${dialog.error}
      ?runsAfterSave=${dialog.runsAfterSave}
      @beuve-setup-command-save=${(event: CustomEvent<SetupCommandSaveDetail>): void => {
        void this.setup.save(event.detail.command);
      }}
      @beuve-setup-command-cancel=${(): void => {
        this.setup.cancel();
      }}
    ></beuve-setup-command-dialog>`;
  }

  private requireModel(): AppModel {
    if (this.model === undefined) {
      throw new Error('beuve-review needs its model');
    }
    return this.model;
  }

  private requireActions(): AppActions {
    if (this.actions === undefined) {
      throw new Error('beuve-review needs the shell’s actions');
    }
    return this.actions;
  }

  private get session(): SessionController {
    return this.requireModel().session;
  }

  private get github(): GithubController {
    return this.requireModel().github;
  }

  private get settings(): SettingsController {
    return this.requireModel().settings;
  }

  private get reviewData(): ReviewDataController {
    return this.requireModel().reviewData;
  }

  private get ura(): UraController {
    return this.requireModel().ura;
  }

  private get reviewEdits(): ReviewEditsController {
    return this.requireModel().reviewEdits;
  }

  private get chat(): ChatController {
    return this.requireModel().chat;
  }

  private get review(): ReviewView | undefined {
    return this.session.review;
  }

  /** Expand Note Draft: the Expand of the open note form the reviewer last focused. */
  private expandNoteDraft(): void {
    const expander = this.noteExpander;
    if (expander?.isConnected !== true) {
      this.noteExpander = undefined;
      this.showNotice({
        tone: 'info',
        text: 'Open a note’s composer or editor to expand its draft.',
      });
      return;
    }
    void expander.expand();
  }

  private showNotice(notice: StatusNotice): void {
    this.requireActions().notify(notice);
  }

  private async openLink(url: string): Promise<void> {
    await this.requireActions().openLink(url);
  }

  private async openUrl(url: string): Promise<void> {
    await this.requireActions().openUrl(url);
  }

  private async setDisplay(change: SetDiffDisplayRequest): Promise<DiffDisplayView | undefined> {
    return this.requireActions().setDisplay(change);
  }

  private scheduleMenuSync(): void {
    this.requireActions().scheduleMenuSync();
  }

  focusPathOfReview(): string | undefined {
    const { activePath } = this;
    if (this.review?.files.some((file) => file.path === activePath) === true) {
      return activePath;
    }
    return undefined;
  }

  chatDrawer(): BeuveChatDrawer | undefined {
    return this.renderRoot.querySelector<BeuveChatDrawer>('beuve-chat-drawer') ?? undefined;
  }

  /**
   * Add to Chat (ADR 0046): what the focused region points at becomes a chip in the chat input. The diff
   * gives its selection, hunk or file; the dock its item's anchor; the tree its focused file; the
   * palette its highlighted file or note. The chat tab opens with the input focused.
   */
  async addSelectionToChat(palette?: PaletteSelection): Promise<void> {
    if (this.review === undefined) {
      return;
    }
    const target = this.selectionTarget(palette);
    if (typeof target === 'string') {
      this.showNotice({ tone: 'info', text: target });
      return;
    }
    await this.addToChat(target);
  }

  /** What a right-click landed on, recording the reference, answer, note or tree row it chose. */
  contextKindAt(
    event: MouseEvent,
  ): 'line' | 'file' | 'tree' | 'note' | 'answer' | 'reference' | 'text' | undefined {
    const path = event.composedPath().filter((target) => target instanceof HTMLElement);
    this.contextReference = undefined;
    if (path.some((element) => isEditableElement(element))) {
      return 'text';
    }
    const reference = path.find((element) => element.dataset['action'] === 'reference');
    if (reference !== undefined) {
      this.contextReference = referenceFrom(reference.dataset);
      return 'reference';
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
        .querySelector<BeuveFilesSidebar>('beuve-files-sidebar')
        ?.revealPath(row.dataset['itemPath'] ?? '');
      this.focusedZone = 'files';
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

  focusSidebar(zone: SidebarZone): void {
    if (this.review === undefined) {
      return;
    }
    this.sidebarHidden = false;
    this.sidebarTab = zone;
    this.focusedZone = zone;
  }

  /** `/sidebar left|right`: moves the sidebar now and stores the side in `settings.json`. */
  async setSidebarSide(side: SidebarSideView): Promise<void> {
    this.sidebarSide = side;
    if ((await this.setDisplay({ sidebarSide: side })) !== undefined) {
      this.showNotice({ tone: 'info', text: `Sidebar on the ${side}` });
    }
  }

  /** Puts focus back in the focused zone after an overlay closes. */
  refocusZone(): void {
    void this.updateComplete.then(() => {
      this.zoneElement(this.focusedZone)?.focus();
    });
  }

  zoneElement(zone: ZoneId): HTMLElement | undefined {
    const selector = `[data-zone='${CSS.escape(zone)}']`;
    return (
      this.renderRoot.querySelector<HTMLElement>(selector) ??
      this.querySelector<HTMLElement>(selector) ??
      undefined
    );
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.addEventListener('focusin', this.onFocusIn);
    this.addEventListener('beuve-commit-info', this.onCommitInfo as EventListener);
    this.addEventListener('beuve-copy-text', this.onCopyText as EventListener);
    this.addEventListener('beuve-note-expand-request', this.onNoteExpand as EventListener);
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.removeEventListener('focusin', this.onFocusIn);
    this.removeEventListener('beuve-commit-info', this.onCommitInfo as EventListener);
    this.removeEventListener('beuve-copy-text', this.onCopyText as EventListener);
    this.removeEventListener('beuve-note-expand-request', this.onNoteExpand as EventListener);
  }

  /** Runs a catalog command this container handles; `false` when it is not one of its own. */
  run(id: CommandId): boolean {
    switch (id) {
      case 'cycle-zone': {
        this.focusedZone = cycleZone(this.zoneOrder(), this.focusedZone, 1);
        this.refocusZone();
        return true;
      }
      case 'cycle-zone-back': {
        this.focusedZone = cycleZone(this.zoneOrder(), this.focusedZone, -1);
        this.refocusZone();
        return true;
      }
      case 'chat': {
        this.toggleChat();
        return true;
      }
      case 'expand-note': {
        this.expandNoteDraft();
        return true;
      }
      case 'tree-mode': {
        if (this.treeMode === 'diff-only') {
          this.treeMode = 'neighborhood';
        } else {
          this.treeMode = 'diff-only';
        }
        return true;
      }
      case 'toggle-terminal': {
        this.terminalShown = !this.terminalShown;
        if (this.terminalShown) {
          // xterm is large: it loads when the panel first opens (ADR 0095).
          void import('./beuve-terminal-panel.ts');
        } else {
          this.isTerminalFocused = false;
        }
        return true;
      }
      case 'toggle-sidebar': {
        this.sidebarHidden = !this.sidebarHidden;
        if (this.sidebarHidden && this.focusedZone !== 'diff') {
          this.focusedZone = 'diff';
        }
        return true;
      }
      case 'flip-sidebar': {
        void this.setSidebarSide(otherSides[this.sidebarSide]);
        return true;
      }
      case 'sidebar-left': {
        void this.setSidebarSide('left');
        return true;
      }
      case 'sidebar-right': {
        void this.setSidebarSide('right');
        return true;
      }
      case 'sidebar-overview': {
        if (this.github.pullRequest !== undefined) {
          this.focusSidebar('overview');
        }
        return true;
      }
      case 'sidebar-files': {
        this.focusSidebar('files');
        return true;
      }
      case 'sidebar-review': {
        this.focusSidebar('ura');
        return true;
      }
      case 'sidebar-chat': {
        this.focusSidebar('chat');
        return true;
      }
      case 'find': {
        this.focusedZone = 'diff';
        void this.stream()?.openFind();
        return true;
      }
      case 'find-next':
      case 'find-previous':
      case 'find-selection':
      case 'find-match-case': {
        this.stream()?.runCommand(id);
        return true;
      }
      case 'commit-pairs': {
        void this.openCommitPairs();
        return true;
      }
      case 'copy-relative-line': {
        void this.copyRelativeLine();
        return true;
      }
      case 'copy-path': {
        void this.copyPath();
        return true;
      }
      case 'open-in-sheet': {
        this.openInSheet();
        return true;
      }
      case 'open-definition':
      case 'open-type-definition':
      case 'copy-permalink':
      case 'open-permalink': {
        const target = this.stream()?.target();
        if (target !== undefined) {
          void this.sheetAction(sheetActionFrom(id, target, this.stream()?.tokenClicked()));
        }
        return true;
      }
      case 'toggle-reviewed': {
        const path = this.treePath();
        if (path === undefined) {
          this.stream()?.runCommand(id);
        } else {
          void this.reviewData.setFileReviewed(path, this.reviewData.marks.get(path) !== 'yes');
        }
        return true;
      }
      case 'open-in-editor': {
        this.openInEditorFromFocus();
        return true;
      }
      case 'open-review-edits': {
        void this.openReviewEdits();
        return true;
      }
      case 'restart-language-servers': {
        void this.restartLanguageServers();
        return true;
      }
      case 'run-setup': {
        void this.setup.run();
        return true;
      }
      case 'edit-setup-command': {
        void this.setup.edit();
        return true;
      }
      case 'harvest-review-edits': {
        this.focusSidebar('ura');
        void this.reviewEdits.previewStage();
        return true;
      }
      case 'discard-review-edits': {
        this.focusSidebar('ura');
        void this.reviewEdits.previewDiscard();
        return true;
      }
      case 'post-review': {
        this.focusSidebar('ura');
        void this.github.previewReview();
        return true;
      }
      case 'stage-answer': {
        const messageId = this.contextAnswerId;
        if (messageId !== undefined) {
          void this.stageChatAnswer(messageId);
        }
        return true;
      }
      default: {
        return false;
      }
    }
  }

  /** A staged note chosen in the palette: show its lines in the diff. */
  jumpToUraItem(item: UraItemView): void {
    this.onUraJump(new CustomEvent('beuve-ura-jump', { detail: { item } }));
  }

  /** A zone's own command, from a menu or the palette: focus the zone first, then run it there. */
  async runZoneCommand(zone: ZoneId, id: CommandId, isFromPalette: boolean): Promise<void> {
    if (isFromPalette || this.focusedZone !== zone) {
      if (zone === 'diff' || this.review === undefined) {
        this.focusedZone = zone;
      } else {
        this.focusSidebar(zone);
      }
      await this.updateComplete;
      this.zoneElement(zone)?.focus();
    }
    const element = this.zoneElement(zone) as
      (HTMLElement & { readonly runCommand?: (id: CommandId) => boolean }) | undefined;
    element?.runCommand?.(id);
  }

  /** A slash command from the menus or the palette: typed into the chat, or only prefilled. */
  async runSlash(text: string, isPrefill: boolean): Promise<void> {
    this.focusSidebar('chat');
    await this.updateComplete;
    if (isPrefill) {
      this.chatDrawer()?.prefill(text);
    } else {
      this.chat.submit(text);
    }
  }

  /** A changed file scrolls the diff to it; any other file is shown in the tree. */
  goToFile(path: string, isChanged: boolean): void {
    if (isChanged) {
      this.onTreeSelect(new CustomEvent('beuve-tree-select', { detail: { path } }));
      this.focusedZone = 'diff';
      this.refocusZone();
      return;
    }
    this.treeMode = 'neighborhood';
    this.focusSidebar('files');
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<BeuveFilesSidebar>('beuve-files-sidebar')?.revealPath(path);
    });
  }

  /** What the review adds to the menu state: the focus, the cursor's file, the panels. */
  menuFacts(): ReviewMenuFacts {
    let dock: UraItemView | undefined;
    if (this.focusedZone === 'ura') {
      dock = this.renderRoot.querySelector<BeuveUraDock>('beuve-ura-dock')?.cursorItem();
    }
    const treePath = this.treePath();
    const markedPath = treePath ?? this.activePath;
    return {
      activePath: treePath ?? this.activePath,
      isActiveReviewed: markedPath !== undefined && this.reviewData.marks.get(markedPath) === 'yes',
      focusedZone: this.focusedZone,
      dockItem: dockItemOf(dock),
      isSidebarShown: this.review !== undefined && !this.sidebarHidden,
      isTerminalShown: this.review !== undefined && this.terminalShown,
      isTerminalFocused: this.isTerminalFocused,
      treeMode: this.treeMode,
      isFindCaseSensitive: this.stream()?.isFindCaseSensitive === true,
    };
  }

  override render(): TemplateResult | typeof nothing {
    if (this.model === undefined || this.actions === undefined) {
      return nothing;
    }
    const hasSidebar = this.review !== undefined && !this.sidebarHidden;
    return html`
      <beuve-workspace
        .side=${this.sidebarSide}
        ?hasSidebar=${hasSidebar}
        .sidebarWidth=${this.sidebarWidth}
      >
        <div class="main" slot="main">${this.renderDiff()}${this.renderTerminal()}</div>
        ${hasSidebar ? this.renderSidebar() : nothing}
      </beuve-workspace>
      ${
        this.review === undefined
          ? nothing
          : html`<beuve-hover-card
              .ask=${this.askHover}
              .diagnosticsFor=${this.diagnosticsFor}
              .sessionId=${this.review.session.id}
              .sha=${this.review.headSha}
            ></beuve-hover-card>`
      }
      ${
        this.review === undefined
          ? nothing
          : html`<beuve-definition-link
              .ask=${this.askDefinition}
              .sessionId=${this.review.session.id}
              .sha=${this.review.headSha}
            ></beuve-definition-link>`
      }
      ${this.renderSetupDialog()}
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const zone = this.focusedZone;
    if (zone !== 'diff' && changed.has('focusedZone')) {
      this.sidebarTab = zone;
    }
    this.keepOverviewValid();
    const side = this.settings.display.sidebarSide;
    if (side !== this.shownDisplaySide) {
      this.shownDisplaySide = side;
      this.sidebarSide = side;
    }
    this.setup.observe();
    const { review } = this;
    if (review === this.shownReview) {
      return;
    }

    this.shownReview = review;
    this.navigation.reset();
    if (review !== undefined) {
      this.focusedZone = 'diff';
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    this.scheduleMenuSync();
    const isRelevant = ['focusedZone', 'sidebarHidden'].some((key) => {
      return changed.has(key as keyof BeuveReview);
    });
    if (!isRelevant || this.isModalOpen) {
      return;
    }
    const element = this.zoneElement(this.focusedZone);
    if (element !== undefined && !element.matches(':focus-within')) {
      element.focus();
    }
  }
}

const otherSides: Readonly<Record<SidebarSideView, SidebarSideView>> = {
  left: 'right',
  right: 'left',
};

const nothingSelected =
  'Select lines, focus a hunk, a staged note or a file to add it to the chat.';

const noInsights: readonly ReviewInsight[] = [];
const noDiagnostics: ReadonlyMap<string, FileDiagnostics> = new Map();

/** The parts of the menu state only the review knows (ADR 0068). */
export type ReviewMenuFacts = Pick<
  MenuStateInput,
  | 'activePath'
  | 'isActiveReviewed'
  | 'focusedZone'
  | 'dockItem'
  | 'isSidebarShown'
  | 'isTerminalShown'
  | 'isTerminalFocused'
  | 'treeMode'
  | 'isFindCaseSensitive'
>;

/** What the open command palette points at, when Add to Chat runs from it. */
export interface PaletteSelection {
  readonly action: PaletteAction | undefined;
}

/** The file a reference button names, from its `data-path`, `data-start` and `data-end`. */
function referenceFrom(data: DOMStringMap): FileReference {
  const { path = '', start, end } = data;
  if (start === undefined) {
    return { path, lines: undefined };
  }
  return { path, lines: { start: Number(start), end: Number(end ?? start) } };
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-review': BeuveReview;
  }
}
