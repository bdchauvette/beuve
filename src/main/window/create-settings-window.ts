import process from 'node:process';

import { BrowserWindow } from 'electron';

import { windowBackground } from './window-background.ts';

export interface SettingsWindowOptions {
  /** The Settings preload, which exposes only the settings channels (ADR 0068). */
  readonly preloadPath: string;
  readonly settingsHtmlPath: string;
  /** Called with each new window, so main can give it its menu. */
  readonly onCreated: (window: BrowserWindow) => void;
}

/** The one Settings window (ADR 0068). */
export interface SettingsWindow {
  /** Shows the Settings window, opening it if it is not open, and focuses it. */
  readonly open: () => void;
}

/**
 * A small fixed-size window for the preferences that were reachable only through chat commands.
 * It has the ADR 0005 baseline of the other windows (isolated, sandboxed, no Node, web security on,
 * the strict CSP of `src/ui/settings.html`, navigation and popups denied by `hardenWebContents`),
 * and its own preload exposes only the settings channels, which main also enforces per page. At
 * most one is open; opening it again focuses it.
 */
export function createSettingsWindow(options: SettingsWindowOptions): SettingsWindow {
  let current: BrowserWindow | undefined;
  return {
    open: (): void => {
      if (current !== undefined && !current.isDestroyed()) {
        current.show();
        current.focus();
        return;
      }
      const parent = BrowserWindow.getFocusedWindow() ?? undefined;
      const window = new BrowserWindow({
        width: 620,
        height: 780,
        useContentSize: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        title: settingsTitle(),
        backgroundColor: windowBackground({ dark: '#16181d', light: '#f7f7f8' }),
        ...(parent !== undefined && process.platform !== 'darwin' && { parent }),
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
      current = window;
      options.onCreated(window);
      window.on('closed', () => {
        current = undefined;
      });
      window.once('ready-to-show', () => {
        window.show();
      });
      void window.loadFile(options.settingsHtmlPath);
    },
  };
}

/** The window's name as each platform calls it. */
function settingsTitle(): string {
  if (process.platform === 'darwin') {
    return 'Settings';
  }
  return 'Preferences';
}
