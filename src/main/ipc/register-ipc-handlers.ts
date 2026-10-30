import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';

import { invokeChannels } from '#contract/invoke-channels.ts';
import type { IpcResult } from '#contract/ipc-contract.ts';

import type { IpcHandlers } from './create-ipc-handlers.ts';

/**
 * Registers every contract channel on `ipcMain`. Calls from frames other than the app's own page,
 * or with more than one argument, are refused before reaching a handler; unexpected exceptions
 * become `internal` errors so the renderer never sees a stack. Returns an unregister function.
 */
export function registerIpcHandlers(
  ipcMain: IpcMain,
  handlers: IpcHandlers,
  options: { readonly trustedUrl: string; readonly logger: Logger },
): () => void {
  const { trustedUrl, logger } = options;
  for (const channel of invokeChannels) {
    const handler: (request: unknown) => IpcResult<unknown> | Promise<IpcResult<unknown>> =
      handlers[channel];
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<unknown>> => {
        if (!isTrustedSender(event, trustedUrl)) {
          logger.warn('ipc call from untrusted frame refused', { channel });
          return err({ code: 'invalid-request', message: 'untrusted sender' });
        }
        if (args.length > 1) {
          return err({ code: 'invalid-request', message: 'expected at most one argument' });
        }
        try {
          return await handler(args[0]);
        } catch (error: unknown) {
          logger.error('ipc handler failed', { channel, error });
          return err({ code: 'internal', message: 'internal error' });
        }
      },
    );
  }
  return (): void => {
    for (const channel of invokeChannels) {
      ipcMain.removeHandler(channel);
    }
  };
}

function isTrustedSender(event: IpcMainInvokeEvent, trustedUrl: string): boolean {
  const frame = event.senderFrame;
  if (frame?.parent !== null) {
    return false;
  }
  const url = new URL(frame.url);
  url.hash = '';
  url.search = '';
  return url.href === trustedUrl;
}
