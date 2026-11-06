import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import xtermCss from '@xterm/xterm/css/xterm.css' with { type: 'text' };
import { css, html, LitElement, nothing, unsafeCSS } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type {
  BeuveApi,
  TerminalBacklogView,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalView,
} from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import './primitives/beuve-tab-list.ts';

/** Whether a terminal of the panel has the keyboard; the window reports it to the menus. */
export interface TerminalFocusDetail {
  readonly isFocused: boolean;
}

/** A tab and the xterm behind it. */
interface Pane {
  readonly view: TerminalView;
  readonly xterm: Terminal;
  readonly fit: FitAddon;
  readonly host: HTMLElement;
  /** Output up to here is already in the screen (a replayed backlog's end). */
  shownEnd: number;
}

/** A size in character cells. */
interface TerminalCells {
  readonly cols: number;
  readonly rows: number;
}

/** The colours xterm needs, read from the window's tokens. */
interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
}

/** A design token and the colour to use when the page does not define it. */
interface ColorVariable {
  readonly name: string;
  readonly fallback: string;
}

const fallbackFontFamily = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const fontSize = 13;

/**
 * The terminal panel (ADR 0095): one xterm per shell of the session, as tabs. It lists the
 * session's shells from main when it connects and replays their output, opens one when there is
 * none, sends keystrokes with `terminal:write` and shows `terminal:data`. Closing the panel (the
 * window just stops rendering it) leaves the shells running; closing a tab ends its shell.
 * Emits `beuve-terminal-focus` ({@link TerminalFocusDetail}) and `beuve-terminal-hide`.
 */
@customElement('beuve-terminal-panel')
export class BeuveTerminalPanel extends LitElement {
  static override styles = [
    buttonStyles,
    unsafeCSS(xtermCss),
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-block-size: 0;
        background: var(--beuve-surface);
        border-block-start: var(--beuve-border-width) solid var(--beuve-border);
      }

      .bar {
        display: flex;
        flex: none;
        align-items: center;
        gap: var(--beuve-space-1);
        block-size: var(--beuve-size-control);
        padding: 0 var(--beuve-space-2);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        font: var(--beuve-font-small);
      }

      .bar [role='tab'] {
        padding: var(--beuve-space-0-5) var(--beuve-space-2);
        border: none;
        border-radius: var(--beuve-radius-small);
        background: none;
        color: var(--beuve-text-muted);
        font: inherit;
        cursor: pointer;
      }

      .bar [role='tab'][aria-selected='true'] {
        background: var(--beuve-accent-soft);
        color: var(--beuve-text);
      }

      .bar [role='tab'].ended {
        text-decoration: line-through;
      }

      .bar .tabs {
        gap: var(--beuve-space-1);
        min-inline-size: 0;
        overflow-inline: auto;
      }

      .bar .tab {
        display: inline-flex;
        align-items: center;
      }

      .bar .spacer {
        flex: 1;
      }

      .hosts {
        position: relative;
        flex: 1;
        min-block-size: 0;
        padding-block: var(--beuve-space-1) 0;
        padding-inline: var(--beuve-space-2) 0;
      }

      .host {
        position: absolute;
        inset-block: var(--beuve-space-1) 0;
        inset-inline: var(--beuve-space-2) 0;
      }

      .host[hidden] {
        display: none;
      }

