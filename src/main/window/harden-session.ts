import type { Session } from 'electron';

/**
 * Denies every permission request and check (camera, notifications, clipboard, …) and cancels
 * any network request a renderer makes; the renderer talks to main only over IPC (ADR 0005).
 */
export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => {
      callback({ cancel: true });
    },
  );
}
