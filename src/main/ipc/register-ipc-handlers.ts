import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';

import { invokeChannels } from '#contract/invoke-channels.ts';
import type { InvokeChannel, IpcResult } from '#contract/ipc-contract.ts';

import type { IpcHandlers, IpcSender } from './create-ipc-handlers.ts';

/** A page of beuve's own and the channels it may call; `all` for the main window's page. */
export interface TrustedPage {
  readonly url: string;
  readonly channels: 'all' | readonly InvokeChannel[];
}

export interface RegisterIpcOptions {
  readonly pages: readonly TrustedPage[];
  readonly logger: Logger;
}

/**
 * Registers every contract channel on `ipcMain`. Calls from frames other than the top-level
 * frame of one of beuve's own pages, for a channel that page may not call (a sheet calls only the
 * sheet channels, ADR 0067, and the Settings window only its own, ADR 0068), or with more than one argument, are refused before reaching a
 * handler; unexpected exceptions are logged and become `internal` errors that point at the log, so the renderer never sees a stack.
 * Returns an unregister function.
 */
export function registerIpcHandlers(
  ipcMain: IpcMain,
  handlers: IpcHandlers,
  options: RegisterIpcOptions,
): () => void {
  const { pages, logger } = options;
  for (const channel of invokeChannels) {
    const handler: (
      request: unknown,
      sender: IpcSender,
    ) => IpcResult<unknown> | Promise<IpcResult<unknown>> = handlers[channel];
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<unknown>> => {
        if (!isTrustedSender(event, pages, channel)) {
          logger.warn('ipc call from untrusted frame refused', { channel });
          return err({ code: 'invalid-request', message: 'untrusted sender' });
        }
        if (args.length > 1) {
          return err({ code: 'invalid-request', message: 'expected at most one argument' });
        }
        try {
          return await handler(args[0], { webContentsId: event.sender.id });
        } catch (error: unknown) {
          logger.error('ipc handler failed', { channel, error });
          return err({
            code: 'internal',
            message: 'Internal error; Help › Show Log File has the details.',
          });
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

function isTrustedSender(
  event: IpcMainInvokeEvent,
  pages: readonly TrustedPage[],
  channel: InvokeChannel,
): boolean {
  const frame = event.senderFrame;
  if (frame?.parent !== null) {
    return false;
  }
  const url = new URL(frame.url);
  url.hash = '';
  url.search = '';
  const page = pages.find((candidate) => candidate.url === url.href);
  return page !== undefined && (page.channels === 'all' || page.channels.includes(channel));
}
