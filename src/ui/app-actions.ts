import type { DiffDisplayView, SetDiffDisplayRequest } from '#contract/ipc-contract.ts';

import type { StatusNotice } from './describe-editor-open.ts';

/** What the shell lets the review container do on the window's behalf (ADR 0104). */
export interface AppActions {
  /** Shows a notice in the status bar. */
  readonly notify: (notice: StatusNotice) => void;
  /** Opens a link from a pull request; main allows GitHub's only (ADR 0040). */
  readonly openLink: (url: string) => Promise<void>;
  /** Opens a link from a chat answer; main allows any http(s) URL (ADR 0040). */
  readonly openUrl: (url: string) => Promise<void>;
  /** Stores a display change and says what changed; `undefined` when it failed. */
  readonly setDisplay: (change: SetDiffDisplayRequest) => Promise<DiffDisplayView | undefined>;
  /** The language servers changed (they were restarted): read their state again. */
  readonly refreshLspStatus: () => Promise<void>;
  /** The menus may need to change: tell main once things settle. */
  readonly scheduleMenuSync: () => void;
}
