import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import type {
  AppInfo,
  CreateLocalSessionRequest,
  DiffDisplayView,
  EditorId,
  LspServerView,
  OpenPullRequestRequest,
  ReviewOrderMode,
  ReviewQueuePrefsView,
  ReviewView,
  SetDiffDisplayRequest,
  UraExportTarget,
} from '#contract/ipc-contract.ts';

import './beuve-chat-drawer.ts';
import './beuve-hover-card.ts';
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
import { applyDiffColors } from './apply-diff-colors.ts';
import type { StatusOpenUrlDetail, StatusPopoverDetail } from './beuve-status-bar.ts';
import './beuve-ura-dock.ts';
import { beuveBridge } from './beuve-bridge.ts';
import type { BeuveCommandPalette } from './beuve-command-palette.ts';
import type { BeuveOpenPanel, FolderChooser, RepositoryInspector } from './beuve-open-panel.ts';
import type { CommandId } from '#contract/command-catalog.ts';

import { commandRegistry } from './command-registry.ts';
import type { CommandDefinition } from './command-registry.ts';
import { shortcutOf } from './shortcut-of.ts';
import { keyPlatformOf } from './key-platform-of.ts';
import { menuStateFrom } from './menu-state-from.ts';
import type { PaletteAction, PaletteSources } from './plan-palette.ts';
import type { AppActions } from './app-actions.ts';
import type { AppModel } from './app-model.ts';
import './beuve-review.ts';
import type { BeuveReview } from './beuve-review.ts';
import './beuve-review-queue.ts';
import type {
  BeuveReviewQueue,
  QueueOpenDetail,
  QueueOpenUrlDetail,
} from './beuve-review-queue.ts';
import { QueueController } from './queue-controller.ts';
import { defaultReviewQueuePrefs } from '#contract/default-review-queue-prefs.ts';
import { ChatController } from './chat-controller.ts';
import { GithubController } from './github-controller.ts';
import { ReviewEditsController } from './review-edits-controller.ts';
import { displayChangeFor } from './display-change-for.ts';
import { ReviewDataController } from './review-data-controller.ts';
import { SessionController } from './session-controller.ts';
import { SettingsController } from './settings-controller.ts';
import type { DisplayTransition } from './settings-controller.ts';
import { UraController } from './ura-controller.ts';
import type { ReviewRef } from './review-ref.ts';
import type { ChatAppCommand } from './chat-controller.ts';
import { describeDiffDisplay } from './describe-diff-display.ts';
import { describeEditorSettings } from './describe-editor-settings.ts';
import { describeSessionLabel } from './describe-session-label.ts';
import type { StatusNotice, StatusNoticeAction } from './describe-editor-open.ts';
import './beuve-sheet-view.ts';
import type { PaletteRunDetail, SessionIdDetail } from './app-event-details.ts';
import { describeSheets } from './describe-sheets.ts';
import { describeGenerated } from './describe-generated.ts';
import { describeDiagnosticsSwitch } from './describe-diagnostics-switch.ts';
import { describeInsights } from './describe-insights.ts';
import { describeSkipReviewed } from './describe-skip-reviewed.ts';
import { describeOrder } from './describe-order.ts';
import { isTextFocused } from './is-text-focused.ts';

/**
 * Root of the renderer: the four-zone shell (spec section 4), the zone focus model and the
 * keys the shell already handles. Owns all bridge calls and session state; zones are
 * presentational and report user intent with events.
 */
@customElement('beuve-app')
export class BeuveApp extends LitElement {
  static override styles = [
    css`
      :host {
        display: grid;
        block-size: 100%;
        grid-template-rows: var(--beuve-titlebar-height) minmax(0, 1fr) var(
            --beuve-statusbar-height
          );
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
        block-size: var(--beuve-terminal-height, 300px);
      }

      .main > beuve-diff-stream {
        flex: 1;
        min-block-size: 0;
      }

      beuve-review-queue[slot='queue'] {
        max-block-size: 62vh;
        margin-block-end: var(--beuve-space-6);
      }

      beuve-open-panel[slot='empty'] {
        max-inline-size: 620px;
      }

      beuve-dialog beuve-review-queue {
        block-size: 70vh;
      }

      .sheet-overlay {
        position: fixed;
        inset-block: var(--beuve-titlebar-height) var(--beuve-statusbar-height);
        inset-inline: auto 0;
        z-index: 15;
        inline-size: min(760px, 62vw);
        border-inline-start: 1px solid var(--beuve-border);
        box-shadow: -8px 0 24px var(--beuve-scrim-soft);
      }
    `,
  ];

