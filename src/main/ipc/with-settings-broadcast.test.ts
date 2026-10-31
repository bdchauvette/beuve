import { describe } from 'vitest';

import { invokeChannels } from '#contract/invoke-channels.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { test } from '../testing/test.ts';
import type { IpcHandlers, IpcSender } from './create-ipc-handlers.ts';
import { withSettingsBroadcast } from './with-settings-broadcast.ts';

describe('withSettingsBroadcast', () => {
  test('reports successful preference changes with their sender, and nothing else', async ({
    expect,
  }) => {
    const changes: (IpcSender | undefined)[] = [];
    const handlers = withSettingsBroadcast(handlersAnswering(), (sender) => {
      changes.push(sender);
    });
    await handlers['display:set']({ layout: 'split' }, { webContentsId: 2 });
    await handlers['trace:remove-trust']({ repositoryPath: 'refuse' }, { webContentsId: 2 });
    await handlers['editor:set-preferred']({ editorId: 'zed' }, { webContentsId: 5 });
    await handlers['display:get'](undefined, { webContentsId: 2 });
    expect(changes).toStrictEqual([{ webContentsId: 2 }, { webContentsId: 5 }]);
  });
});

function handlersAnswering(): IpcHandlers {
  return Object.fromEntries(
    invokeChannels.map((channel) => {
      return [
        channel,
        async (request: unknown): Promise<unknown> => {
          await Promise.resolve();
          return (request as { repositoryPath?: string } | undefined)?.repositoryPath === 'refuse'
            ? err({ code: 'refused', message: 'no' })
            : ok(channel);
        },
      ];
    }),
  ) as unknown as IpcHandlers;
}
