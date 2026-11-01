import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe } from 'vitest';

import { invokeChannels } from '#contract/invoke-channels.ts';
import type { InvokeChannel } from '#contract/ipc-contract.ts';
import { mainWindowInvokeChannels } from '#contract/main-window-invoke-channels.ts';
import { settingsOnlyInvokeChannels } from '#contract/settings-only-invoke-channels.ts';
import { settingsInvokeChannels } from '#contract/settings-invoke-channels.ts';
import { sheetInvokeChannels } from '#contract/sheet-invoke-channels.ts';
import { ok } from '#x/result/ok.ts';

import { test } from '../testing/test.ts';
import type { IpcHandlers, IpcSender } from './create-ipc-handlers.ts';
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
    invokeChannels.map((channel) => {
      return [
        channel,
        (_request: unknown, sender?: IpcSender): unknown => {
          if (channel === 'menu:set-state') {
            return ok(sender);
          }
          return ok(channel);
        },
      ];
    }),
  ) as unknown as IpcHandlers;
}

function eventFrom(url: string, isTopLevel = true): IpcMainInvokeEvent {
  return {
    senderFrame: { url, parent: parentFrame(isTopLevel) },
    sender: { id: 7 },
  } as unknown as IpcMainInvokeEvent;
}

function parentFrame(isTopLevel: boolean): object | null {
  if (isTopLevel) {
    // eslint-disable-next-line unicorn/no-null -- Electron marks a top-level frame with a null parent.
    return null;
  }
  return {};
}

describe('registerIpcHandlers', () => {
  test('keeps the model registry out of the main window', async ({ expect, logger }) => {
    const registered = new Map<string, Registered>();
    const main = 'file:///app/dist/ui/index.html';
    registerIpcHandlers(fakeIpcMain(registered), handlersAnsweringOk(), {
      pages: [{ url: main, channels: mainWindowInvokeChannels }],
      logger: logger.logger,
    });
    const call = async (channel: InvokeChannel): Promise<unknown> => {
      return registered.get(channel)?.(eventFrom(main), undefined);
    };
    const refused = { ok: false, error: { code: 'invalid-request', message: 'untrusted sender' } };
    await expect(call('chat:ask')).resolves.toStrictEqual(ok('chat:ask'));
    for (const channel of settingsOnlyInvokeChannels) {
      await expect(call(channel)).resolves.toStrictEqual(refused);
    }
  });

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
    const call = async (
      url: string,
      channel: InvokeChannel,
      isTopLevel = true,
    ): Promise<unknown> => {
      return registered.get(channel)?.(eventFrom(url, isTopLevel), undefined);
    };
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

  test('lets the Settings window call only its channels, and names the sender', async ({
    expect,
    logger,
  }) => {
    const registered = new Map<string, Registered>();
    const settings = 'file:///app/dist/ui/settings.html';
    registerIpcHandlers(fakeIpcMain(registered), handlersAnsweringOk(), {
      pages: [{ url: settings, channels: settingsInvokeChannels }],
      logger: logger.logger,
    });
    const call = async (channel: InvokeChannel): Promise<unknown> => {
      return registered.get(channel)?.(eventFrom(settings), undefined);
    };
    const refused = { ok: false, error: { code: 'invalid-request', message: 'untrusted sender' } };
    await expect(call('display:set')).resolves.toStrictEqual(ok('display:set'));
    await expect(call('claude:status')).resolves.toStrictEqual(ok('claude:status'));
    await expect(call('menu:set-state')).resolves.toStrictEqual(ok({ webContentsId: 7 }));
    await expect(call('models:set-key')).resolves.toStrictEqual(ok('models:set-key'));
    for (const channel of [
      'session:get-review',
      'ura:create',
      'editor:open',
      'menu:run-main',
    ] as const) {
      await expect(call(channel)).resolves.toStrictEqual(refused);
    }
  });
});
