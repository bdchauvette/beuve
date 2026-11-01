import { describe, expectTypeOf } from 'vitest';

import { test } from '#testing/test.ts';

import type { InvokeChannel, SettingsInvokeChannel } from './ipc-contract.ts';
import { isSettingsInvokeChannel } from './is-settings-invoke-channel.ts';
import { settingsInvokeChannels } from './settings-invoke-channels.ts';

describe('isSettingsInvokeChannel', () => {
  test('lists every settings channel once, each a contract channel', ({ expect }) => {
    expectTypeOf<
      Exclude<SettingsInvokeChannel, (typeof settingsInvokeChannels)[number]>
    >().toEqualTypeOf<never>();
    expectTypeOf<SettingsInvokeChannel>().toExtend<InvokeChannel>();
    expect(new Set(settingsInvokeChannels).size).toBe(settingsInvokeChannels.length);
  });

  test('refuses channels that read or change a review', ({ expect }) => {
    expect(isSettingsInvokeChannel('display:set')).toBe(true);
    expect(isSettingsInvokeChannel('models:set-key')).toBe(true);
    for (const channel of ['ura:create', 'editor:open', 'session:get-review', 'menu:run-main']) {
      expect(isSettingsInvokeChannel(channel)).toBe(false);
    }
    expect(isSettingsInvokeChannel(undefined)).toBe(false);
  });
});
