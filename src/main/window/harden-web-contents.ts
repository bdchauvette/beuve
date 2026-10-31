import type { WebContents } from 'electron';

import type { Logger } from '#x/log/create-logger.ts';

/** An Electron event whose default action can be cancelled. */
interface PreventableEvent {
  readonly preventDefault: () => void;
}

/**
 * Denies navigation, redirects, `window.open` and `<webview>` for a web contents (ADR 0005).
 * The app is a single page loaded from disk, so nothing may ever replace or spawn it.
 */
export function hardenWebContents(contents: WebContents, logger: Logger): void {
  const deny = (event: PreventableEvent, url: string): void => {
    event.preventDefault();
    logger.warn('navigation denied', { url });
  };
  contents.on('will-navigate', deny);
  contents.on('will-redirect', deny);
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    logger.warn('webview denied');
  });
  contents.setWindowOpenHandler(({ url }) => {
    logger.warn('window.open denied', { url });
    return { action: 'deny' };
  });
}
