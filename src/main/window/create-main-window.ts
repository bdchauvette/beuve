import { BrowserWindow, nativeTheme } from 'electron';

export interface MainWindowOptions {
  readonly preloadPath: string;
  readonly indexHtmlPath: string;
}

/**
 * Creates the 1440×900 review window (spec section 6) with the ADR 0005 baseline: isolated,
 * sandboxed, no Node in the renderer, web security on. Navigation and popups are denied
 * app-wide by `hardenWebContents`; the CSP is the `<meta>` tag in `src/ui/index.html` (ADR 0011).
 */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'beuve',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f7f7f8',
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
  window.once('ready-to-show', () => {
    window.show();
  });
  void window.loadFile(options.indexHtmlPath);
  return window;
}
