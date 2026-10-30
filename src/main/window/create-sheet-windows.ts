import { BrowserWindow, nativeTheme, screen } from 'electron';

import type { OpenSheetRequest } from '#contract/ipc-contract.ts';

import { planSheetBounds } from './plan-sheet-bounds.ts';
import type { WindowBounds } from './plan-sheet-bounds.ts';

export interface SheetWindowsOptions {
  /** The sheet preload, which exposes only the sheet channels (ADR 0067). */
  readonly preloadPath: string;
  readonly sheetHtmlPath: string;
  /** Called with each new sheet, so main can give it its menu (ADR 0068). */
  readonly onCreated: (window: BrowserWindow) => void;
}

/** Opens sheet windows: read-only snapshots of one file at one commit (ADR 0067). */
export interface SheetWindows {
  readonly open: (request: OpenSheetRequest) => void;
  /** Closes every open sheet (File ▸ Close All Sheets). */
  readonly closeAll: () => void;
}

/**
 * Every `open` makes a new small window; sheets are never reused or refreshed, and there is no
 * limit. Each has the main window's ADR 0005 baseline (isolated, sandboxed, no Node, web security
 * on); navigation and popups are denied app-wide by `hardenWebContents`, the CSP is the `<meta>`
 * tag of `src/ui/sheet.html`, its menu bar hides until Alt on Linux (ADR 0068), and its preload exposes only the sheet channels, which main also
 * enforces per page. The request travels in the page's query string, so the page reads its
 * snapshot on load. The size and place the reviewer last gave a session's sheet are remembered
 * in memory for that session's next sheet.
 */
export function createSheetWindows(options: SheetWindowsOptions): SheetWindows {
  const remembered = new Map<string, WindowBounds>();
  const open = new Map<string, Set<BrowserWindow>>();
  return {
    open: (request): void => {
      const siblings = open.getOrInsertComputed(request.sessionId, () => new Set<BrowserWindow>());
      const near = BrowserWindow.getFocusedWindow()?.getBounds();
      const display =
        near === undefined ? screen.getPrimaryDisplay() : screen.getDisplayMatching(near);
      const bounds = planSheetBounds({
        workArea: display.workArea,
        remembered: remembered.get(request.sessionId),
        openCount: siblings.size,
      });
      const window = new BrowserWindow({
        ...bounds,
        minWidth: 420,
        minHeight: 320,
        show: false,
        title: titleOf(request),
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1415' : '#f7f7f7',
        webPreferences: {
          preload: options.preloadPath,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
          navigateOnDragDrop: false,
          spellcheck: false,
        },
      });
      siblings.add(window);
      options.onCreated(window);
      const remember = (): void => {
        if (!window.isDestroyed() && !window.isMinimized() && !window.isFullScreen()) {
          remembered.set(request.sessionId, window.getBounds());
        }
      };
      window.on('resized', remember);
      window.on('moved', remember);
      window.on('closed', () => {
        siblings.delete(window);
      });
      window.once('ready-to-show', () => {
        window.show();
      });
      void window.loadFile(options.sheetHtmlPath, { query: queryFrom(request) });
    },
    closeAll: (): void => {
      const windows = Array.from(open.values(), (siblings) => [...siblings]).flat();
      for (const window of windows) {
        window.close();
      }
    },
  };
}

function titleOf(request: OpenSheetRequest): string {
  const line = request.range === undefined ? '' : `:${String(request.range.startLine)}`;
  return `${request.path}${line} · ${request.sha.slice(0, 7)}`;
}

function queryFrom(request: OpenSheetRequest): Record<string, string> {
  const { range } = request;
  return {
    session: request.sessionId,
    sha: request.sha,
    path: request.path,
    ...(range !== undefined && {
      startLine: String(range.startLine),
      startCharacter: String(range.startCharacter),
      endLine: String(range.endLine),
      endCharacter: String(range.endCharacter),
    }),
  };
}
