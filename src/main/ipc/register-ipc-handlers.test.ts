import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe } from 'vitest';

import { invokeChannels } from '#contract/invoke-channels.ts';
import type { InvokeChannel } from '#contract/ipc-contract.ts';
import { sheetInvokeChannels } from '#contract/sheet-invoke-channels.ts';
import { ok } from '#x/result/ok.ts';

import { test } from '../testing/test.ts';
import type { IpcHandlers } from './create-ipc-handlers.ts';
import { registerIpcHandlers } from './register-ipc-handlers.ts';

type Registered = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;

/** An `ipcMain` that keeps the registered handlers so a test can call them. */
function fakeIpcMain(registered: Map<string, Registered>): IpcMain {
  return {
    handle: (channel: string, handler: Registered): void => {
      registered.set(channel, handler);
    },
    removeHandler: (channel: string): void => {
      registered.delete(channel);
    },
  } as unknown as IpcMain;
}

function handlersAnsweringOk(): IpcHandlers {
  return Object.fromEntries(
    invokeChannels.map((channel) => [channel, (): unknown => ok(channel)]),
  ) as unknown as IpcHandlers;
}

function eventFrom(url: string, isTopLevel = true): IpcMainInvokeEvent {
  return {
    // eslint-disable-next-line unicorn/no-null -- Electron marks a top-level frame with a null parent.
    senderFrame: { url, parent: isTopLevel ? null : {} },
  } as unknown as IpcMainInvokeEvent;
}

describe('registerIpcHandlers', () => {
  test('lets the main page call everything and a sheet only the sheet channels', async ({
    expect,
    logger,
  }) => {
    const registered = new Map<string, Registered>();
    const main = 'file:///app/dist/ui/index.html';
    const sheet = 'file:///app/dist/ui/sheet.html';
    registerIpcHandlers(fakeIpcMain(registered), handlersAnsweringOk(), {
      pages: [
        { url: main, channels: 'all' },
        { url: sheet, channels: sheetInvokeChannels },
      ],
      logger: logger.logger,
    });
    const call = async (url: string, channel: InvokeChannel, isTopLevel = true): Promise<unknown> =>
      registered.get(channel)?.(eventFrom(url, isTopLevel), undefined);
    const refused = { ok: false, error: { code: 'invalid-request', message: 'untrusted sender' } };
    await expect(call(`${main}?x=1#y`, 'ura:create')).resolves.toStrictEqual(ok('ura:create'));
    await expect(call(`${sheet}?session=s&sha=a`, 'sheet:get-file')).resolves.toStrictEqual(
      ok('sheet:get-file'),
    );
    await expect(call(sheet, 'ura:create')).resolves.toStrictEqual(refused);
    await expect(call(sheet, 'editor:open')).resolves.toStrictEqual(refused);
    await expect(call(main, 'session:list', false)).resolves.toStrictEqual(refused);
    await expect(call('file:///elsewhere/sheet.html', 'sheet:get-file')).resolves.toStrictEqual(
      refused,
    );
  });
});