      .message {
        padding: var(--beuve-space-3);
        color: var(--beuve-text-muted);
        font: var(--beuve-font-small);
      }
    `,
  ];

  private readonly panes = new Map<string, Pane>();
  /** Output that arrived for a shell the panel has no xterm for yet. */
  private readonly early = new Map<string, TerminalDataEvent[]>();
  private unsubscribe: (() => void)[] = [];
  private resizeObserver: ResizeObserver | undefined;
  /** Watches the root's style, where Settings › Fonts sets the preferred code font (ADR 0122). */
  private fontObserver: MutationObserver | undefined;
  private colorScheme: MediaQueryList | undefined;

  private readonly colorSchemeListener = (): void => {
    for (const pane of this.panes.values()) {
      pane.xterm.options.theme = this.theme();
    }
  };

  private readonly onFocusChange = (): void => {
    const isFocused = this.matches(':focus-within');
    const detail: TerminalFocusDetail = { isFocused };
    this.dispatchEvent(
      new CustomEvent('beuve-terminal-focus', { detail, bubbles: true, composed: true }),
    );
  };

  @property({ attribute: false }) accessor api: BeuveApi | undefined;
  @property() accessor sessionId = '';
  /** The session's current head: a new shell starts in its checkout. */
  @property() accessor headSha = '';
  /** The tab labels, in order. */
  @state() accessor tabs: readonly TerminalView[] = [];
  @state() accessor activeId = '';
  @state() accessor failure = '';

  constructor() {
    super();
    this.addController(
      new ActionDelegation(this, {
        click: {
          select: ({ terminalId = '' }): void => {
            this.select(terminalId);
          },
          close: ({ terminalId = '' }): void => {
            void this.closeTab(terminalId);
          },
          new: (): void => {
            void this.openTab();
          },
          hide: (): void => {
            this.dispatchEvent(
              new CustomEvent('beuve-terminal-hide', { bubbles: true, composed: true }),
            );
          },
        },
      }),
    );
  }

  private renderTab(tab: TerminalView): TemplateResult {
    const isOlder = tab.headSha !== this.headSha;
    let label = `${tab.title} · ${tab.headSha.slice(0, 7)}`;
    if (isOlder) {
      label += ' (earlier head)';
    }
    return html`<span class="tab" role="presentation">
      <button
        role="tab"
        class=${tab.isRunning ? '' : 'ended'}
        aria-selected=${tab.id === this.activeId ? 'true' : 'false'}
        data-action="select"
        data-terminal-id=${tab.id}
        title=${label}
      >
        ${label}
      </button>
      <button
        class="button icon"
        data-action="close"
        data-terminal-id=${tab.id}
        title="Close terminal"
        aria-label="Close ${label}"
      >
        ×
      </button>
    </span>`;
  }

  private subscribe(): void {
    const bridge = this.api;
    if (bridge === undefined || this.unsubscribe.length > 0) {
      return;
    }
    this.unsubscribe = [
      bridge.on('terminal:data', (event) => {
        this.onData(event);
      }),
      bridge.on('terminal:exit', (event) => {
        this.onExit(event);
      }),
    ];
  }

  /** Lists the session's shells, replays them, and opens one when it has none. */
  private async attach(): Promise<void> {
    const bridge = this.api;
    if (bridge === undefined) {
      this.failure = 'The terminal needs the Electron app.';
      return;
    }
    const listed = await bridge.invoke('terminal:list', { sessionId: this.sessionId });
    if (!listed.ok) {
      this.failure = listed.error.message;
      return;
    }
    for (const terminal of listed.value.terminals) {
      await this.adopt(terminal);
    }
    if (listed.value.terminals.length === 0) {
      await this.openTab();
    }
  }

  private async openTab(): Promise<void> {
    const bridge = this.api;
    if (bridge === undefined || this.headSha === '') {
      return;
    }
    const size = this.proposedSize();
    const opened = await bridge.invoke('terminal:open', {
      sessionId: this.sessionId,
      expectedHeadSha: this.headSha,
      cols: size.cols,
      rows: size.rows,
    });
    if (!opened.ok) {
      this.failure = opened.error.message;
      return;
    }
    this.failure = '';
    await this.adopt({ ...opened.value, backlog: '', backlogEnd: 0 });
  }

  /** Creates the tab and xterm for a shell main already runs. */
  private async adopt(terminal: TerminalBacklogView): Promise<void> {
    const fontFamily = this.fontFamily();
    // xterm measures a cell when it opens, so the font must be loaded by then (ADR 0121).
    await document.fonts.load(`${String(fontSize)}px ${fontFamily}`);
    if (this.panes.has(terminal.id)) {
      return;
    }
    this.tabs = [...this.tabs, terminal];
    this.activeId = terminal.id;
    await this.updateComplete;
    const host = this.renderRoot.querySelector<HTMLElement>(
      `[data-terminal='${CSS.escape(terminal.id)}']`,
    );
    if (host === null) {
      return;
    }
    const xterm = new Terminal({
      fontFamily,
      fontSize,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      theme: this.theme(),
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(host);
    const pane: Pane = { view: terminal, xterm, fit, host, shownEnd: terminal.backlogEnd };
    this.panes.set(terminal.id, pane);
    xterm.onData((data) => {
      void this.api?.invoke('terminal:write', { terminalId: terminal.id, data });
    });
    xterm.onResize(({ cols, rows }) => {
      void this.api?.invoke('terminal:resize', { terminalId: terminal.id, cols, rows });
    });
    fit.fit();
    if (terminal.backlog !== '') {
      xterm.write(terminal.backlog);
    }
    const waiting = this.early.get(terminal.id) ?? [];
    for (const event of waiting) {
      this.show(pane, event);
    }
    this.early.delete(terminal.id);
    if (!terminal.isRunning) {
      xterm.write('\r\n[the shell has ended]\r\n');
    }
    if (this.activeId === terminal.id) {
      xterm.focus();
    }
  }

  private onData(event: TerminalDataEvent): void {
    const pane = this.panes.get(event.terminalId);
    if (pane === undefined) {
      const waiting = this.early.get(event.terminalId) ?? [];
      this.early.set(event.terminalId, [...waiting, event]);
      return;
    }
    this.show(pane, event);
  }

  /** Writes output the screen does not have yet: a replayed backlog already ends at `shownEnd`. */
  private show(pane: Pane, event: TerminalDataEvent): void {
    if (event.end <= pane.shownEnd) {
      return;
    }
    pane.shownEnd = event.end;
    pane.xterm.write(event.data);
  }

  private onExit(event: TerminalExitEvent): void {
    this.tabs = this.tabs.map((tab) => {
      if (tab.id === event.terminalId) {
        return { ...tab, isRunning: false };
      }
      return tab;
    });
    this.panes
      .get(event.terminalId)
      ?.xterm.write(`\r\n[the shell exited with code ${String(event.exitCode)}]\r\n`);
  }

  private select(terminalId: string): void {
    if (this.panes.has(terminalId)) {
      this.activeId = terminalId;
    }
  }

  private async closeTab(terminalId: string): Promise<void> {
    await this.api?.invoke('terminal:close', { terminalId });
    this.panes.get(terminalId)?.xterm.dispose();
    this.panes.delete(terminalId);
    this.early.delete(terminalId);
    this.tabs = this.tabs.filter((tab) => tab.id !== terminalId);
    if (this.activeId === terminalId) {
      this.activeId = this.tabs.at(-1)?.id ?? '';
    }
    if (this.tabs.length === 0) {
      this.dispatchEvent(new CustomEvent('beuve-terminal-hide', { bubbles: true, composed: true }));
    }
  }

  private activePane(): Pane | undefined {
    return this.panes.get(this.activeId);
  }

  /** The cells that fit the hosts now, for a shell that has no xterm yet. */
  private proposedSize(): TerminalCells {
    const proposed = this.activePane()?.fit.proposeDimensions();
    return { cols: proposed?.cols ?? 100, rows: proposed?.rows ?? 24 };
  }

  /** Gives every open xterm the window's monospace family, once it has loaded, and refits it. */
  private async refreshFont(): Promise<void> {
    const fontFamily = this.fontFamily();
    await document.fonts.load(`${String(fontSize)}px ${fontFamily}`);
    for (const pane of this.panes.values()) {
      if (pane.xterm.options.fontFamily === fontFamily) {
        continue;
      }
      pane.xterm.options.fontFamily = fontFamily;
      pane.fit.fit();
    }
  }

  /** The window's monospace family (`--beuve-font-family-mono`, ADR 0121, 0122). */
  private fontFamily(): string {
    const family = getComputedStyle(this).getPropertyValue('--beuve-font-family-mono').trim();
    if (family === '') {
      return fallbackFontFamily;
    }
    return family;
  }

  /**
   * xterm wants plain colors, and the tokens are `light-dark()` pairs (ADR 0114), so each is read
   * back as the computed color of a probe that uses it, in this element's color scheme.
   */
  private theme(): TerminalColors {
    const probe = document.createElement('span');
    probe.hidden = true;
    this.renderRoot.append(probe);
    const read = (variable: ColorVariable): string => {
      probe.style.setProperty('color', `var(${variable.name}, ${variable.fallback})`);
      return getComputedStyle(probe).color;
    };
    const colors = {
      background: read({ name: '--beuve-surface', fallback: '#ffffff' }),
      foreground: read({ name: '--beuve-text', fallback: '#1c2024' }),
      cursor: read({ name: '--beuve-accent', fallback: '#3a5bc7' }),
    };
    probe.remove();
    return colors;
  }

  override connectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.connectedCallback();
    this.addEventListener('focusin', this.onFocusChange);
    this.addEventListener('focusout', this.onFocusChange);
    this.colorScheme = matchMedia('(prefers-color-scheme: dark)');
    this.colorScheme.addEventListener('change', this.colorSchemeListener);
    this.resizeObserver = new ResizeObserver(() => {
      this.activePane()?.fit.fit();
    });
    this.resizeObserver.observe(this);
    this.fontObserver = new MutationObserver(() => {
      void this.refreshFont();
    });
    this.fontObserver.observe(document.documentElement, { attributeFilter: ['style'] });
    this.subscribe();
  }

  override disconnectedCallback(): void {
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
    this.removeEventListener('focusin', this.onFocusChange);
    this.removeEventListener('focusout', this.onFocusChange);
    this.colorScheme?.removeEventListener('change', this.colorSchemeListener);
    this.resizeObserver?.disconnect();
    this.fontObserver?.disconnect();
    for (const stop of this.unsubscribe) {
      stop();
    }
    this.unsubscribe = [];
    for (const pane of this.panes.values()) {
      pane.xterm.dispose();
    }
    this.panes.clear();
    this.early.clear();
  }

  /** Puts the keyboard in the visible terminal. */
  override focus(): void {
    this.activePane()?.xterm.focus();
  }

  protected override firstUpdated(): void {
    // The bridge is set after the element connects, so connecting may have found none.
    this.subscribe();
    void this.attach();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has('activeId')) {
      return;
    }

    const pane = this.activePane();
    pane?.fit.fit();
    pane?.xterm.focus();
  }

  override render(): TemplateResult {
    return html`
      <div class="bar">
        <beuve-tab-list class="tabs" label="Terminals">
          ${this.tabs.map((tab) => this.renderTab(tab))}
        </beuve-tab-list>
        <button
          class="button icon"
          data-action="new"
          title="New terminal"
          aria-label="New terminal"
        >
          +
        </button>
        <span class="spacer"></span>
        <button
          class="button icon"
          data-action="hide"
          title="Hide terminal"
          aria-label="Hide terminal"
        >
          ×
        </button>
      </div>
      <div class="hosts">
        ${this.failure === '' ? nothing : html`<div class="message">${this.failure}</div>`}
        ${this.tabs.map((tab) => {
          return html`<div
            class="host"
            data-terminal=${tab.id}
            ?hidden=${tab.id !== this.activeId}
          ></div>`;
        })}
      </div>
    `;
  }
}