  private unsubscribes: (() => void)[] = [];

  private readonly session = new SessionController(this, {
    bridge: beuveBridge,
    ignoreWhitespace: (): boolean => {
      return this.settings.display.ignoreWhitespace;
    },
    closeOpenDialog: (): void => {
      this.openDialog = false;
    },
    switching: (): void => {
      this.reviewData.reset();
      this.ura.reset();
      this.chat.reset();
      this.github.reset();
      this.reviewEdits.reset();
    },
    reloading: (): void => {
      this.reviewEdits.clearStatus();
    },
    loaded: ({ review, previousHead }): void => {
      if (previousHead !== undefined && previousHead !== review.headSha) {
        this.github.invalidatePost();
      }
      this.reviewData.open(review);
      void this.refreshLspStatus();
      void this.ura.refresh(review.session.id);
      void this.reviewEdits.load(review.session.id);
      void this.chat.load(review.session.id);
      if (review.session.source.kind === 'remote-branch') {
        void this.github.loadBranch(review.session.id);
        return;
      }
      if (review.session.source.kind !== 'github-pull-request') {
        return;
      }
      void this.github.loadPullRequest(review.session.id);
      void this.github.loadTimeline(review.session.id);
    },
  });
  private readonly github = new GithubController(this, {
    bridge: beuveBridge,
    review: (): ReviewRef | undefined => {
      return this.session.reviewRef;
    },
    notify: (notice): void => {
      this.showNotice(notice);
    },
    refreshSessions: async (): Promise<void> => {
      return this.session.refresh();
    },
    selectSession: async (sessionId): Promise<void> => {
      return this.session.select(sessionId);
    },
    setOpenDialog: (isOpen): void => {
      this.openDialog = isOpen;
    },
  });
  private readonly settings = new SettingsController(this, {
    bridge: beuveBridge,
    notify: (notice): void => {
      this.showNotice(notice);
    },
    displayApplied: (transition): void => {
      this.onDisplayApplied(transition);
    },
  });
  private readonly reviewData = new ReviewDataController(this, {
    bridge: beuveBridge,
    review: (): ReviewView | undefined => {
      return this.review;
    },
    reviewOrder: (): ReviewOrderMode | undefined => {
      return this.settings.display.reviewOrder;
    },
    notify: (notice): void => {
      this.showNotice(notice);
    },
  });
  private readonly ura = new UraController(this, {
    bridge: beuveBridge,
    review: (): ReviewRef | undefined => {
      return this.session.reviewRef;
    },
  });
  private readonly reviewEdits = new ReviewEditsController(this, {
    bridge: beuveBridge,
    review: (): ReviewRef | undefined => {
      return this.session.reviewRef;
    },
    notify: (notice): void => {
      this.showNotice(notice);
    },
    refreshStaged: async (sessionId): Promise<void> => {
      return this.ura.refresh(sessionId);
    },
  });
  private readonly chat = new ChatController(this, {
    bridge: beuveBridge,
    sessionId: (): string | undefined => {
      return this.review?.session.id;
    },
    focusPath: (): string | undefined => {
      return this.reviewElement()?.focusPathOfReview();
    },
    restoreDraft: (text, mentions): void => {
      this.reviewElement()?.chatDrawer()?.setDraft(text, mentions);
    },
    runAppCommand: (command): void => {
      this.runChatAppCommand(command);
    },
  });
  private readonly queue = new QueueController(this, { bridge: beuveBridge });
  private readonly model: AppModel = {
    session: this.session,
    github: this.github,
    settings: this.settings,
    reviewData: this.reviewData,
    ura: this.ura,
    reviewEdits: this.reviewEdits,
    chat: this.chat,
  };
  private readonly actions: AppActions = {
    notify: (notice): void => {
      this.showNotice(notice);
    },
    openLink: async (url): Promise<void> => {
      return this.openLink(url);
    },
    openUrl: async (url): Promise<void> => {
      return this.openUrl(url);
    },
    setDisplay: async (change): Promise<DiffDisplayView | undefined> => {
      return this.setDisplay(change);
    },
    refreshLspStatus: async (): Promise<void> => {
      return this.refreshLspStatus();
    },
    scheduleMenuSync: (): void => {
      this.scheduleMenuSync();
    },
  };
  /** Changes on every render of the shell, so the review re-renders with any controller. */
  private revision = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly onFocusOut = (): void => {
    this.scheduleMenuSync();
  };
  /** A right-click: the context menu of what it landed on, built by main from the catalog. */
  private readonly onContextMenu = (event: MouseEvent): void => {
    const kind = this.reviewElement()?.contextKindAt(event);
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

  private isMenuSyncPending = false;
  private lastMenuState = '';

  private readonly onOpenRepository = (event: CustomEvent<CreateLocalSessionRequest>): void => {
    void this.session.open(event.detail);
  };

  private readonly onSelectSession = (event: CustomEvent<SessionIdDetail>): void => {
    void this.session.select(event.detail.sessionId);
  };

  private readonly onOpenPullRequest = (event: CustomEvent<OpenPullRequestRequest>): void => {
    void this.github.open(event.detail);
  };

  /** Edits happen in the editor, outside beuve: coming back to the window counts them again. */
  private readonly onWindowFocus = (): void => {
    const sessionId = this.review?.session.id;
    if (sessionId !== undefined) {
      void this.reviewEdits.load(sessionId);
    }
  };

  private readonly onDialogDismiss = (): void => {
    this.closeOpenDialog();
  };

  /** Enter on a queue row: the queue closes and the item opens as a session (ADR 0113). */
  private readonly onQueueOpen = (event: CustomEvent<QueueOpenDetail>): void => {
    void this.openQueueItem(event.detail.ref);
  };

  private readonly onQueuePrefs = (event: CustomEvent<ReviewQueuePrefsView>): void => {
    void this.settings.change({ reviewQueue: event.detail });
  };

  private readonly onQueueRefresh = (): void => {
    void this.queue.refresh();
  };

  private readonly onQueueOpenUrl = (event: CustomEvent<QueueOpenUrlDetail>): void => {
    void this.openUrl(event.detail.url);
  };

  private readonly onQueueDismiss = (): void => {
    this.closeQueue();
  };

  private readonly onQueueKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    this.closeQueue();
  };

