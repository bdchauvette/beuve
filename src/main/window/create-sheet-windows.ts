import { BrowserWindow, screen } from 'electron';

import { descriptionSheetTitleFrom } from '#contract/description-sheet-title-from.ts';
import type { DescriptionSheetView, OpenSheetRequest } from '#contract/ipc-contract.ts';

import { planSheetBounds } from './plan-sheet-bounds.ts';
import type { WindowBounds } from './plan-sheet-bounds.ts';
import { windowBackground } from './window-background.ts';

export interface SheetWindowsOptions {
  /** The sheet preload, which exposes only the sheet channels (ADR 0067). */
  readonly preloadPath: string;
  readonly sheetHtmlPath: string;
  /** Called with each new sheet, so main can give it its menu (ADR 0068). */
  readonly onCreated: (window: BrowserWindow) => void;
}

/**
 * Opens sheet windows: read-only snapshots of one file at one commit (ADR 0067), or of a pull
 * request's description (ADR 0135).
 */
export interface SheetWindows {
  readonly open: (request: OpenSheetRequest) => void;
  /** A sheet of the description; the page reads it again on load and prints that. */
  readonly openDescription: (view: DescriptionSheetView) => void;
  /** Closes every open sheet (File ▸ Close All Sheets). */
  readonly closeAll: () => void;
}

/** One window to open: whose session it is, its title, and the query its page reads. */
interface SheetWindowRequest {
  readonly sessionId: string;
  readonly title: string;
  readonly query: Readonly<Record<string, string>>;
}

/**
 * Every `open` makes a new small window; sheets are never reused or refreshed, and there is no
 * limit. Each has the main window's ADR 0005 baseline (isolated, sandboxed, no Node, web security
 * on); navigation and popups are denied app-wide by `hardenWebContents`, the CSP is the `<meta>`
 * tag of `src/ui/sheet.html`, its menu bar hides until Alt on Linux (ADR 0068), and its preload exposes only the sheet channels, which main also
 * enforces per page. The request travels in the page's query string (a description sheet's
 * carries only its session), so the page reads its
 * snapshot on load. The size and place the reviewer last gave a session's sheet are remembered
 * in memory for that session's next sheet.
 */
export function createSheetWindows(options: SheetWindowsOptions): SheetWindows {
  const remembered = new Map<string, WindowBounds>();
  const open = new Map<string, Set<BrowserWindow>>();
  const openWindow = (sheet: SheetWindowRequest): void => {
    const siblings = open.getOrInsertComputed(sheet.sessionId, () => new Set<BrowserWindow>());
    const near = BrowserWindow.getFocusedWindow()?.getBounds();
    let display = screen.getPrimaryDisplay();
    if (near !== undefined) {
      display = screen.getDisplayMatching(near);
    }
    const bounds = planSheetBounds({
      workArea: display.workArea,
      remembered: remembered.get(sheet.sessionId),
      openCount: siblings.size,
    });
    const window = new BrowserWindow({
      ...bounds,
      minWidth: 420,
      minHeight: 320,
      show: false,
      title: sheet.title,
      backgroundColor: windowBackground({ dark: '#101211', light: '#f9f9fb' }),
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
        remembered.set(sheet.sessionId, window.getBounds());
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
    void window.loadFile(options.sheetHtmlPath, { query: sheet.query });
  };
  return {
    open: (request): void => {
      openWindow({
        sessionId: request.sessionId,
        title: titleOf(request),
        query: queryFrom(request),
      });
    },
    openDescription: ({ sessionId, pullRequest }): void => {
      openWindow({
        sessionId,
        title: descriptionSheetTitleFrom(pullRequest),
        query: { kind: 'description', session: sessionId },
      });
    },
    closeAll: (): void => {
      const windows = Array.from(open.values(), (siblings) => {
        return [...siblings];
      }).flat();
      for (const window of windows) {
        window.close();
      }
    },
  };
}

function titleOf(request: OpenSheetRequest): string {
  let line = '';
  if (request.range !== undefined) {
    line = `:${String(request.range.startLine)}`;
  }
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
