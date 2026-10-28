import { css, html, LitElement, nothing } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import type { AppInfo, McpStatus } from '../contract/ipc-contract.ts';

import './beuve-chat-drawer.ts';
import './beuve-diff-stream.ts';
import './beuve-intent-sidebar.ts';
import './beuve-keybinding-overlay.ts';
import './beuve-status-bar.ts';
import './beuve-ura-dock.ts';
import { beuveBridge } from './beuve-bridge.ts';
import { cycleZone } from './cycle-zone.ts';
import { zones } from './zones.ts';
import type { ZoneId } from './zones.ts';

/**
 * Root of the renderer: the four-zone shell (spec section 4), the zone focus model and the
 * keys the shell already handles. Owns all bridge calls; zones are presentational.
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

  private unsubscribe: (() => void) | undefined;

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

  @state() accessor focusedZone: ZoneId = 'diff';
  @state() accessor chatOpen = false;
  @state() accessor overlayOpen = false;
  @state() accessor appInfo: AppInfo | undefined;
  @state() accessor mcpStatus: McpStatus | undefined;
  @state() accessor sessionNote = 'Loading sessions…';

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
    this.unsubscribe = bridge.on('mcp:status', (status) => {
      this.mcpStatus = status;
    });
    void this.loadInitialState();
  }

  private disconnect(): void {
    removeEventListener('keydown', this.onKeyDown, { capture: true });
    this.removeEventListener('focusin', this.onFocusIn);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
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
    this.sessionNote = sessions.ok
      ? `${String(sessions.value.length)} sessions`
      : `Sessions unavailable: ${sessions.error.message}`;
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
      default: {
        return;
      }
    }
  }

  private zoneOrder(): ZoneId[] {
    return zones.map(({ id }) => id).filter((id) => id !== 'chat' || this.chatOpen);
  }

  private toggleChat(): void {
    this.chatOpen = !this.chatOpen;
    this.focusedZone = this.chatOpen ? 'chat' : 'diff';
  }

  override render(): TemplateResult {
    return html`
      <div class="titlebar">
        <span class="brand">beuve</span>
        <span class="session">No session</span>
      </div>
      <beuve-intent-sidebar
        data-zone="intent"
        tabindex="-1"
        ?focused=${this.focusedZone === 'intent'}
      ></beuve-intent-sidebar>
      <beuve-diff-stream
        data-zone="diff"
        tabindex="-1"
        ?focused=${this.focusedZone === 'diff'}
        .sessionNote=${this.sessionNote}
      ></beuve-diff-stream>
      <beuve-ura-dock
        data-zone="ura"
        tabindex="-1"
        ?focused=${this.focusedZone === 'ura'}
      ></beuve-ura-dock>
      ${
        this.chatOpen
          ? html`<beuve-chat-drawer
              data-zone="chat"
              tabindex="-1"
              ?focused=${this.focusedZone === 'chat'}
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

function isEditable(event: KeyboardEvent): boolean {
  const [target] = event.composedPath();
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-app': BeuveApp;
  }
}