  private readonly onTitlebarOpen = (): void => {
    this.showOpenDialog();
  };

  private readonly onTitlebarSearch = (): void => {
    this.runAppCommand('palette');
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
    this.reviewElement()?.refocusZone();
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
  @state() accessor overlayOpen = false;
  @state() accessor statusNotice: StatusNotice | undefined;
  @state() accessor appInfo: AppInfo | undefined;
  /** The open session's URA items, every status, placed on its current head. */
  /** The language servers beuve has started, as the status bar lists them. */
  @state() accessor lspServers: readonly LspServerView[] | undefined;
  @state() accessor openDialog = false;
  /** The review queue's dialog, over an open review (ADR 0113). */
  @state() accessor queueOpen = false;

  /** The palette's starting text while it is open. */
  @state() accessor paletteText: string | undefined;

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

  private get review(): ReviewView | undefined {
    return this.session.review;
  }

  private connect(): void {
    addEventListener('focus', this.onWindowFocus);
    this.addEventListener('focusout', this.onFocusOut);
    this.addEventListener('contextmenu', this.onContextMenu);
    const bridge = beuveBridge();
    if (bridge === undefined) {
      return;
    }
    this.unsubscribes = [
      bridge.on('menu:run', ({ id }) => {
        this.runCommandId(id);
      }),
      bridge.on('link:open-pr', ({ ref }) => {
        void this.github.open({ ref });
      }),
      bridge.on('link:open-branch', ({ ref }) => {
        void this.github.open({ ref });
      }),
    ];
    void this.loadInitialState();
  }

  private disconnect(): void {
    removeEventListener('focus', this.onWindowFocus);
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
    const [info] = await Promise.all([bridge.invoke('app:get-info'), this.session.refresh()]);
    if (info.ok) {
      this.appInfo = info.value;
      this.dataset['platform'] = info.value.platform;
    }
    await this.settings.load();
    void this.queue.load();
    await this.github.loadAuth();
  }

  /**
   * Review Queue (ADR 0113): over an open review, a wide dialog; on the home screen, which shows
   * the queue already, the keyboard goes to it.
   */
  private showQueue(): void {
    void this.queue.load();
    this.openDialog = false;
    this.overlayOpen = false;
    this.paletteText = undefined;
    if (this.review !== undefined) {
      this.queueOpen = true;
    }
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<BeuveReviewQueue>('beuve-review-queue')?.focusList();
    });
  }

  private closeQueue(): void {
    this.queueOpen = false;
    this.reviewElement()?.refocusZone();
  }

  /**
   * Opens a queue item through the usual open paths; one that needs a local clone shows the Open
   * dialog's pull request step for it, with the failure.
   */
  private async openQueueItem(ref: string): Promise<void> {
    this.queueOpen = false;
    await this.github.open({ ref });
    if (this.github.failure === undefined) {
      return;
    }
    this.showOpenDialog();
    await this.updateComplete;
    this.openPanel()?.showPullStep(ref);
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

  /** What depends on the display changing: the file order, the sidebar side, the diff and its colors. */
  private onDisplayApplied({ previous, next }: DisplayTransition): void {
    applyDiffColors(next.diffColors);
    const isWhitespaceChanged = next.ignoreWhitespace !== previous.ignoreWhitespace;
    const isOrderChanged = next.reviewOrder !== previous.reviewOrder;
    if (isOrderChanged && !isWhitespaceChanged && this.review !== undefined) {
      void this.reviewData.reloadOrder(this.review);
    }
    if (isWhitespaceChanged && this.session.selectedId !== '') {
      void this.session.select(this.session.selectedId);
    }
  }

  /** Stores a display change; `/diff` and `/whitespace` without arguments only show it. */
  private async setDisplay(change: SetDiffDisplayRequest): Promise<DiffDisplayView | undefined> {
    const display = await this.settings.change(change);
    if (display === undefined) {
      return undefined;
    }
    if (change.showGenerated !== undefined) {
      this.showNotice({ tone: 'info', text: describeGenerated(display.showGenerated) });
    }
    if (change.showInsights !== undefined) {
      this.showNotice({ tone: 'info', text: describeInsights(display.showInsights) });
    }
    if (change.showDiagnostics !== undefined) {
      this.showNotice({ tone: 'info', text: describeDiagnosticsSwitch(display.showDiagnostics) });
    }
    if (change.skipReviewed !== undefined) {
      this.showNotice({ tone: 'info', text: describeSkipReviewed(display.skipReviewed) });
    }
    if (change.reviewOrder !== undefined) {
      this.showNotice({ tone: 'info', text: describeOrder(display.reviewOrder) });
    }
    if (change.layout !== undefined || change.ignoreWhitespace !== undefined) {
      this.showNotice({
        tone: 'info',
        text: `Diffs: ${describeDiffDisplay(display, false).text}`,
      });
    }
    return display;
  }

  private async runDisplayCommand(change: SetDiffDisplayRequest): Promise<void> {
    const display = await this.setDisplay(change);
    if (display !== undefined) {
      this.chat.note('info', `Diffs: ${describeDiffDisplay(display, false).text}.`);
    }
  }

  /** `/editor [id]`: shows or sets the editor Open in Editor opens. */
  private async runEditorCommand(editorId: EditorId | undefined): Promise<void> {
    const result = await this.settings.chooseEditor(editorId);
    if (result === undefined) {
      return;
    }
    if (!result.ok) {
      this.chat.note('error', result.error.message);
      return;
    }
    this.chat.note('info', ...describeEditorSettings(result.value));
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
        void this.reviewElement()
          ?.setSidebarSide(command.side)
          .then(() => {
            this.chat.note('info', `Sidebar on the ${command.side}.`);
          });
        return;
      }
    }
  }
  /** Runs a catalog command the app handles itself (ADR 0068): the review's first, then the window's. */
  private runAppCommand(id: CommandId): void {
    if (id === 'find') {
      this.overlayOpen = false;
    }
    if (this.reviewElement()?.run(id) === true) {
      return;
    }
    switch (id) {
      case 'open': {
        this.paletteText = undefined;
        this.showOpenDialog();
        return;
      }
      case 'review-queue': {
        this.showQueue();
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
      case 'add-to-chat': {
        void this.addSelectionToChat();
        return;
      }
      case 'diff-split':
      case 'diff-inline':
      case 'whitespace':
      case 'toggle-generated':
      case 'toggle-insights':
      case 'toggle-diagnostics':
      case 'toggle-skip-reviewed':
      case 'order-path':
      case 'order-imports':
      case 'order-calls':
      case 'sheets-window':
      case 'sheets-inline': {
        void this.setDisplay(displayChangeFor(id, this.settings.display));
        return;
      }
      case 'editor-zed':
      case 'editor-vscode':
      case 'editor-cursor': {
        void this.setPreferredEditor(editorActions[id]);
        return;
      }
      case 'save-progress': {
        void this.session.markReviewed();
        return;
      }
      case 'stop': {
        this.chat.cancelRunning();
        return;
      }
      case 'export-agent-xml':
      case 'export-agent-json':
      case 'export-github': {
        void this.ura.export(exportActions[id]);
        return;
      }
      default: {
        return;
      }
    }
  }

  /** Review ▸ Open With: stores the editor Open in Editor uses. */
  private async setPreferredEditor(editorId: EditorId): Promise<void> {
    const result = await this.settings.chooseEditor(editorId);
    if (result === undefined) {
      return;
    }
    if (result.ok) {
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
    const facts = this.reviewElement()?.menuFacts();
    if (bridge === undefined || facts === undefined) {
      return;
    }
    const state = menuStateFrom({
      ...facts,
      hasSession: this.review !== undefined,
      isTextFocused:
        isTextFocused() || this.paletteText !== undefined || this.openDialog || this.queueOpen,
      isBusy: this.chat.isBusy,
      isPullRequest: this.github.pullRequest !== undefined,
      stagedCount: this.ura.stagedCount,
      display: this.settings.display,
      preferredEditor: this.settings.editorSettings?.preferred,
    });
    const key = JSON.stringify(state);
    if (key === this.lastMenuState) {
      return;
    }
    this.lastMenuState = key;
    void bridge.invoke('menu:set-state', state);
  }

  private showOpenDialog(): void {
    void this.session.refresh();
    this.overlayOpen = false;
    this.queueOpen = false;
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
    this.session.clearLocalFailure();
    this.reviewElement()?.refocusZone();
  }

  private closePalette(): void {
    this.paletteText = undefined;
    this.reviewElement()?.refocusZone();
  }

  private openPanel(): BeuveOpenPanel | undefined {
    return (
      this.renderRoot.querySelector<BeuveOpenPanel>('beuve-dialog beuve-open-panel') ?? undefined
    );
  }

  private async runPaletteAction(action: PaletteAction): Promise<void> {
    switch (action.kind) {
      case 'command': {
        await this.runCommand(action.command, true);
        return;
      }
      case 'session': {
        await this.session.select(action.sessionId);
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
        this.reviewElement()?.goToFile(action.path, action.isChanged);
        return;
      }
      case 'ura-item': {
        const item = this.ura.items.find(({ id }) => id === action.itemId);
        if (item !== undefined) {
          this.reviewElement()?.jumpToUraItem(item);
        }
      }
    }
  }
  /** Add to Chat (ADR 0046) from the palette or the focused region; the palette closes first. */
  private async addSelectionToChat(): Promise<void> {
    const review = this.reviewElement();
    if (this.paletteText === undefined) {
      await review?.addSelectionToChat();
      return;
    }
    const palette =
      this.renderRoot.querySelector<BeuveCommandPalette>('beuve-command-palette') ?? undefined;
    const action = palette?.activeAction();
    this.closePalette();
    await review?.addSelectionToChat({ action });
  }

  private showsEmptyPanel(): boolean {
    return (
      this.session.review === undefined && !this.session.isLoading && this.session.error === ''
    );
  }

  private reviewElement(): BeuveReview | undefined {
    return this.renderRoot.querySelector<BeuveReview>('beuve-review') ?? undefined;
  }

  private async runCommand(command: CommandDefinition, isFromPalette: boolean): Promise<void> {
    const { run } = command;
    switch (run.kind) {
      case 'app': {
        this.runAppCommand(command.id);
        if (isFromPalette && command.id !== 'commit-pairs') {
          this.reviewElement()?.refocusZone();
        }
        return;
      }
      case 'zone': {
        await this.reviewElement()?.runZoneCommand(run.zone, command.id, isFromPalette);
        return;
      }
      case 'slash': {
        await this.reviewElement()?.runSlash(run.text, run.isPrefill);
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

  private paletteSources(): PaletteSources {
    return {
      commands: commandRegistry,
      platform: keyPlatformOf(this.appInfo?.platform),
      sessions: this.session.sessions,
      ...(this.review !== undefined && { files: this.review.files }),
      ...(this.reviewData.tree !== undefined && { trackedPaths: this.reviewData.tree.paths }),
      uraItems: this.ura.items,
    };
  }

  private renderTitlebar(): TemplateResult {
    return html`<beuve-titlebar
      .label=${describeSessionLabel(this.session.sessions, this.session.selectedId, this.review?.session)}
      .openTitle=${`Open a pull request, branch or recent review (${this.shortcut('open')})`}
      .searchTitle=${`Command Palette (${this.shortcut('palette')})`}
      .platform=${this.appInfo?.platform ?? ''}
      @beuve-titlebar-open=${this.onTitlebarOpen}
      @beuve-titlebar-search=${this.onTitlebarSearch}
    ></beuve-titlebar>`;
  }

  private shortcut(id: CommandId): string {
    return shortcutOf(id, keyPlatformOf(this.appInfo?.platform));
  }
  private renderOpenPanel(isClosable: boolean, slot: 'empty' | undefined): TemplateResult {
    return html`<beuve-open-panel
      slot=${slot ?? nothing}
      data-zone=${slot === undefined ? nothing : 'diff'}
      ?closable=${isClosable}
      .platform=${this.appInfo?.platform ?? ''}
      .sessions=${this.session.sessions}
      ?openingPull=${this.github.isOpening}
      ?openingLocal=${this.session.isOpening}
      .pullFailure=${this.github.failure}
      .localFailure=${this.session.localFailure}
      .chooseFolder=${this.chooseFolder}
      .inspect=${this.inspectRepository}
      @beuve-select-session=${this.onSelectSession}
      @beuve-open-pull-request=${this.onOpenPullRequest}
      @beuve-open-repository=${this.onOpenRepository}
      @beuve-open-close=${this.onOpenClose}
      @beuve-open-pull-cancel=${this.onOpenPullCancel}
    ></beuve-open-panel>`;
  }

  private renderQueue(slot: 'queue' | undefined): TemplateResult {
    return html`<beuve-review-queue
      slot=${slot ?? nothing}
      .queue=${this.queue.queue}
      .error=${this.queue.error}
      .prefs=${this.settings.display.reviewQueue ?? defaultReviewQueuePrefs}
      @beuve-queue-open=${this.onQueueOpen}
      @beuve-queue-prefs=${this.onQueuePrefs}
      @beuve-queue-refresh=${this.onQueueRefresh}
      @beuve-queue-open-url=${this.onQueueOpenUrl}
    ></beuve-review-queue>`;
  }

  override render(): TemplateResult {
    return html`
      ${this.renderTitlebar()}
      <beuve-review
        .model=${this.model}
        .actions=${this.actions}
        .platform=${this.appInfo?.platform ?? ''}
        ?isModalOpen=${this.paletteText !== undefined || this.openDialog || this.queueOpen}
        .revision=${this.revision}
      >
        ${this.showsEmptyPanel() ? this.renderQueue('queue') : nothing}
        ${this.showsEmptyPanel() ? this.renderOpenPanel(false, 'empty') : nothing}
      </beuve-review>
      <beuve-status-bar
        .lspServers=${this.lspServers}
        .appInfo=${this.appInfo}
        .notice=${this.statusNotice}
        .ci=${this.github.ci}
        .attention=${this.github.pullRequest?.attention}
        .remoteBranch=${this.github.branch}
        .githubAuth=${this.github.auth}
        @beuve-status-action=${this.onStatusAction}
        @beuve-status-open-url=${this.onStatusOpenUrl}
        @beuve-status-popover=${this.onStatusPopover}
      ></beuve-status-bar>
      ${
        this.openDialog
          ? html`<beuve-dialog label="Open" @beuve-dialog-dismiss=${this.onDialogDismiss}>
              ${this.renderOpenPanel(true, undefined)}
            </beuve-dialog>`
          : nothing
      }
      ${
        this.queueOpen
          ? html`<beuve-dialog
              wide
              label="Review Queue"
              @beuve-dialog-dismiss=${this.onQueueDismiss}
              @keydown=${this.onQueueKeyDown}
            >
              ${this.renderQueue(undefined)}
            </beuve-dialog>`
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

  protected override willUpdate(): void {
    this.revision += 1;
  }

  protected override updated(changed: PropertyValues<this>): void {
    this.scheduleMenuSync();
    if (this.paletteText !== undefined && changed.has('paletteText')) {
      this.renderRoot.querySelector('beuve-command-palette')?.focus();
    }
  }
}

const paletteOpenings: Readonly<Record<'palette' | 'go-to-file', string>> = {
  palette: '',
  'go-to-file': '@',
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

declare global {
  interface HTMLElementTagNameMap {
    'beuve-app': BeuveApp;
  }
}
