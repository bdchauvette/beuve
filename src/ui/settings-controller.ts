import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type {
  BeuveApi,
  DiffDisplayView,
  EditorId,
  EditorSettingsView,
  IpcResult,
  SetDiffDisplayRequest,
} from '#contract/ipc-contract.ts';

import type { StatusNotice } from './describe-editor-open.ts';

/** The display before and after a change, for what depends on the difference. */
export interface DisplayTransition {
  readonly previous: DiffDisplayView;
  readonly next: DiffDisplayView;
}

/** What the settings need from the window around them. */
export interface SettingsEnvironment {
  /** The preload bridge, or `undefined` outside Electron. */
  readonly bridge: () => BeuveApi | undefined;
  readonly notify: (notice: StatusNotice) => void;
  /** The display was loaded or changed, here or in the Settings window. */
  readonly displayApplied: (transition: DisplayTransition) => void;
}

const initialDisplay: DiffDisplayView = {
  layout: 'split',
  ignoreWhitespace: false,
  sidebarSide: 'right',
  showGenerated: false,
  showInsights: true,
  reviewOrder: 'path',
  skipReviewed: false,
};

/**
 * The preferences main keeps for this window (ADR 0033, 0042, 0044, 0052, 0061, 0065, 0067): the
 * diff display and the editor Open in Editor uses. It reads them at start, again when the Settings
 * window changes them (`settings:changed`, while the host is connected), and stores a change on
 * request. What depends on a display change (reordering, reloading the diff, the sidebar side)
 * hangs off {@link SettingsEnvironment.displayApplied}.
 */
export class SettingsController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly environment: SettingsEnvironment;
  private shownDisplay: DiffDisplayView = initialDisplay;
  private shownEditor: EditorSettingsView | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(host: ReactiveControllerHost, environment: SettingsEnvironment) {
    this.host = host;
    this.environment = environment;
    host.addController(this);
  }

  private applyDisplay(next: DiffDisplayView): void {
    const previous = this.shownDisplay;
    this.shownDisplay = next;
    this.host.requestUpdate();
    this.environment.displayApplied({ previous, next });
  }

  private applyEditor(editor: EditorSettingsView | undefined): void {
    this.shownEditor = editor;
    this.host.requestUpdate();
  }

  hostConnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.environment.bridge()?.on('settings:changed', () => {
      void this.reload();
    });
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Split or inline, whether whitespace is ignored, and the rest of the diff display. */
  get display(): DiffDisplayView {
    return this.shownDisplay;
  }

  /** The editor Open in Editor uses, once known. */
  get editorSettings(): EditorSettingsView | undefined {
    return this.shownEditor;
  }

  /** Reads the editor and the display at start. */
  async load(): Promise<void> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return;
    }
    const editors = await bridge.invoke('editor:get-settings');
    this.applyEditor(undefined);
    if (editors.ok) {
      this.applyEditor(editors.value);
    }
    const display = await bridge.invoke('display:get');
    if (display.ok) {
      this.applyDisplay(display.value);
    }
  }

  /** `settings:changed`: the Settings window changed a preference; read them again. */
  async reload(): Promise<void> {
    const bridge = this.environment.bridge();
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
      this.applyEditor(editors.value);
    }
  }

  /** Stores a display change; an empty one only reads it. Failures show as a notice. */
  async change(request: SetDiffDisplayRequest): Promise<DiffDisplayView | undefined> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return undefined;
    }
    let result: IpcResult<DiffDisplayView>;
    if (Object.keys(request).length === 0) {
      result = await bridge.invoke('display:get');
    } else {
      result = await bridge.invoke('display:set', request);
    }
    if (!result.ok) {
      this.environment.notify({ tone: 'error', text: result.error.message });
      return undefined;
    }
    this.applyDisplay(result.value);
    return result.value;
  }

  /** Reads the editor, or with an id stores it; `undefined` without a bridge. */
  async chooseEditor(editorId?: EditorId): Promise<IpcResult<EditorSettingsView> | undefined> {
    const bridge = this.environment.bridge();
    if (bridge === undefined) {
      return undefined;
    }
    let result: IpcResult<EditorSettingsView>;
    if (editorId === undefined) {
      result = await bridge.invoke('editor:get-settings');
    } else {
      result = await bridge.invoke('editor:set-preferred', { editorId });
    }
    if (result.ok) {
      this.applyEditor(result.value);
    }
    return result;
  }
}
